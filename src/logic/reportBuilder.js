const { mapearFontesDoRelatorio } = require('./sourceProvenance');
const { registrarDocumentoOperacional } = require('./documentProvenance');
const PERIODOS_HOJE = Object.freeze({
  manha: Object.freeze({ label: "Manhã", horaInicio: 5, horaFim: 12 }),
  tarde: Object.freeze({ label: "Tarde", horaInicio: 12, horaFim: 18 }),
  noite: Object.freeze({ label: "Noite", horaInicio: 18, horaFim: 24 }),
});
const {
  buscarPrevisaoInmet,
  buscarAvisosInmet,
  deduplicarAvisosInmet,
  selecionarAvisosInmet,
} = require("../sources/inmet");
const { buscarObservacaoInmet } = require("../sources/inmetObservations");
const { buscarOpenMeteo, classificarIndiceUv } = require("../sources/openMeteo");
const { buscarQualidadeAr } = require("../sources/airQuality");
const { buscarMarComFallback } = require("../sources/marine");
const { montarOcorrencias } = require("./ocorrenciasPainel");
const { tipoDocumentoPorHorario } = require("./alertPresentation");
const { edicaoInformativo, intervaloAvisos, validadeInformativo, partesNoFuso } = require("./informativoValidity");
const { aplicarPoliticaFontes, complementarRajadaPrevista, aplicarRajadaOceanop } = require("./weatherSourcePolicy");
const { metadadosMeteorologicos } = require("./weatherSourceMetadata");
const { criarIndicadoresSnapshot } = require("./indicatorSnapshot");
const { classificarDadosRelatorio, validarDadosRelatorio } = require("./meteorologicalValidity");
const { montarContextoMeteorologicoSetor } = require("./sectorWeatherContext");
const {
  buscarOceanopDaBase,
  mapearOceanopParaVento,
  mapearOceanopParaProximosDias,
  FONTE: FONTE_OCEANOP,
} = require("../sources/oceanop");
const oceanopPontos = require("../config/oceanopPontos");
const climaSaudeService = require("../sources/climaSaudeService");
const {
  criarHealthCheck,
  operacional,
  degradado,
  indisponivel,
  naoConfigurada,
  naoAplicavel,
  paraMonitoramento,
  registrarFalha,
} = require("../sources/sourceHealth");
const {
  avaliarRiscos,
  recomendacoesDeslocamento,
  recomendacoesEdificacao,
} = require("./riskEngine");

function agora() { return new Date(); }

const PERIODO_COBERTO_AGENDADO = "definido pela edição do informativo";
const JANELAS_PROBABILIDADE_EDICAO = Object.freeze({
  "05:00": Object.freeze({ inicioHora: 5, fimHora: 24, janela: "05h–00h" }),
  "08:00": Object.freeze({ inicioHora: 8, fimHora: 15, janela: "08h–15h" }),
  "09:00": Object.freeze({ inicioHora: 9, fimHora: 24, janela: "09h–00h" }),
  "12:00": Object.freeze({ inicioHora: 12, fimHora: 24, janela: "12h–00h" }),
  "15:00": Object.freeze({ inicioHora: 15, fimHora: 24, janela: "15h–00h" }),
  "17:00": Object.freeze({ inicioHora: 17, fimHora: 24, janela: "17h–00h" }),
  "20:00": Object.freeze({ inicioHora: 20, fimHora: 24, janela: "20h–00h" }),
});

// Janela de rajada OCEANOP por edição; o texto editorial "Previsão até 00h"
// do e-mail/PDF permanece inalterado.
function janelaOceanopDaEdicao(horarioAgendado) {
  if (horarioAgendado === "08:00") return { inicioHora: 8, fimHora: 15 };
  if (horarioAgendado === "15:00") return { inicioHora: 15, fimHora: 24 };
  const edicao = edicaoInformativo(horarioAgendado);
  return { inicioHora: edicao?.inicioHora ?? 5, fimHora: edicao?.fimPrevisaoHora ?? 24 };
}

function probabilidadeChuvaDaEdicao({ horarioAgendado, openMeteo, base } = {}) {
  const janela = JANELAS_PROBABILIDADE_EDICAO[horarioAgendado]
    || { inicioHora: 5, fimHora: 24, janela: "05h–00h" };
  const resultadoBase = {
    valor: null,
    fonte: "Indisponível",
    janela: openMeteo?.janelaHoje?.rotulo || janela.janela,
    regra: "maior probabilidade horária prevista no período; não representa a probabilidade de chuva em algum momento do dia inteiro",
  };
  if (Number.isFinite(openMeteo?.probabilidadeChuvaMax)) {
    return { ...resultadoBase, valor: openMeteo.probabilidadeChuvaMax,
      fonte: openMeteo.cache?.utilizado
        ? "Open-Meteo — previsão meteorológica (cache recente)"
        : "Open-Meteo — previsão meteorológica" };
  }
  return resultadoBase;
}

function identificarFontesEmCache(fontesPorCampo, base, cache) {
  if (!cache?.utilizado) return;
  const idadeMinutos = Math.max(1, Math.ceil(cache.idadeMs / 60000));
  const marcar = (fonte) => typeof fonte === "string"
    && fonte.startsWith("Open-Meteo")
    && !fonte.includes("Air Quality")
    && !fonte.includes("Marine")
    && !fonte.includes("(cache recente")
    ? `${fonte} (cache recente; ${idadeMinutos} min)` : fonte;
  for (const [campo, fonte] of Object.entries(fontesPorCampo)) {
    fontesPorCampo[campo] = marcar(fonte);
  }
  for (const periodo of Object.values(base.periodos || {})) {
    for (const campo of ["fonteVento", "fonteRajada", "fonteProbabilidade", "fontePrecipitacao"]) {
      periodo[campo] = marcar(periodo[campo]);
    }
  }
  if (base.rajadaPrioritariaReferencia) {
    base.rajadaPrioritariaReferencia.fonte = marcar(base.rajadaPrioritariaReferencia.fonte);
  }
}

const janelaPeriodo = (chave) => {
  const { horaInicio, horaFim } = PERIODOS_HOJE[chave];
  return `${String(horaInicio).padStart(2, "0")}h–${String(horaFim % 24).padStart(2, "0")}h`;
};

function slugCidade(nome) {
  return nome
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "");
}

function montarVentoPorPeriodo({ base }) {
  const periodos = base.periodos;
  return ["manha", "tarde", "noite"]
    .map((chave) => {
      const p = periodos[chave];
      return {
        periodo: p.periodo,
        janela: p.janela || janelaPeriodo(chave),
        direcao: p.direcao || "—",
        intensidade: p.intensidadeVento || "—",
        velocidadeMediaKmh: p.velocidadeMediaKmh ?? null,
        fonteVento: p.fonteVento || "Indisponível",
        referenciaEm: p.referenciaVentoEm || p.referenciaEm || null,
        rajadaMaxKmh: p.rajadaMaxKmh ?? null,
        rajadaPrevistaEm: p.rajadaPrevistaEm || null,
        fonteRajada: p.fonteRajada || null,
        tipoDado: p.tipoDado || "indisponivel",
        referenciaInmet: `Vento: ${p.fonteVento || "indisponível"}${p.fonteVento?.includes("Open-Meteo") ? ` (previsão modelada${p.janelaModelo ? ` ${p.janelaModelo}` : ""})` : ""}${p.referenciaVentoEm ? ` · consulta ${p.referenciaVentoEm}` : ""}; rajada: ${p.fonteRajada || "indisponível"}${p.periodoReferenciaRajada ? ` · ${p.periodoReferenciaRajada}` : ""}${p.rajadaPrevistaEm ? ` · pico ${p.rajadaPrevistaEm}` : ""}`,
      };
    });
}

/**
 * Monta o objeto de dados completo do informativo para uma cidade cadastrada
 * em src/config/cities.js. Não lança em caso de falha parcial de uma fonte —
 * cada fonte que falhar é sinalizada em `avisosColeta` e o restante segue.
 */
async function montarRelatorio(cidade, { horarioAgendado = null, atualizarClimaSaude = false, dependencias = {} } = {}) {
  const dataNow = dependencias.agora ? dependencias.agora() : agora();
  const avisosColeta = [];
  const falhasApi = {};
  const consultarPrevisaoInmet = dependencias.buscarPrevisaoInmet || buscarPrevisaoInmet;
  const consultarAvisosInmet = dependencias.buscarAvisosInmet || buscarAvisosInmet;
  const consultarObservacaoInmet = dependencias.buscarObservacaoInmet || buscarObservacaoInmet;
  const consultarOpenMeteo = dependencias.buscarOpenMeteo || buscarOpenMeteo;
  const consultarQualidadeAr = dependencias.buscarQualidadeAr || buscarQualidadeAr;
  const consultarMar = dependencias.buscarMarComFallback || buscarMarComFallback;
  const consultarOceanop = dependencias.buscarOceanopPorCoordenadas || buscarOceanopDaBase;
  const consultarClimaSaude = dependencias.consultarClimaSaude || ((base) => climaSaudeService.consultar(base));
  const lerClimaSaudeArmazenado = dependencias.lerClimaSaudeArmazenado || ((base) => climaSaudeService.lerArmazenado(base));
  const climaSaudePromise = (horarioAgendado || atualizarClimaSaude)
    ? consultarClimaSaude(cidade)
    : Promise.resolve(lerClimaSaudeArmazenado(cidade));
  let inmetPrevisao, inmetAvisos, inmetObservacao, openMeteo, qualidadeArCams;
  const motivoArSemLicenca = "Licença comercial da Open-Meteo não configurada para esta instalação.";
  let healthQualidadeAr = naoConfigurada("Open-Meteo Air Quality / CAMS", motivoArSemLicenca);
  let healthOpenMeteo;

  const janelaEdicao = edicaoInformativo(horarioAgendado);

  try {
    inmetPrevisao = await consultarPrevisaoInmet(cidade.codigoIbge, {
      agora: dataNow, fuso: cidade.fusoHorario || "America/Sao_Paulo",
      municipio: cidade.nome, uf: cidade.uf,
    });
  } catch (erro) {
    falhasApi.inmetPrevisao = erro;
    registrarFalha("INMET-PREVISAO", erro);
    avisosColeta.push("INMET — Previsão: não foi possível atualizar esta fonte.");
  }

  try {
    qualidadeArCams = await consultarQualidadeAr(cidade, { now: dataNow });
    healthQualidadeAr = operacional("Open-Meteo Air Quality / CAMS", Number.isFinite(qualidadeArCams.usAqi)
      ? "US AQI atual modelado recebido; classificação interna em três faixas."
      : "UV atual modelado recebido; US AQI indisponível nesta resposta.", {
      checkedAt: dataNow.toISOString(),
      lastSuccessAt: qualidadeArCams.consultadoEm,
    });
  } catch (erro) {
    falhasApi.airQuality = erro;
    if (erro?.code === "OPEN_METEO_COMMERCIAL_LICENSE_REQUIRED") {
      healthQualidadeAr = naoConfigurada("Open-Meteo Air Quality / CAMS", motivoArSemLicenca);
    } else {
      registrarFalha("OPEN-METEO-AIR-QUALITY", erro);
      healthQualidadeAr = indisponivel("Open-Meteo Air Quality / CAMS", erro, erro.message, { checkedAt: dataNow.toISOString() });
      avisosColeta.push(`Qualidade do ar: ${erro.message}`);
    }
  }

  try {
    openMeteo = await consultarOpenMeteo(cidade.latitude, cidade.longitude, {
      inicioHora: janelaEdicao?.inicioHora ?? 5,
      fimHora: janelaEdicao?.fimPrevisaoHora ?? 24,
      diasPrevisao: 4,
      agregarJanela: Boolean(horarioAgendado),
      fuso: cidade.fusoHorario || "America/Sao_Paulo",
      now: dataNow,
      localidade: `${cidade.nome}/${cidade.uf}`,
    });
    healthOpenMeteo = openMeteo.cache?.utilizado
      ? degradado("Open-Meteo Weather Forecast API",
        Object.assign(new Error("Falha na consulta atual; cache recente utilizado."), { code: "OPEN_METEO_CACHE_USED" }),
        openMeteo.cache.atualizadoEm, { checkedAt: dataNow.toISOString() })
      : operacional("Open-Meteo Weather Forecast API", "Previsão meteorológica e UV recebidos.", {
        checkedAt: dataNow.toISOString(),
      });
  } catch (erro) {
    falhasApi.openMeteo = erro;
    registrarFalha("OPEN-METEO", erro);
    healthOpenMeteo = indisponivel("Open-Meteo Weather Forecast API", erro, erro.message, { checkedAt: dataNow.toISOString() });
    avisosColeta.push("Open-Meteo: previsão meteorológica e índice UV indisponíveis nesta atualização.");
  }

  inmetObservacao = await consultarObservacaoInmet(cidade, {
    inicioHora: janelaEdicao?.inicioHora ?? 0,
    fimHora: janelaEdicao?.fimPrevisaoHora ?? 24,
  });
  if (inmetObservacao.status !== "operacional") {
    avisosColeta.push(inmetObservacao.mensagem);
  }

  try {
    inmetAvisos = await consultarAvisosInmet(cidade.codigoIbge, {
      agora: dataNow,
      ...intervaloAvisos(horarioAgendado, dataNow),
    });
  } catch (erro) {
    falhasApi.inmetAvisos = erro;
    registrarFalha("INMET-AVISOS", erro);
    avisosColeta.push("INMET — Avisos: não foi possível atualizar esta fonte.");
  }

  // Rajada prevista: OCEANOP é a fonte prioritária (ponto das coordenadas da
  // base); falha ou ausência de dados deixa a Open-Meteo como contingência.
  let ventoOceanop = null;
  let previsaoOceanopDias = [];
  const pontoOceanop = oceanopPontos[cidade.chave];
  let healthOceanop = naoConfigurada(FONTE_OCEANOP, pontoOceanop?.motivo || "Ponto OCEANOP não cadastrado para esta base.");
  if (pontoOceanop?.habilitado) {
    try {
      const resultadoOceanop = await consultarOceanop(pontoOceanop);
      // A tabela por período cobre o dia operacional inteiro (05h–00h); só o
      // total do card usa a janela específica da edição.
      const ventoDia = mapearOceanopParaVento(resultadoOceanop, pontoOceanop, { agora: dataNow, inicioHora: 5, fimHora: 24, exigirFuturo: false });
      let resumoJanela = ventoDia.resumo;
      try {
        resumoJanela = mapearOceanopParaVento(resultadoOceanop, pontoOceanop, { agora: dataNow, ...janelaOceanopDaEdicao(horarioAgendado) }).resumo;
      } catch { resumoJanela = null; }
      ventoOceanop = { ...ventoDia, resumo: resumoJanela, unidadeOriginal: pontoOceanop.unidades.VelocidadeVento_10M_Rajada };
      previsaoOceanopDias = mapearOceanopParaProximosDias(resultadoOceanop, pontoOceanop, { agora: dataNow });
      healthOceanop = operacional(FONTE_OCEANOP, "Previsão de rajada recebida e validada para o ponto da base.", {
        checkedAt: dataNow.toISOString(),
        lastSuccessAt: resultadoOceanop.consultadoEm,
      });
    } catch (erro) {
      registrarFalha("OCEANOP", erro);
      healthOceanop = indisponivel(FONTE_OCEANOP, erro, erro.message, { checkedAt: dataNow.toISOString() });
      avisosColeta.push("OCEANOP: rajada prevista indisponível; utilizada a Open-Meteo quando disponível.");
    }
  }

  // Mar usa exclusivamente o ponto marítimo cadastrado da Open-Meteo Marine.
  let mar = null;
  let healthMarine = naoAplicavel("Open-Meteo Marine", "Base interior; produto oceanográfico não se aplica.");
  if (cidade.costeira) {
    const resultadoMar = await consultarMar(cidade);
    mar = resultadoMar.dados;
    healthMarine = resultadoMar.health;
    if (!mar) avisosColeta.push("Open-Meteo Marine: condições marítimas indisponíveis para o ponto validado da base.");
  }
  let qualidadeAr = {
    ...(qualidadeArCams || {}),
    uvMax: Number.isFinite(openMeteo?.uvMax) ? openMeteo.uvMax : null,
    uvMaxClassificacao: openMeteo?.uvClassificacao || null,
    horaPicoUv: openMeteo?.horaPicoUv || null,
    fonte: qualidadeArCams?.fonte || "Open-Meteo Air Quality / CAMS",
  };

  // Sem a Air Quality (licença/falha), o UV atual vem da própria previsão
  // Open-Meteo, identificado como modelado; nunca fica sem dado se ela responde.
  if (!Number.isFinite(qualidadeAr.uvAtual) && Number.isFinite(openMeteo?.uvAtual)) {
    qualidadeAr.uvAtual = openMeteo.uvAtual;
    qualidadeAr.uvClassificacao = classificarIndiceUv(openMeteo.uvAtual);
    qualidadeAr.fonteUv = "Open-Meteo — UV atual modelado (previsão)";
    qualidadeAr.referenciaEm = openMeteo.uvAtualReferenciaEm || null;
  }

  if (qualidadeAr && !Number.isFinite(qualidadeAr.usAqi)) qualidadeAr.motivoIndisponibilidade = qualidadeArCams
    ? "Open-Meteo não publicou US AQI válido nesta resposta." : healthQualidadeAr.message;

  let climaSaude;
  try { climaSaude = await climaSaudePromise; }
  catch (erro) {
    registrarFalha(`CLIMA-SAÚDE:${cidade.chave}`, erro);
    climaSaude = { status: "indisponivel", mensagem: "Clima e Saúde: dados indisponíveis nesta atualização.", dados: null };
  }
  // A indisponibilidade simultânea das fontes não derruba o painel. Cada campo
  // segue nulo, recebe procedência explícita de indisponibilidade e as falhas
  // ficam visíveis em monitoramentoApis/avisosColeta. Isso também permite que o
  // painel abra na primeira execução, quando ainda não existe cache válido.
  if (!openMeteo && !inmetPrevisao && !inmetObservacao?.observacao) {
    avisosColeta.push("Dados meteorológicos atuais indisponíveis: o painel foi carregado em modo degradado.");
  }

  const contextoMeteorologicoSetor = montarContextoMeteorologicoSetor(cidade, inmetPrevisao);
  const previsaoAtual = inmetPrevisao?.periodos?.tarde || inmetPrevisao?.periodos?.manha || inmetPrevisao?.periodos?.noite;
  let base = {
    condicaoGeral: contextoMeteorologicoSetor.condicaoGeral,
    tempMin: inmetPrevisao?.periodos?.manha?.tempMin ?? null,
    tempMax: inmetPrevisao?.periodos?.tarde?.tempMax ?? null,
    umidadeMin: inmetPrevisao?.periodos?.tarde?.umidadeMin ?? null,
    umidadeMax: inmetPrevisao?.periodos?.manha?.umidadeMax ?? null,
    temperaturaObservadaMinC: inmetObservacao?.status === "operacional" && !inmetObservacao.observacao?.desatualizado
      ? inmetObservacao.agregado?.temperaturaMinC ?? null : null,
    temperaturaObservadaMaxC: inmetObservacao?.status === "operacional" && !inmetObservacao.observacao?.desatualizado
      ? inmetObservacao.agregado?.temperaturaMaxC ?? null : null,
    umidadeObservadaMinPct: inmetObservacao?.status === "operacional" && !inmetObservacao.observacao?.desatualizado
      ? inmetObservacao.agregado?.umidadeMinPct ?? null : null,
    umidadeObservadaMaxPct: inmetObservacao?.status === "operacional" && !inmetObservacao.observacao?.desatualizado
      ? inmetObservacao.agregado?.umidadeMaxPct ?? null : null,
    coberturaTemperaturaObservada: inmetObservacao?.agregado?.coberturaTemperatura ?? null,
    coberturaUmidadeObservada: inmetObservacao?.agregado?.coberturaUmidade ?? null,
    precipitacaoTotalMm: null,
    precipitacaoHorariaMaxMm: null,
    probabilidadeChuvaMax: null,
    rajadaMaxKmh: null,
    temTempestadeHoje: null,
    atual: {
      condicao: previsaoAtual?.resumo || null,
      codigo: null,
      dia: true,
      previsao: true,
      horario: null,
      temperaturaC: null,
      umidadePct: null,
      fonte: previsaoAtual ? "INMET — previsão oficial" : "Informação indisponível",
    },
    // null (e não 0) é essencial aqui: o INMET não fornece rajada em km/h nem
    // probabilidade de chuva numérica. Zerar esses campos faria o painel
    // exibir "0 km/h" / "0%" como se fossem previsões reais de calmaria,
    // quando na verdade o dado não existe — o painel renderiza null como "—".
    periodos: {
      manha: { periodo: "Manhã", janela: janelaPeriodo("manha"), direcao: inmetPrevisao?.periodos?.manha?.direcaoVento || "—", intensidadeVento: inmetPrevisao?.periodos?.manha?.intensidadeVento || "—", rajadaMaxKmh: null, probabilidadeChuva: null, precipitacaoMm: null, tempestade: false },
      tarde: { periodo: "Tarde", janela: janelaPeriodo("tarde"), direcao: inmetPrevisao?.periodos?.tarde?.direcaoVento || "—", intensidadeVento: inmetPrevisao?.periodos?.tarde?.intensidadeVento || "—", rajadaMaxKmh: null, probabilidadeChuva: null, precipitacaoMm: null, tempestade: false },
      noite: { periodo: "Noite", janela: janelaPeriodo("noite"), direcao: inmetPrevisao?.periodos?.noite?.direcaoVento || "—", intensidadeVento: inmetPrevisao?.periodos?.noite?.intensidadeVento || "—", rajadaMaxKmh: null, probabilidadeChuva: null, precipitacaoMm: null, tempestade: false },
    },
  };

  const integrado = mapearFontesDoRelatorio(
    base,
    mar,
    qualidadeAr,
    openMeteo ? "Open-Meteo — previsão meteorológica" : "Informação indisponível"
  );
  ({ base, mar, qualidadeAr } = integrado);
  const marAtualParaRisco = mar;
  // Política campo a campo: INMET fornece os campos que publica; ausências
  // permanecem explícitas até uma fonte autorizada equivalente responder.
  const { diagnosticos: diagnosticosFallback } = aplicarPoliticaFontes({
    base,
    openMeteo,
    inmetPrevisao,
    inmetObservacao,
    cidade,
    fontesPorCampo: integrado.fontesPorCampo,
    agora: dataNow,
  });
  // Rajada: série da Open-Meteo como base e OCEANOP prioritário por cima;
  // velocidade sustentada do vento nunca é usada como substituta.
  complementarRajadaPrevista({ base, openMeteo, fontesPorCampo: integrado.fontesPorCampo, cidade });
  aplicarRajadaOceanop({ base, ventoOceanop, fontesPorCampo: integrado.fontesPorCampo });
  integrado.atual = base.atual;
  const probabilidadeChuvaEdicao = probabilidadeChuvaDaEdicao({ horarioAgendado, openMeteo, base });
  integrado.fontesPorCampo.probabilidadeChuvaPrevista = probabilidadeChuvaEdicao.fonte;
  identificarFontesEmCache(integrado.fontesPorCampo, base, openMeteo?.cache);
  // A coleta preserva os registros oficiais distintos para auditoria. Na
  // superfície operacional, avisos sobrepostos do mesmo fenômeno viram uma
  // única ocorrência: prevalece o mais grave/vigente/recente.
  const avisosInmet = selecionarAvisosInmet(
    deduplicarAvisosInmet(inmetAvisos?.avisos || []),
    { agora: dataNow }
  );

  const { eventoMaisRelevante, categoriasAtivas, severidade } = avaliarRiscos({
    tempMax: base.tempMax,
    umidadeMin: base.umidadeMin,
    rajadaMaxKmh: base.rajadaMaxKmh,
    probabilidadeChuvaMax: base.probabilidadeChuvaMax,
    precipitacaoHorariaMaxMm: base.precipitacaoHorariaMaxMm,
    precipitacaoTotalMm: base.precipitacaoTotalMm,
    temTempestadeHoje: base.temTempestadeHoje,
    periodos: base.periodos,
    fontesPorCampo: integrado.fontesPorCampo,
    avisosInmet,
    mar: marAtualParaRisco,
    qualidadeAr,
  });

  const janelaChuva = ["manha", "tarde", "noite"]
    .map((k) => base.periodos[k])
    .find((p) => p.probabilidadeChuva >= 30)?.periodo;

  const deslocamento = recomendacoesDeslocamento(categoriasAtivas, janelaChuva);
  const edificacao = recomendacoesEdificacao(categoriasAtivas);

  // A antiga comparação entre modelos para temperatura/chuva induzia uma
  // falsa equivalência de fontes. Com a matriz atual, cada indicador tem
  // sua origem explícita e não há fusão conservadora entre fornecedores.
  const divergencias = [];

  const fontesTabelaTemperatura = [...new Set([
    integrado.fontesPorCampo.tempMin,
    integrado.fontesPorCampo.tempMax,
    integrado.fontesPorCampo.umidadeMin,
    integrado.fontesPorCampo.umidadeMax,
  ].filter((fonte) => fonte && fonte !== "Indisponível"))];
  const temTemperaturaObservada = Number.isFinite(base.temperaturaObservadaMinC)
    || Number.isFinite(base.temperaturaObservadaMaxC)
    || Number.isFinite(base.umidadeObservadaMinPct)
    || Number.isFinite(base.umidadeObservadaMaxPct);
  const fonteEstacao = inmetObservacao?.observacao?.estacao?.codigo
    ? `INMET — estação automática (${inmetObservacao.observacao.estacao.codigo})`
    : "INMET — estação automática";
  const chuvaEstimada = openMeteo?.estimativaChuva;
  for (const campo of ["chuvaEstimadaDiaMm", "chuvaEstimadaHoraMm", "chuvaEstimada24hMm"]) {
    integrado.fontesPorCampo[campo] = Number.isFinite(chuvaEstimada?.[
      campo === "chuvaEstimadaDiaMm" ? "diaMm" : campo === "chuvaEstimadaHoraMm" ? "ultimaHoraMm" : "ultimas24hMm"
    ]) ? "Open-Meteo — estimativa de modelo" : "Indisponível";
  }
  const tabelaTemperaturaUmidade = [{
    fonte: temTemperaturaObservada ? fonteEstacao : fontesTabelaTemperatura.join(" / ") || "Indisponível",
    natureza: temTemperaturaObservada
      ? "Observação do dia civil local"
      : fontesTabelaTemperatura.every((fonte) => fonte.includes("INMET")) ? "Previsão diária oficial" : "Previsão diária com fonte modelada identificada",
    tempMin: temTemperaturaObservada ? base.temperaturaObservadaMinC : base.tempMin,
    tempMax: temTemperaturaObservada ? base.temperaturaObservadaMaxC : base.tempMax,
    umidadeMin: temTemperaturaObservada ? base.umidadeObservadaMinPct : base.umidadeMin,
    umidadeMax: temTemperaturaObservada ? base.umidadeObservadaMaxPct : base.umidadeMax,
  }];
  // No PDF das duas edições, o vento cobre sempre o dia operacional inteiro
  // (05h–00h); apenas os cards consolidados permanecem limitados à edição.
  const ventoPorPeriodo = montarVentoPorPeriodo({ base });

  const chuvaPorPeriodo = ["manha", "tarde", "noite"].map((k) => {
    const p = base.periodos[k];
    const i = inmetPrevisao?.periodos[k];
    return {
      periodo: p?.periodo || PERIODOS_HOJE[k].label,
      janela: p?.janela || janelaPeriodo(k),
      probabilidade: p?.probabilidadeChuva ?? null,
      precipitacaoMm: p?.precipitacaoMm ?? null,
      precipitacaoHorariaMaxMm: p?.precipitacaoHorariaMaxMm ?? null,
      fontePrecipitacao: p?.fontePrecipitacao || "Indisponível",
      fonteProbabilidade: p?.fonteProbabilidade || "Indisponível",
      janelaModelo: p?.janelaModelo || null,
      referenciaEm: p?.referenciaEm || null,
      referenciaPrecipitacaoEm: p?.referenciaPrecipitacaoEm || null,
      referenciaProbabilidadeEm: p?.referenciaProbabilidadeEm || null,
      resumoInmet: i?.resumo || null,
      tipoDado: p?.tipoDado || "indisponivel",
      medidoEm: p?.medidoEm || null,
    };
  });
  const chuvaPorHora = inmetObservacao?.agregado?.chuvaPorHora || [];

  // Fontes listadas por NOME, sem URL: as chamadas de API carregam a query
  // completa (dezenas de parâmetros) e poluíam o documento sem agregar nada
  // para quem lê o informativo.
  //
  // Separadas em dois grupos para deixar explícito o que entrou na coleta
  // automática e o que ainda depende de conferência humana — a transparência
  // sobre o que NÃO é automatizado é exigência do protocolo original.
  const fontesAutomatizadas = [];
  if (ventoOceanop)
    fontesAutomatizadas.push({
      nome: FONTE_OCEANOP,
      uso: "Rajada prevista (prioritária) no ponto da base",
    });
  if (openMeteo)
    fontesAutomatizadas.push({
      nome: "Open-Meteo — Weather Forecast API",
      uso: "Rajada prevista (contingência do OCEANOP), precipitação prevista e probabilidade de chuva; temperatura, umidade e condição modeladas quando usadas; índice UV modelado",
    });
  if (qualidadeArCams)
    fontesAutomatizadas.push({
      nome: "Open-Meteo Air Quality / CAMS",
      uso: "UV atual, US AQI e concentrações atuais estimadas pelo modelo CAMS/Open-Meteo; classificação interna simplificada em três faixas para o ar",
    });
  if (mar)
    fontesAutomatizadas.push({
      nome: "Open-Meteo Marine",
      uso: `Ondas e mar no ponto marítimo validado: ${mar.referenciaPonto || cidade.pontoMar?.referencia}`,
    });
  if (inmetPrevisao)
    fontesAutomatizadas.push({
      nome: "INMET — Previsão",
      uso: "Condição geral e faixas diárias oficiais de temperatura e umidade; os avisos oficiais permanecem prioritários",
    });
  if (inmetObservacao?.observacao)
    fontesAutomatizadas.push({
      nome: "INMET — Estação Automática",
      uso: `Temperatura, umidade, chuva e vento observados em ${inmetObservacao.observacao.estacao.nome} (${inmetObservacao.observacao.estacao.codigo}); histórico composto somente pelas coletas oficiais armazenadas`,
    });
  if (inmetAvisos)
    fontesAutomatizadas.push({
      nome: "INMET — Avisos de Perigo",
      uso: "Avisos oficiais ativos para o município",
    });
  if (climaSaude.dados)
    fontesAutomatizadas.push({ nome: "Clima e Saúde — Ministério da Saúde", uso: "EHF, risco combinado à saúde e vulnerabilidade social municipal; índice UV não publicado" });

  const fontesManuais = [];
  if (cidade.links?.alertaRio)
    fontesManuais.push({
      nome: "Alerta Rio / Defesa Civil Municipal",
      uso: "Boletins e estágios locais — sem API pública estável",
    });
  if (cidade.links?.corRio)
    fontesManuais.push({
      nome: "COR-Rio",
      uso: "Estágio operacional da cidade — sem API pública estável",
    });
  if (cidade.links?.codesal)
    fontesManuais.push({
      nome: "CODESAL",
      uso: "Defesa Civil de Salvador — sem API pública estável",
    });

  // Mantido para compatibilidade com o rodapé do PDF, que cita as fontes
  // principais em uma linha só.
  const fontes = [...fontesAutomatizadas, ...fontesManuais];

  // Visão completa e explícita da coleta. Antes a tela mostrava somente as
  // fontes que responderam e uma lista solta de avisos; agora cada integração
  // aparece mesmo quando está indisponível, não configurada ou não se aplica
  // à base selecionada.
  const checkedAt = dataNow.toISOString();
  const erroFonte = (erro) => {
    if (erro instanceof Error) return erro;
    const convertido = new Error(String(erro || "Fonte indisponível"));
    convertido.code = "SOURCE_UNAVAILABLE";
    return convertido;
  };
  const healthDaColeta = (source, ok, erro, mensagem) => ok
    ? operacional(source, mensagem, { checkedAt })
    : indisponivel(source, erroFonte(erro), "Não foi possível atualizar esta fonte.", { checkedAt });

  const healthClimaSaude = climaSaude.status === "operacional"
    ? operacional("Clima e Saúde — Ministério da Saúde", climaSaude.mensagem, {
      checkedAt,
      lastSuccessAt: climaSaude.dados?.consultadoEm || checkedAt,
    })
    : criarHealthCheck("Clima e Saúde — Ministério da Saúde", climaSaude.status, {
      checkedAt,
      lastSuccessAt: climaSaude.lastSuccessAt || climaSaude.dados?.consultadoEm || null,
      message: climaSaude.mensagem,
      errorCode: climaSaude.status === "armazenado" ? "CACHE_ONLY" : "SOURCE_UNAVAILABLE",
    });

  for (const evento of severidade.eventos) {
    if (evento.fonteDados) continue;
    if (evento.tipo === "avisoInmet") evento.fonteDados = "INMET — aviso oficial";
    else if (evento.assinatura === "vento") evento.fonteDados = integrado.fontesPorCampo.rajadaMaxKmh;
    else if (evento.assinatura === "chuva") evento.fonteDados = [
      integrado.fontesPorCampo.precipitacaoHorariaMaxMm,
      integrado.fontesPorCampo.precipitacaoTotalMm,
    ].filter(Boolean).join(" / ");
    else {
      const campo = {
        calorExtremo: "tempMax",
        baixaUmidade: "umidadeMin",
        marGrosso: "mar.alturaMaxDiaM",
        marModerado: "mar.alturaMaxDiaM",
        uvAlto: "ar.uvMax",
        qualidadeArRuim: "ar.usAqi",
      }[evento.tipo];
      const fonte = integrado.fontesPorCampo[campo];
      if (fonte && fonte !== "Indisponível") evento.fonteDados = fonte;
      else if ({
        calorExtremo: /calor/i,
        baixaUmidade: /baixa umidade/i,
        marGrosso: /ressaca|agitação marítima/i,
      }[evento.tipo]?.test(avisosInmet.map((aviso) => aviso.descricao).join(" "))) {
        evento.fonteDados = "INMET — aviso oficial";
      }
    }
  }
  const monitoramentoApis = [
    paraMonitoramento("open-meteo", "Open-Meteo — Weather Forecast API",
      healthOpenMeteo),
    paraMonitoramento("oceanop", FONTE_OCEANOP, healthOceanop),
    paraMonitoramento("open-meteo-air", "Open-Meteo Air Quality / CAMS", healthQualidadeAr),
    paraMonitoramento("monitorar-mma", "MonitorAr — MMA", naoConfigurada("MonitorAr — MMA", "O MonitorAr disponibiliza consulta pública em painel, mas o projeto não tem uma API de integração autorizada configurada.")),
    paraMonitoramento("inmet-previsao", "INMET — Previsão",
      healthDaColeta("INMET — Previsão", Boolean(inmetPrevisao), falhasApi.inmetPrevisao, "Previsão oficial recebida")),
    paraMonitoramento("inmet-observacao", "INMET — Observação meteorológica",
      criarHealthCheck("INMET — Observação meteorológica", inmetObservacao?.status || "indisponivel", {
        checkedAt,
        lastSuccessAt: inmetObservacao?.observacao?.medidoEm || null,
        message: inmetObservacao?.mensagem || "Observação indisponível.",
        errorCode: inmetObservacao?.erro?.tipo || null,
      })),
    paraMonitoramento("inmet-avisos", "INMET — Avisos",
      healthDaColeta("INMET — Avisos", Boolean(inmetAvisos), falhasApi.inmetAvisos, `${avisosInmet.length} aviso(s) vigente(s) para a base`)),
    paraMonitoramento("open-meteo-marine", "Open-Meteo Marine", healthMarine),
    paraMonitoramento("clima-saude", "Clima e Saúde — Ministério da Saúde", healthClimaSaude),
  ];

  const relatorio = {
    snapshotId: `${cidade.chave}:${dataNow.toISOString()}`,
    cidade: { chave: cidade.chave, nome: cidade.nome, uf: cidade.uf, fuso: cidade.fusoHorario || "America/Sao_Paulo" },
    nomeArquivoBase: `Informativo_Meteorologico_${slugCidade(cidade.nome)}_${new Intl.DateTimeFormat("en-CA", {
      timeZone: cidade.fusoHorario || "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
    }).format(dataNow)}`,
    dataFormatadaLonga: new Intl.DateTimeFormat("pt-BR", {
      dateStyle: "full",
      timeZone: "America/Sao_Paulo",
    }).format(dataNow),
    dataFormatadaCurta: new Intl.DateTimeFormat("pt-BR", {
      dateStyle: "short",
      timeZone: "America/Sao_Paulo",
    }).format(dataNow),
    horaConsulta: new Intl.DateTimeFormat("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      timeZone: "America/Sao_Paulo",
    }).format(dataNow),
    condicaoGeral: base.condicaoGeral || "Condição indisponível",
    temTempestadeHoje: base.temTempestadeHoje,
    atual: base.atual ?? null,
    fontesPorCampo: integrado.fontesPorCampo,
    tempMin: base.tempMin,
    tempMax: base.tempMax,
    umidadeMin: base.umidadeMin,
    umidadeMax: base.umidadeMax,
    temperaturaObservadaMinC: base.temperaturaObservadaMinC,
    temperaturaObservadaMaxC: base.temperaturaObservadaMaxC,
    umidadeObservadaMinPct: base.umidadeObservadaMinPct,
    umidadeObservadaMaxPct: base.umidadeObservadaMaxPct,
    coberturaTemperaturaObservada: base.coberturaTemperaturaObservada,
    coberturaUmidadeObservada: base.coberturaUmidadeObservada,
    precipitacaoHorariaMaxMm: base.precipitacaoHorariaMaxMm,
    precipitacaoTotalMm: base.precipitacaoTotalMm,
    precipitacaoJanelaMm: base.precipitacaoJanelaMm ?? null,
    probabilidadeChuvaPrevista: probabilidadeChuvaEdicao.valor,
    probabilidadeChuvaDiariaPct: base.probabilidadeChuvaMax ?? null,
    probabilidadeChuvaJanela: probabilidadeChuvaEdicao.janela,
    probabilidadeChuvaRegra: probabilidadeChuvaEdicao.regra,
    precipitacaoDiariaMm: base.precipitacaoDiariaMm ?? null,
    precipitacaoAcumuladaEstimadaMm: base.precipitacaoAcumuladaEstimadaMm ?? null,
    precipitacaoAcumuladaEstimadaStatus: base.precipitacaoAcumuladaEstimadaStatus,
    precipitacaoAcumuladaEstimadaJanela: base.precipitacaoAcumuladaEstimadaJanela,
    precipitacaoAcumuladaEstimadaCobertura: base.precipitacaoAcumuladaEstimadaCobertura,
    precipitacaoAcumuladaEstimadaMotivo: base.precipitacaoAcumuladaEstimadaMotivo,
    chuvaEstimadaDiaMm: chuvaEstimada?.diaMm ?? null,
    chuvaEstimadaHoraMm: chuvaEstimada?.ultimaHoraMm ?? null,
    chuvaEstimada24hMm: chuvaEstimada?.ultimas24hMm ?? null,
    chuvaEstimadaReferencia: chuvaEstimada?.referenciaEm ?? null,
    chuvaEstimadaHoraReferencia: chuvaEstimada?.ultimaHoraReferencia ?? null,
    coberturaChuvaEstimadaDia: chuvaEstimada?.coberturaDia ?? null,
    coberturaChuvaEstimada24h: chuvaEstimada?.cobertura24h ?? null,
    chuvaEstimadaMotivoIndisponibilidade: chuvaEstimada?.motivoIndisponibilidade ?? null,
    precipitacaoPrevistaDiaMm: base.precipitacaoPrevistaDiaMm ?? null,
    precipitacaoHoraMm: base.precipitacaoHoraMm ?? null,
    precipitacaoHoraReferencia: base.precipitacaoHoraReferencia ?? null,
    precipitacaoHoraMedidaEm: base.precipitacaoHoraMedidaEm ?? null,
    precipitacaoUltimas24hMm: base.precipitacaoUltimas24hMm ?? null,
    precipitacaoPeriodoMm: base.precipitacaoPeriodoMm ?? null,
    rajadaMaxKmh: base.rajadaMaxKmh,
    rajadaPrevistaKmh: base.rajadaMaxKmh,
    rajadaPrevistaReferencia: base.rajadaPrioritariaReferencia || null,
    rajadaObservadaMaxKmh: base.rajadaObservadaMaxKmh,
    tabelaTemperaturaUmidade,
    ventoPorPeriodo,
    chuvaPorPeriodo,
    chuvaPorHora,
    inmetObservacao,
    coberturaObservacoesInmet: base.coberturaObservacoesInmet,
    coberturaChuva24h: base.coberturaChuva24h,
    coberturaChuvaPeriodo: base.coberturaChuvaPeriodo,
    metadadosMeteorologicos: metadadosMeteorologicos({
      cidade,
      climaSaude,
      inmetObservacao,
      inmetPrevisao,
      openMeteo,
      base,
      fontesPorCampo: integrado.fontesPorCampo,
      rajadaPrioritaria: base.rajadaPrioritariaReferencia || null,
      geradoEm: dataNow.toISOString(),
    }),
    mar,
    qualidadeAr,
    indiceUv: Number.isFinite(qualidadeAr?.uvAtual) ? {
      status: "operacional",
      valorAtual: qualidadeAr.uvAtual,
      maximoPrevisto: qualidadeAr.uvMax,
      classificacao: qualidadeAr.uvClassificacao?.nivel || null,
      fonte: qualidadeAr.fonteUv || qualidadeAr.fonte,
      municipio: cidade.nome,
      uf: cidade.uf,
      referenciaEm: qualidadeAr.referenciaEm || null,
      maximoPrevistoEm: qualidadeAr.horaPicoUv || null,
      periodo: "atual modelado",
      consultadoEm: dataNow.toISOString(),
    } : {
      status: "indisponivel", valorAtual: null, maximoPrevisto: Number.isFinite(openMeteo?.uvMax) ? openMeteo.uvMax : null,
      fonte: "Open-Meteo Air Quality — UV atual", municipio: cidade.nome, uf: cidade.uf,
      referenciaEm: null, consultadoEm: dataNow.toISOString(),
      motivoIndisponibilidade: falhasApi.qualidadeAr?.message || "UV atual não publicado pela Air Quality API nesta coleta.",
    },
    eventoMaisRelevante,
    severidade,
    avisosInmet,
    // "indisponivel" quando a coleta de avisos falhou — o painel informa a
    // indisponibilidade em vez de exibir "nenhum aviso".
    avisosInmetStatus: inmetAvisos ? "operacional" : "indisponivel",
    linkInmet: cidade.links?.inmet || null,
    divergencias,
    avisosColeta,
    diagnosticosFallback,
    deslocamento,
    edificacao,
    fontes,
    fontesAutomatizadas,
    fontesManuais,
    monitoramentoApis,
    climaSaude,
    inmetPrevisao,
    openMeteo,
    chuvaDiaria: null,
    contextoMeteorologicoSetor,
    previsaoOpenMeteoDias: openMeteo?.previsaoDias || [],
    previsaoOceanopDias,
    geradoEmISO: dataNow.toISOString(),
    horarioAgendado,
    tipoDocumento: tipoDocumentoPorHorario(horarioAgendado),
    previsaoAte: janelaEdicao?.previsaoAte || null,
    periodoCoberto: janelaEdicao?.periodo || null,
    validadeInformativo: validadeInformativo(horarioAgendado, dataNow),
    previsaoDias: horarioAgendado && (openMeteo || inmetPrevisao) ? [{
      ...(openMeteo?.previsaoDias?.[0] || {}),
      data: openMeteo?.dataReferencia || (inmetPrevisao?.dias || []).find((dia) => dia.dataBr === inmetPrevisao?.data)?.data || null,
      tempMin: base.tempMin,
      tempMax: base.tempMax,
      umidadeMin: base.umidadeMin,
      umidadeMax: base.umidadeMax,
      chuvaMm: base.precipitacaoTotalMm,
      probabilidadeChuvaPct: probabilidadeChuvaEdicao.valor,
      rajadaKmh: base.rajadaMaxKmh,
      condicao: base.condicaoGeral,
      janela: janelaEdicao?.periodo || "Hoje",
      periodo: `Hoje (${janelaEdicao?.periodo || "dia civil"})`,
    }] : null,
  };
  if (horarioAgendado) relatorio.horaConsulta = horarioAgendado;
  relatorio.indicadoresSnapshot = criarIndicadoresSnapshot(relatorio);
  relatorio.classificacaoDados = classificarDadosRelatorio(relatorio);
  validarDadosRelatorio(relatorio);
  relatorio.ocorrencias = montarOcorrencias(relatorio);
  return registrarDocumentoOperacional(relatorio);
}

module.exports = { montarRelatorio, montarVentoPorPeriodo, probabilidadeChuvaDaEdicao, PERIODO_COBERTO_AGENDADO };
