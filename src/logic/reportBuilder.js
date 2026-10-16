const { mapearFontesDoRelatorio } = require('./sourceProvenance');
const { registrarDocumentoOperacional } = require('./documentProvenance');
const { buscarOpenMeteo, PERIODOS: PERIODOS_HOJE } = require("../sources/openMeteo");
const {
  buscarPrevisaoInmet,
  buscarAvisosInmet,
  deduplicarAvisosInmet,
  selecionarAvisosInmet,
} = require("../sources/inmet");
const { buscarObservacaoInmet } = require("../sources/inmetObservations");
const { montarOcorrencias } = require("./ocorrenciasPainel");
const { tipoDocumentoPorHorario } = require("./alertPresentation");
const { edicaoInformativo, intervaloAvisos, validadeInformativo } = require("./informativoValidity");
const { aplicarPoliticaFontes } = require("./weatherSourcePolicy");
const { metadadosMeteorologicos } = require("./weatherSourceMetadata");
const { montarContextoMeteorologicoSetor } = require("./sectorWeatherContext");
const { buscarMarComFallback } = require("../sources/marine");
const { buscarQualidadeAr } = require("../sources/airQuality");
const { buscarOceanop } = require("../sources/oceanop");
const climaSaudeService = require("../sources/climaSaudeService");
const oceanopAreas = require("../config/oceanopAreas");
const {
  criarHealthCheck,
  operacional,
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
  "05:00": Object.freeze({ inicioHora: 5, fimHora: 15, janela: "05h–15h" }),
  "09:00": Object.freeze({ inicioHora: 9, fimHora: 24, janela: "09h–00h" }),
  "12:00": Object.freeze({ inicioHora: 12, fimHora: 24, janela: "12h–00h" }),
  "15:00": Object.freeze({ inicioHora: 15, fimHora: 24, janela: "15h–00h" }),
  "17:00": Object.freeze({ inicioHora: 17, fimHora: 24, janela: "17h–00h" }),
  "20:00": Object.freeze({ inicioHora: 20, fimHora: 24, janela: "20h–00h" }),
});

function probabilidadeChuvaDaEdicao({ horarioAgendado, inmetPrevisao, openMeteo } = {}) {
  const janela = JANELAS_PROBABILIDADE_EDICAO[horarioAgendado];
  const resultadoBase = {
    valor: null,
    fonte: "Indisponível",
    janela: janela?.janela || null,
    regra: "probabilidade máxima prevista no período",
  };
  if (!janela) return resultadoBase;

  const horasOpenMeteo = Array.isArray(openMeteo?.chuvaHoraria) ? openMeteo.chuvaHoraria : [];
  const maximoOpenMeteo = (inicioHora, fimHora) => {
    const valores = horasOpenMeteo
      .filter((item) => {
        const hora = Number(String(item?.horario || "").slice(0, 2));
        return Number.isFinite(hora) && hora >= inicioHora && hora < fimHora;
      })
      .map((item) => item?.probabilidade)
      .filter(Number.isFinite);
    return valores.length ? Math.max(...valores) : null;
  };

  const candidatos = [];
  for (const [chave, periodo] of Object.entries(PERIODOS_HOJE)) {
    const inicio = Math.max(janela.inicioHora, periodo.horaInicio);
    const fim = Math.min(janela.fimHora, periodo.horaFim);
    if (inicio >= fim) continue;

    const cobrePeriodoCompleto = inicio === periodo.horaInicio && fim === periodo.horaFim;
    const valorInmet = inmetPrevisao?.periodos?.[chave]?.probabilidadeChuva;
    if (cobrePeriodoCompleto && Number.isFinite(valorInmet)) {
      candidatos.push({ valor: valorInmet, fonte: "INMET — previsão oficial" });
      continue;
    }

    const valorOpenMeteo = maximoOpenMeteo(inicio, fim);
    if (Number.isFinite(valorOpenMeteo)) {
      candidatos.push({ valor: valorOpenMeteo, fonte: "Open-Meteo — previsão complementar" });
    }
  }

  if (!candidatos.length) return resultadoBase;
  const valor = Math.max(...candidatos.map((item) => item.valor));
  const fontes = [...new Set(candidatos.filter((item) => item.valor === valor).map((item) => item.fonte))];
  return { ...resultadoBase, valor, fonte: fontes.join(" / ") };
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
    .filter((chave) => periodos?.[chave]?.disponivel !== false)
    .map((chave) => {
      const p = periodos[chave];
      return {
        periodo: p.periodo,
        janela: p.janela || janelaPeriodo(chave),
        direcao: p.direcao || "—",
        intensidade: p.intensidadeVento || "—",
        velocidadeMediaKmh: p.velocidadeMediaKmh ?? null,
        rajadaMaxKmh: p.rajadaMaxKmh ?? null,
        tipoDado: p.tipoDado || "indisponivel",
        referenciaInmet: `Previsão municipal INMET · intensidade oficial: ${p.intensidadeVento && p.intensidadeVento !== "—" ? p.intensidadeVento : "não publicada"}`,
      };
    });
}

/**
 * Monta o objeto de dados completo do informativo para uma cidade cadastrada
 * em src/config/cities.js. Não lança em caso de falha parcial de uma fonte —
 * cada fonte que falhar é sinalizada em `avisosColeta` e o restante segue.
 */
async function montarRelatorio(cidade, { horarioAgendado = null, atualizarClimaSaude = false } = {}) {
  const dataNow = agora();
  const avisosColeta = [];
  const falhasApi = {};
  const climaSaudePromise = (horarioAgendado || atualizarClimaSaude)
    ? climaSaudeService.consultar(cidade)
    : Promise.resolve(climaSaudeService.lerArmazenado(cidade));
  let inmetPrevisao, inmetAvisos, inmetObservacao, openMeteo;

  const janelaEdicao = edicaoInformativo(horarioAgendado);

  try {
    inmetPrevisao = await buscarPrevisaoInmet(cidade.codigoIbge);
  } catch (erro) {
    falhasApi.inmetPrevisao = erro;
    registrarFalha("INMET-PREVISAO", erro);
    avisosColeta.push("INMET — Previsão: não foi possível atualizar esta fonte.");
  }

  try {
    openMeteo = await buscarOpenMeteo(cidade.latitude, cidade.longitude, {
      inicioHora: janelaEdicao?.inicioHora ?? 5,
      fimHora: janelaEdicao?.fimPrevisaoHora ?? 24,
      agregarJanela: Boolean(horarioAgendado),
      fuso: cidade.fusoHorario || "America/Sao_Paulo",
    });
  } catch (erro) {
    falhasApi.openMeteo = erro;
    registrarFalha("OPEN-METEO-WEATHER", erro);
    avisosColeta.push("Open-Meteo Weather: previsão complementar indisponível nesta atualização.");
  }

  inmetObservacao = await buscarObservacaoInmet(cidade, {
    inicioHora: janelaEdicao?.inicioHora ?? 0,
    fimHora: janelaEdicao?.fimPrevisaoHora ?? 24,
  });
  if (inmetObservacao.status !== "operacional") {
    avisosColeta.push(inmetObservacao.mensagem);
  }

  try {
    inmetAvisos = await buscarAvisosInmet(cidade.codigoIbge, {
      agora: dataNow,
      ...intervaloAvisos(horarioAgendado, dataNow),
    });
  } catch (erro) {
    falhasApi.inmetAvisos = erro;
    registrarFalha("INMET-AVISOS", erro);
    avisosColeta.push("INMET — Avisos: não foi possível atualizar esta fonte.");
  }

  // Condições de mar: só para bases costeiras/portuárias/offshore.
  let mar = null;
  let marArmazenado = null;
  let healthMarine = naoAplicavel("Open-Meteo Marine", "Base não costeira.");
  if (cidade.costeira) {
    const resultadoMarine = await buscarMarComFallback(cidade);
    healthMarine = resultadoMarine.health;
    falhasApi.marine = resultadoMarine.erro || null;
    if (resultadoMarine.health.status === "operacional") mar = resultadoMarine.dados;
    else if (resultadoMarine.health.status === "degradado") {
      marArmazenado = resultadoMarine.dados;
      avisosColeta.push("Open-Meteo Marine: consulta atual indisponível; utilizando última coleta válida armazenada.");
    } else {
      avisosColeta.push("Open-Meteo Marine: não foi possível atualizar esta fonte.");
    }
  }

  // Qualidade do ar e índice UV previstos pelo CAMS/Open-Meteo.
  let qualidadeAr = null;
  try {
    qualidadeAr = await buscarQualidadeAr(cidade.latitude, cidade.longitude, {
      fuso: cidade.fusoHorario || "America/Sao_Paulo",
    });
  } catch (erro) {
    falhasApi.airQuality = erro;
    registrarFalha("OPEN-METEO-AIR-QUALITY", erro);
    avisosColeta.push("Open-Meteo Air Quality: não foi possível atualizar esta fonte.");
  }

  let climaSaude;
  try { climaSaude = await climaSaudePromise; }
  catch (erro) {
    registrarFalha(`CLIMA-SAÚDE:${cidade.chave}`, erro);
    climaSaude = { status: "indisponivel", mensagem: "Clima e Saúde: dados indisponíveis nesta atualização.", dados: null };
  }
  if (!inmetPrevisao && !openMeteo && !inmetObservacao?.observacao) {
    throw new Error(
      "INMET e Open-Meteo não retornaram previsão nem observação válida. Verifique a conexão com a internet e tente novamente."
    );
  }

  const contextoMeteorologicoSetor = montarContextoMeteorologicoSetor(cidade, inmetPrevisao);
  const previsaoAtual = inmetPrevisao?.periodos?.tarde || inmetPrevisao?.periodos?.manha || inmetPrevisao?.periodos?.noite;
  let base = {
    condicaoGeral: inmetPrevisao ? contextoMeteorologicoSetor.condicaoGeral : openMeteo?.condicaoGeral || null,
    tempMin: inmetPrevisao?.periodos?.manha?.tempMin ?? null,
    tempMax: inmetPrevisao?.periodos?.tarde?.tempMax ?? null,
    umidadeMin: inmetPrevisao?.periodos?.tarde?.umidadeMin ?? null,
    umidadeMax: inmetPrevisao?.periodos?.manha?.umidadeMax ?? null,
    precipitacaoTotalMm: null,
    precipitacaoHorariaMaxMm: null,
    probabilidadeChuvaMax: null,
    rajadaMaxKmh: null,
    temTempestadeHoje: null,
    atual: {
      condicao: previsaoAtual?.resumo || openMeteo?.atual?.condicao || null,
      codigo: openMeteo?.atual?.codigo ?? null,
      dia: openMeteo?.atual?.dia ?? true,
      previsao: true,
      horario: null,
      temperaturaC: null,
      umidadePct: null,
      fonte: previsaoAtual ? "INMET — previsão oficial" : "Open-Meteo — previsão complementar",
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

  const marOpenMeteo = mar;
  const arOpenMeteo = qualidadeAr;
  const integrado = mapearFontesDoRelatorio(
    base,
    mar,
    qualidadeAr,
    inmetPrevisao ? "INMET — previsão oficial" : openMeteo ? "Open-Meteo — previsão complementar" : "Indisponível"
  );
  ({ base, mar, qualidadeAr } = integrado);
  const marAtualParaRisco = mar;
  if (!mar && marArmazenado) {
    mar = marArmazenado;
    integrado.fontesPorCampo["mar.alturaMaxDiaM"] = "Open-Meteo Marine — dado armazenado";
    integrado.fontesPorCampo["mar.temperaturaMarC"] = mar.temperaturaMarC != null
      ? "Open-Meteo Marine — dado armazenado"
      : "Indisponível";
  }
  // Política campo a campo: chuva, vento e rajada priorizam INMET e usam
  // complemento Open-Meteo identificado; UV e mar ficam nas integrações
  // específicas da Open-Meteo.
  const { diagnosticos: diagnosticosFallback } = aplicarPoliticaFontes({
    base,
    openMeteo,
    inmetPrevisao,
    inmetObservacao,
    fontesPorCampo: integrado.fontesPorCampo,
  });
  integrado.atual = base.atual;
  const probabilidadeChuvaEdicao = probabilidadeChuvaDaEdicao({ horarioAgendado, inmetPrevisao, openMeteo });
  integrado.fontesPorCampo.probabilidadeChuvaPrevista = probabilidadeChuvaEdicao.fonte;
  if (mar && cidade.pontoMar?.referencia) mar.referenciaPonto = cidade.pontoMar.referencia;
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

  // A antiga comparação Open-Meteo × INMET para temperatura/chuva induzia
  // uma falsa equivalência de fontes. Com a matriz atual, cada indicador tem
  // sua origem explícita e não há fusão conservadora entre fornecedores.
  const divergencias = [];

  const fontesTabelaTemperatura = [...new Set([
    integrado.fontesPorCampo.tempMin,
    integrado.fontesPorCampo.tempMax,
    integrado.fontesPorCampo.umidadeMin,
    integrado.fontesPorCampo.umidadeMax,
  ].filter((fonte) => fonte && fonte !== "Indisponível"))];
  const tabelaTemperaturaUmidade = [{
    fonte: fontesTabelaTemperatura.join(" / ") || "Indisponível",
    natureza: "Previsão diária oficial",
    tempMin: base.tempMin,
    tempMax: base.tempMax,
    umidadeMin: base.umidadeMin,
    umidadeMax: base.umidadeMax,
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
  if (inmetPrevisao)
    fontesAutomatizadas.push({
      nome: "INMET — Previsão",
      uso: "Previsão oficial municipal; condição, temperatura e umidade previstas, além de direção e intensidade do vento em faixas textuais",
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
  if (openMeteo)
    fontesAutomatizadas.push({
      nome: "Open-Meteo Weather",
      uso: "Complemento identificado de temperatura/umidade e condição quando ausentes; não preenche chuva, vento ou rajada",
    });
  if (marOpenMeteo)
    fontesAutomatizadas.push({
      nome: "Open-Meteo Marine",
      uso: `Ondas, marulho e temperatura da superfície do mar${mar.referenciaPonto ? ` (ponto de referência: ${mar.referenciaPonto})` : ""}`,
    });
  if (arOpenMeteo)
    fontesAutomatizadas.push({
      nome: "Open-Meteo Air Quality",
      uso: "Material particulado (PM2,5 e PM10), European AQI para PM2,5 e índice UV previsto; dados CAMS distribuídos pela Open-Meteo",
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
  if (cidade.links?.climatempo)
    fontesManuais.push({
      nome: "Climatempo",
      uso: "Cruzamento comercial — sem API pública gratuita",
    });

  const vinculoOceanop = oceanopAreas[cidade.chave];
  const oceanopLocalId = vinculoOceanop?.oceanopLocalId || vinculoOceanop?.local || null;
  let healthOceanop;
  if (!oceanopLocalId) {
    healthOceanop = naoConfigurada("Oceanop / Petrobras", "Local Oceanop ainda não vinculado a esta base.");
  } else {
    try {
      await buscarOceanop(oceanopLocalId);
      healthOceanop = operacional("Oceanop / Petrobras", "Integração Oceanop consultada com sucesso.");
    } catch (erro) {
      registrarFalha("OCEANOP", erro);
      healthOceanop = indisponivel("Oceanop / Petrobras", erro);
      avisosColeta.push("Oceanop / Petrobras: não foi possível atualizar esta fonte.");
    }
  }


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
        qualidadeArRuim: "ar.aqiPm25",
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
    paraMonitoramento("open-meteo-weather", "Open-Meteo Weather",
      healthDaColeta("Open-Meteo Weather", Boolean(openMeteo), falhasApi.openMeteo, "Previsão complementar recebida")),
    paraMonitoramento("open-meteo-marine", "Open-Meteo Marine", healthMarine),
    paraMonitoramento("open-meteo-air", "Open-Meteo Air Quality",
      healthDaColeta("Open-Meteo Air Quality", Boolean(arOpenMeteo), falhasApi.airQuality, "Qualidade do ar e UV previstos recebidos")),
    paraMonitoramento("oceanop", "Oceanop / Petrobras", healthOceanop),
    paraMonitoramento("clima-saude", "Clima e Saúde — Ministério da Saúde", healthClimaSaude),
  ];

  const relatorio = {
    cidade: { chave: cidade.chave, nome: cidade.nome, uf: cidade.uf, fuso: cidade.fusoHorario || "America/Sao_Paulo" },
    nomeArquivoBase: `Informativo_Meteorologico_${slugCidade(cidade.nome)}_${dataNow.toISOString().slice(0, 10)}`,
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
    condicaoGeral: base.condicaoGeral,
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
    probabilidadeChuvaPrevista: probabilidadeChuvaEdicao.valor,
    probabilidadeChuvaJanela: probabilidadeChuvaEdicao.janela,
    probabilidadeChuvaRegra: probabilidadeChuvaEdicao.regra,
    precipitacaoDiariaMm: base.precipitacaoDiariaMm ?? null,
    precipitacaoHoraMm: base.precipitacaoHoraMm ?? null,
    precipitacaoHoraReferencia: base.precipitacaoHoraReferencia ?? null,
    precipitacaoHoraMedidaEm: base.precipitacaoHoraMedidaEm ?? null,
    precipitacaoUltimas24hMm: base.precipitacaoUltimas24hMm ?? null,
    precipitacaoPeriodoMm: base.precipitacaoPeriodoMm ?? null,
    rajadaMaxKmh: base.rajadaMaxKmh,
    rajadaPrevistaKmh: base.rajadaMaxKmh,
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
      geradoEm: dataNow.toISOString(),
    }),
    mar,
    qualidadeAr,
    indiceUv: Number.isFinite(qualidadeAr?.uvMax) ? {
      status: "operacional",
      valorAtual: qualidadeAr.uvMax,
      maximoPrevisto: qualidadeAr.uvMax,
      classificacao: qualidadeAr.uvClassificacao?.nivel || null,
      fonte: qualidadeAr.fonte,
      municipio: cidade.nome,
      uf: cidade.uf,
      referenciaEm: qualidadeAr.horaPicoUv || null,
      periodo: "previsão do dia",
      consultadoEm: dataNow.toISOString(),
    } : climaSaudeService.indiceUvIndisponivel(cidade, dataNow.toISOString()),
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
    contextoMeteorologicoSetor,
    geradoEmISO: dataNow.toISOString(),
    horarioAgendado,
    tipoDocumento: tipoDocumentoPorHorario(horarioAgendado),
    previsaoAte: janelaEdicao?.previsaoAte || null,
    periodoCoberto: janelaEdicao?.periodo || null,
    validadeInformativo: validadeInformativo(horarioAgendado, dataNow),
    previsaoDias: horarioAgendado && (inmetPrevisao || openMeteo) ? [{
      ...(inmetPrevisao?.dias || []).find((dia) => dia.dataBr === inmetPrevisao?.data),
      data: (inmetPrevisao?.dias || []).find((dia) => dia.dataBr === inmetPrevisao?.data)?.data || openMeteo?.dataReferencia,
      tempMin: base.tempMin,
      tempMax: base.tempMax,
      umidadeMin: base.umidadeMin,
      umidadeMax: base.umidadeMax,
      chuvaMm: base.precipitacaoTotalMm,
      rajadaKmh: base.rajadaMaxKmh,
      condicao: base.condicaoGeral,
      janela: janelaEdicao?.periodo || "Hoje",
      periodo: `Hoje (${janelaEdicao?.periodo || "dia civil"})`,
    }] : null,
  };
  if (horarioAgendado) relatorio.horaConsulta = horarioAgendado;
  relatorio.ocorrencias = montarOcorrencias(relatorio);
  return registrarDocumentoOperacional(relatorio);
}

module.exports = { montarRelatorio, montarVentoPorPeriodo, probabilidadeChuvaDaEdicao, PERIODO_COBERTO_AGENDADO };
