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
const { buscarOpenMeteo } = require("../sources/openMeteo");
const { buscarQualidadeAr } = require("../sources/airQuality");
const { buscarMarComFallback } = require("../sources/marine");
const { montarOcorrencias } = require("./ocorrenciasPainel");
const { tipoDocumentoPorHorario } = require("./alertPresentation");
const { edicaoInformativo, intervaloAvisos, validadeInformativo, partesNoFuso } = require("./informativoValidity");
const { aplicarPoliticaFontes } = require("./weatherSourcePolicy");
const { metadadosMeteorologicos } = require("./weatherSourceMetadata");
const { classificarDadosRelatorio, validarDadosRelatorio } = require("./meteorologicalValidity");
const { montarContextoMeteorologicoSetor } = require("./sectorWeatherContext");
const {
  buscarOceanopPorCoordenadas,
  mapearOceanopParaVento,
  mapearOceanopParaProximosDias,
  FONTE: FONTE_OCEANOP,
} = require("../sources/oceanop");
const climaSaudeService = require("../sources/climaSaudeService");
const oceanopPontos = require("../config/oceanopPontos");
const rajadaPortais = require("../config/rajadaPortais");
const {
  buscarRajadasTetraTech,
  selecionarMaximaJanela,
  FONTE: FONTE_TETRATECH,
} = require("../sources/tetratechGusts");
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
  "08:00": Object.freeze({ inicioHora: 8, fimHora: 24, janela: "08h–00h" }),
  "09:00": Object.freeze({ inicioHora: 9, fimHora: 24, janela: "09h–00h" }),
  "12:00": Object.freeze({ inicioHora: 12, fimHora: 24, janela: "12h–00h" }),
  "15:00": Object.freeze({ inicioHora: 15, fimHora: 24, janela: "15h–00h" }),
  "17:00": Object.freeze({ inicioHora: 17, fimHora: 24, janela: "17h–00h" }),
  "20:00": Object.freeze({ inicioHora: 20, fimHora: 24, janela: "20h–00h" }),
});

// Janela operacional específica solicitada para rajadas OCEANOP. O texto
// editorial "Previsão até 00h" permanece inalterado no e-mail/PDF.
function janelaOceanopDaEdicao(horarioAgendado) {
  if (horarioAgendado === "08:00") return { inicioHora: 8, fimHora: 15, rotulo: "08h–15h" };
  if (horarioAgendado === "15:00") return { inicioHora: 15, fimHora: 24, rotulo: "15h–00h" };
  const edicao = edicaoInformativo(horarioAgendado);
  return { inicioHora: edicao?.inicioHora ?? 5, fimHora: edicao?.fimPrevisaoHora ?? 24, rotulo: edicao?.periodo || "05h–00h" };
}

function probabilidadeChuvaDaEdicao({ horarioAgendado, openMeteo } = {}) {
  const janela = JANELAS_PROBABILIDADE_EDICAO[horarioAgendado];
  const resultadoBase = {
    valor: null,
    fonte: "Indisponível",
    janela: janela?.janela || null,
    regra: "probabilidade máxima prevista no período",
  };
  if (Number.isFinite(openMeteo?.probabilidadeChuvaMax)) {
    return { ...resultadoBase, valor: openMeteo.probabilidadeChuvaMax, fonte: "Open-Meteo — previsão meteorológica", janela: janela?.janela || openMeteo.janelaHoje?.rotulo || null };
  }
  if (!janela) return resultadoBase;

  const candidatos = [];
  for (const [chave, periodo] of Object.entries(PERIODOS_HOJE)) {
    const inicio = Math.max(janela.inicioHora, periodo.horaInicio);
    const fim = Math.min(janela.fimHora, periodo.horaFim);
    if (inicio >= fim) continue;

    const cobrePeriodoCompleto = inicio === periodo.horaInicio && fim === periodo.horaFim;
    const valorOpenMeteo = openMeteo?.periodos?.[chave]?.probabilidadeChuva;
    if (cobrePeriodoCompleto && Number.isFinite(valorOpenMeteo)) {
      candidatos.push({ valor: valorOpenMeteo, fonte: "Open-Meteo — previsão meteorológica" });
      continue;
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
        rajadaPrevistaEm: p.rajadaPrevistaEm || null,
        fonteRajada: p.fonteRajada || (p.fonteOceanop ? FONTE_OCEANOP : (Number.isFinite(p.rajadaMaxKmh) ? "Open-Meteo — previsão meteorológica" : null)),
        tipoDado: p.tipoDado || "indisponivel",
        referenciaInmet: p.fonteRajada || p.fonteOceanop
          ? `${p.fonteRajada || FONTE_OCEANOP} · ${p.localRajada || p.localOceanop || "área homologada"}${p.periodoReferenciaRajada || p.periodoReferenciaOceanop ? ` · ${p.periodoReferenciaRajada || p.periodoReferenciaOceanop}` : ""}`
          : Number.isFinite(p.rajadaMaxKmh) ? "Open-Meteo · previsão de rajada a 10 m" : "Open-Meteo · vento médio e direção; rajada prevista indisponível",
      };
    });
}

/**
 * Monta o objeto de dados completo do informativo para uma cidade cadastrada
 * em src/config/cities.js. Não lança em caso de falha parcial de uma fonte —
 * cada fonte que falhar é sinalizada em `avisosColeta` e o restante segue.
 */
async function montarRelatorio(cidade, { horarioAgendado = null, atualizarClimaSaude = false, dependencias = {} } = {}) {
  const dataNow = agora();
  const avisosColeta = [];
  const falhasApi = {};
  const consultarPrevisaoInmet = dependencias.buscarPrevisaoInmet || buscarPrevisaoInmet;
  const consultarAvisosInmet = dependencias.buscarAvisosInmet || buscarAvisosInmet;
  const consultarObservacaoInmet = dependencias.buscarObservacaoInmet || buscarObservacaoInmet;
  const consultarOpenMeteo = dependencias.buscarOpenMeteo || buscarOpenMeteo;
  const consultarQualidadeAr = dependencias.buscarQualidadeAr || buscarQualidadeAr;
  const consultarMar = dependencias.buscarMarComFallback || buscarMarComFallback;
  const consultarOceanop = dependencias.buscarOceanopPorCoordenadas || buscarOceanopPorCoordenadas;
  const consultarRajadasTetraTech = dependencias.buscarRajadasTetraTech || buscarRajadasTetraTech;
  const consultarClimaSaude = dependencias.consultarClimaSaude || ((base) => climaSaudeService.consultar(base));
  const lerClimaSaudeArmazenado = dependencias.lerClimaSaudeArmazenado || ((base) => climaSaudeService.lerArmazenado(base));
  const climaSaudePromise = (horarioAgendado || atualizarClimaSaude)
    ? consultarClimaSaude(cidade)
    : Promise.resolve(lerClimaSaudeArmazenado(cidade));
  let inmetPrevisao, inmetAvisos, inmetObservacao, openMeteo, qualidadeArCams;
  const motivoArSemLicenca = "Licença comercial da fonte de estimativa não configurada; não há leitura oficial atual integrada para esta base.";
  let healthQualidadeAr = naoConfigurada("Open-Meteo Air Quality / CAMS", motivoArSemLicenca);

  const janelaEdicao = edicaoInformativo(horarioAgendado);

  try {
    inmetPrevisao = await consultarPrevisaoInmet(cidade.codigoIbge);
  } catch (erro) {
    falhasApi.inmetPrevisao = erro;
    registrarFalha("INMET-PREVISAO", erro);
    avisosColeta.push("INMET — Previsão: não foi possível atualizar esta fonte.");
  }

  try {
    qualidadeArCams = await consultarQualidadeAr(cidade, { now: dataNow });
    healthQualidadeAr = operacional("Open-Meteo Air Quality / CAMS", "Índice US AQI e concentrações modeladas recebidos.", {
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
      agora: () => dataNow,
    });
  } catch (erro) {
    falhasApi.openMeteo = erro;
    registrarFalha("OPEN-METEO", erro);
    avisosColeta.push("Open-Meteo: previsão meteorológica e índice UV indisponíveis nesta atualização.");
  }

  // Pico diário de rajada publicado no portal Tetra Tech/OCEANOP. O acesso
  // usa exclusivamente a API oficial consumida pelo próprio portal. Aracaju
  // Araucária permanece desabilitada por não constar nas tabelas fornecidas.
  const portalRajada = rajadaPortais[cidade.chave];
  const nomePortalRajada = FONTE_TETRATECH;
  let resultadoRajadaPortal = null;
  let picoRajadaPortalHoje = null;
  let previsaoRajadaPortalDias = [];
  let healthRajadaPortal = !portalRajada
    ? naoAplicavel(nomePortalRajada, "Base sem portal de rajada cadastrado.")
    : !portalRajada.habilitado
      ? naoConfigurada(nomePortalRajada, portalRajada.motivo || "Coleta automatizada não habilitada.")
      : naoAplicavel(nomePortalRajada, "Área configurada, aguardando consulta.");
  if (portalRajada?.habilitado && portalRajada.fonte === "tetratech") {
    try {
      resultadoRajadaPortal = await consultarRajadasTetraTech(cidade.nome, portalRajada);
      const partesHoje = partesNoFuso(dataNow, portalRajada.fusoHorario);
      const dataHoje = `${partesHoje.year}-${String(partesHoje.month).padStart(2, "0")}-${String(partesHoje.day).padStart(2, "0")}`;
      const picoDiarioHoje = resultadoRajadaPortal.picosDiarios.find((item) => item.data === dataHoje) || null;
      const janelaRajada = janelaOceanopDaEdicao(horarioAgendado);
      picoRajadaPortalHoje = horarioAgendado
        ? selecionarMaximaJanela(resultadoRajadaPortal.registros, dataHoje, janelaRajada.inicioHora, janelaRajada.fimHora)
        : picoDiarioHoje;
      if (!picoRajadaPortalHoje) {
        avisosColeta.push(`Tetra Tech: Rajada prevista indisponível para ${dataHoje} na janela ${janelaRajada.rotulo}.`);
      }
      previsaoRajadaPortalDias = resultadoRajadaPortal.desatualizado ? [] : resultadoRajadaPortal.picosDiarios.map((item) => ({
        data: item.data,
        rajadaMaxKmh: item.rajadaPrevistaKmH,
        rajadaPrevistaEm: item.picoEm,
        local: item.area,
        fonte: item.fonte,
        rajadaOriginal: item.rajadaOriginal,
        unidadeOriginal: item.unidadeOriginal,
      }));
      if (resultadoRajadaPortal.desatualizado) {
        healthRajadaPortal = degradado(FONTE_TETRATECH, resultadoRajadaPortal.erroAtual,
          resultadoRajadaPortal.consultadoEm, { checkedAt: dataNow.toISOString() });
        avisosColeta.push("Tetra Tech/OCEANOP: utilizando o último boletim válido armazenado para a data correspondente.");
      } else {
        healthRajadaPortal = operacional(FONTE_TETRATECH, "Picos diários de rajada recebidos da API oficial do portal.", {
          checkedAt: dataNow.toISOString(),
          lastSuccessAt: resultadoRajadaPortal.consultadoEm,
        });
      }
    } catch (erro) {
      registrarFalha("TETRATECH-OCEANOP", erro);
      healthRajadaPortal = erro?.code === "TETRATECH_CREDENTIALS_MISSING"
        ? naoConfigurada(FONTE_TETRATECH, "Configure X-API-Key ou credencial OAuth oficialmente autorizada.")
        : indisponivel(FONTE_TETRATECH, erro);
      avisosColeta.push("Tetra Tech/OCEANOP: Rajada prevista indisponível.");
    }
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

  // Mar usa exclusivamente o ponto marítimo cadastrado da Open-Meteo Marine.
  let mar = null;
  let resultadoOceanop = null;
  let ventoOceanop = null;
  let previsaoOceanopDias = [];
  let healthMarine = naoAplicavel("Open-Meteo Marine", "Base interior; produto oceanográfico não se aplica.");
  if (cidade.costeira) {
    const resultadoMar = await consultarMar(cidade);
    mar = resultadoMar.dados;
    healthMarine = resultadoMar.health;
    if (!mar) avisosColeta.push("Open-Meteo Marine: condições marítimas indisponíveis para o ponto validado da base.");
  }
  const pontoOceanop = oceanopPontos[cidade.chave];
  let healthOceanop = Number.isFinite(picoRajadaPortalHoje?.rajadaPrevistaKmH) && !resultadoRajadaPortal?.desatualizado
    ? naoAplicavel("Oceanop / Petrobras", "Rajada atendida pelo portal Tetra Tech autorizado.")
    : !pontoOceanop?.habilitado
    ? naoConfigurada("Oceanop / Petrobras", "Área OCEANOP homologada ainda não vinculada a esta base.")
    : naoAplicavel("Oceanop / Petrobras", "Área configurada, aguardando consulta.");
  if ((!Number.isFinite(picoRajadaPortalHoje?.rajadaPrevistaKmH) || resultadoRajadaPortal?.desatualizado) && pontoOceanop?.habilitado) {
    try {
      resultadoOceanop = await consultarOceanop(pontoOceanop);
      let erroProduto = null;
      if (pontoOceanop.usarVento === true) {
        try {
          const janelaOceanop = janelaOceanopDaEdicao(horarioAgendado);
          ventoOceanop = mapearOceanopParaVento(resultadoOceanop, pontoOceanop, {
            agora: dataNow,
            inicioHora: janelaOceanop.inicioHora,
            fimHora: janelaOceanop.fimHora,
          });
          previsaoOceanopDias = mapearOceanopParaProximosDias(resultadoOceanop, pontoOceanop, { agora: dataNow });
        } catch (erro) { erroProduto = erro; }
      }
      if (!ventoOceanop) throw erroProduto || new Error("OCEANOP: nenhum produto de rajada homologado para esta área.");
      healthOceanop = operacional("Oceanop / Petrobras", "Previsão oficial da área homologada recebida e validada.", {
        checkedAt: dataNow.toISOString(),
        lastSuccessAt: resultadoOceanop.consultadoEm,
      });
    } catch (erro) {
      registrarFalha("OCEANOP", erro);
      healthOceanop = indisponivel("Oceanop / Petrobras", erro);
      avisosColeta.push("Oceanop / Petrobras: informação indisponível para esta base; não houve substituição por fonte não autorizada.");
    }
  }
  let qualidadeAr = {
    ...(qualidadeArCams || {}),
    ...(openMeteo ? {
      uvMax: openMeteo.uvMax,
      uvClassificacao: openMeteo.uvClassificacao,
      horaPicoUv: openMeteo.horaPicoUv,
      fonteUv: "Open-Meteo — previsão meteorológica",
    } : {}),
    fonte: qualidadeArCams?.fonte || "Open-Meteo — previsão meteorológica",
  };

  if (qualidadeAr && !Number.isFinite(qualidadeAr.iqar)) qualidadeAr.motivoIndisponibilidade = healthQualidadeAr.message;

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
    cidade,
    openMeteo,
    inmetObservacao,
    fontesPorCampo: integrado.fontesPorCampo,
  });
  if (ventoOceanop) {
    for (const chave of ["manha", "tarde", "noite"]) {
      const periodo = base.periodos?.[chave];
      const complemento = ventoOceanop[chave];
      if (!periodo || !complemento) continue;
      let utilizou = false;
      // Para rajada prevista, OCEANOP é prioritária quando a área e a janela
      // estão homologadas. As demais grandezas apenas completam ausências.
      if (Number.isFinite(complemento.rajadaMaxKmh)) {
        periodo.rajadaMaxKmh = complemento.rajadaMaxKmh;
        periodo.rajadaPrevistaEm = complemento.rajadaPrevistaEm;
        periodo.periodoReferenciaOceanop = complemento.periodoReferencia;
        periodo.localOceanop = complemento.local;
        integrado.fontesPorCampo[`periodos.${chave}.rajadaMaxKmh`] = FONTE_OCEANOP;
        utilizou = true;
      }
      periodo.fonteOceanop = utilizou;
    }
    if (Number.isFinite(ventoOceanop.resumo?.rajadaMaxKmh)) {
      base.rajadaMaxKmh = ventoOceanop.resumo.rajadaMaxKmh;
      base.rajadaOceanopReferencia = ventoOceanop.resumo;
      integrado.fontesPorCampo.rajadaMaxKmh = FONTE_OCEANOP;
      integrado.fontesPorCampo.rajadaPrevistaKmh = FONTE_OCEANOP;
    }
  }
  if (resultadoRajadaPortal?.registros?.length && !resultadoRajadaPortal.desatualizado) {
    const partesHoje = partesNoFuso(dataNow, portalRajada.fusoHorario);
    const dataHoje = `${partesHoje.year}-${String(partesHoje.month).padStart(2, "0")}-${String(partesHoje.day).padStart(2, "0")}`;
    for (const [chave, janela] of Object.entries(PERIODOS_HOJE)) {
      const pico = selecionarMaximaJanela(resultadoRajadaPortal.registros, dataHoje, janela.horaInicio, janela.horaFim);
      if (!pico || !base.periodos?.[chave]) continue;
      const periodo = base.periodos[chave];
      periodo.rajadaMaxKmh = pico.rajadaPrevistaKmH;
      periodo.rajadaPrevistaEm = pico.picoEm;
      periodo.fonteRajada = FONTE_TETRATECH;
      periodo.localRajada = pico.area;
      periodo.periodoReferenciaRajada = pico.janela;
      integrado.fontesPorCampo[`periodos.${chave}.rajadaMaxKmh`] = FONTE_TETRATECH;
    }
  }
  // O pico diário do portal é prioritário no card/resumo de rajada, mas não é
  // copiado para períodos sem comprovação do horário dentro daquela janela.
  if (!resultadoRajadaPortal?.desatualizado && Number.isFinite(picoRajadaPortalHoje?.rajadaPrevistaKmH)) {
    base.rajadaMaxKmh = picoRajadaPortalHoje.rajadaPrevistaKmH;
    base.rajadaPrioritariaReferencia = {
      fonte: picoRajadaPortalHoje.fonte,
      rajadaMaxKmh: picoRajadaPortalHoje.rajadaPrevistaKmH,
      rajadaPrevistaEm: picoRajadaPortalHoje.picoEm,
      periodoReferencia: picoRajadaPortalHoje.janela || `pico diário de ${picoRajadaPortalHoje.data}`,
      local: picoRajadaPortalHoje.area,
      dataEscrita: picoRajadaPortalHoje.atualizadoEm,
      rajadaOriginal: picoRajadaPortalHoje.rajadaOriginal,
      unidadeOriginal: picoRajadaPortalHoje.unidadeOriginal,
    };
    integrado.fontesPorCampo.rajadaMaxKmh = FONTE_TETRATECH;
    integrado.fontesPorCampo.rajadaPrevistaKmh = FONTE_TETRATECH;
  }
  integrado.atual = base.atual;
  const probabilidadeChuvaEdicao = probabilidadeChuvaDaEdicao({ horarioAgendado, openMeteo });
  integrado.fontesPorCampo.probabilidadeChuvaPrevista = probabilidadeChuvaEdicao.fonte;
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
    chuvaPrevistaDiaMm: openMeteo?.precipitacaoDiariaMm ?? null,
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
  const tabelaTemperaturaUmidade = [{
    fonte: fontesTabelaTemperatura.join(" / ") || "Indisponível",
    natureza: "Observação do dia civil local (cobertura parcial quando indicada)",
    tempMin: base.tempMin,
    tempMax: base.tempMax,
    umidadeMin: base.umidadeMin,
    umidadeMax: base.umidadeMax,
  }];
  // No PDF das duas edições, o vento cobre sempre o dia operacional inteiro
  // (05h–00h); apenas os cards consolidados permanecem limitados à edição.
  const periodosTabela = Object.fromEntries(["manha", "tarde", "noite"].map((chave) => {
    const edicao = base.periodos[chave] || {};
    const dia = openMeteo?.periodosDiaCompleto?.[chave] || {};
    const rajadaPrioritaria = Number.isFinite(edicao.rajadaMaxKmh) && (edicao.fonteRajada || edicao.fonteOceanop);
    return [chave, {
      ...edicao, ...dia,
      rajadaMaxKmh: rajadaPrioritaria ? edicao.rajadaMaxKmh : Number.isFinite(dia.rajadaMaxKmh) ? dia.rajadaMaxKmh : edicao.rajadaMaxKmh,
      fonteRajada: edicao.fonteRajada,
      fonteOceanop: edicao.fonteOceanop,
      localRajada: edicao.localRajada,
      localOceanop: edicao.localOceanop,
      periodoReferenciaRajada: edicao.periodoReferenciaRajada,
      periodoReferenciaOceanop: edicao.periodoReferenciaOceanop,
      rajadaPrevistaEm: rajadaPrioritaria ? edicao.rajadaPrevistaEm : null,
      disponivel: dia.disponivel || edicao.disponivel,
    }];
  }));
  const ventoPorPeriodo = montarVentoPorPeriodo({ base: { ...base, periodos: periodosTabela } });

  const chuvaPorPeriodo = ["manha", "tarde", "noite"].map((k) => {
    const p = openMeteo?.periodosDiaCompleto?.[k] || base.periodos[k];
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
  const chuvaPorHora = inmetObservacao?.status === "operacional" && !inmetObservacao.observacao?.desatualizado
    ? inmetObservacao.agregado?.chuvaPorHora || [] : [];

  // Fontes listadas por NOME, sem URL: as chamadas de API carregam a query
  // completa (dezenas de parâmetros) e poluíam o documento sem agregar nada
  // para quem lê o informativo.
  //
  // Separadas em dois grupos para deixar explícito o que entrou na coleta
  // automática e o que ainda depende de conferência humana — a transparência
  // sobre o que NÃO é automatizado é exigência do protocolo original.
  const fontesAutomatizadas = [];
  if (openMeteo)
    fontesAutomatizadas.push({
      nome: "Open-Meteo — Weather Forecast API",
      uso: "Condição, chuva, probabilidade, vento médio, direção e índice UV previstos",
    });
  if (qualidadeArCams)
    fontesAutomatizadas.push({
      nome: "Open-Meteo Air Quality / CAMS",
      uso: "Estimativa modelada; índice US AQI e concentrações de PM2,5/PM10, não medição oficial",
    });
  if (mar)
    fontesAutomatizadas.push({
      nome: "Open-Meteo Marine",
      uso: `Ondas e mar no ponto marítimo validado: ${mar.referenciaPonto || cidade.pontoMar?.referencia}`,
    });
  if (inmetPrevisao)
    fontesAutomatizadas.push({
      nome: "INMET — Previsão",
      uso: "Contexto textual oficial municipal; os avisos oficiais permanecem prioritários",
    });
  if (inmetObservacao?.status === "operacional" && !inmetObservacao.observacao?.desatualizado)
    fontesAutomatizadas.push({
      nome: "INMET — Estação Automática",
      uso: `Temperatura, umidade, chuva e vento observados em ${inmetObservacao.observacao.estacao.nome} (${inmetObservacao.observacao.estacao.codigo}); histórico composto somente pelas coletas oficiais armazenadas`,
    });
  if (inmetAvisos)
    fontesAutomatizadas.push({
      nome: "INMET — Avisos de Perigo",
      uso: "Avisos oficiais ativos para o município",
    });
  if (resultadoOceanop && ventoOceanop)
    fontesAutomatizadas.push({
      nome: FONTE_OCEANOP,
      uso: "Rajada prevista por coordenada para base sem tabela terrestre Tetra Tech",
    });
  if (resultadoRajadaPortal && picoRajadaPortalHoje)
    fontesAutomatizadas.push({
      nome: FONTE_TETRATECH,
      uso: `Pico diário de rajada previsto em ${picoRajadaPortalHoje.area}, convertido de nós para km/h`,
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
        qualidadeArRuim: "ar.iqar",
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
      healthDaColeta("Open-Meteo — Weather Forecast API", Boolean(openMeteo), falhasApi.openMeteo, "Previsão meteorológica e UV recebidos")),
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
    paraMonitoramento("oceanop", "Oceanop / Petrobras", healthOceanop),
    paraMonitoramento("tetratech-oceanop", nomePortalRajada, healthRajadaPortal),
    paraMonitoramento("clima-saude", "Clima e Saúde — Ministério da Saúde", healthClimaSaude),
  ];

  const previsaoHojeInmet = (inmetPrevisao?.dias || []).find((dia) => dia.dataBr === inmetPrevisao.data);
  const relatorio = {
    cidade: { chave: cidade.chave, nome: cidade.nome, uf: cidade.uf, latitude: cidade.latitude,
      longitude: cidade.longitude, fuso: cidade.fusoHorario || "America/Sao_Paulo" },
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
    condicaoGeral: base.condicaoGeral || "Condição indisponível",
    temTempestadeHoje: base.temTempestadeHoje,
    atual: base.atual ?? null,
    fontesPorCampo: integrado.fontesPorCampo,
    tempMin: base.tempMin,
    tempMax: base.tempMax,
    umidadeMin: base.umidadeMin,
    umidadeMax: base.umidadeMax,
    temperaturaAtualC: base.temperaturaAtualC,
    umidadeAtualPct: base.umidadeAtualPct,
    temperaturaObservadaMinC: base.temperaturaObservadaMinC,
    temperaturaObservadaMaxC: base.temperaturaObservadaMaxC,
    umidadeObservadaMinPct: base.umidadeObservadaMinPct,
    umidadeObservadaMaxPct: base.umidadeObservadaMaxPct,
    coberturaTemperaturaObservada: base.coberturaTemperaturaObservada,
    coberturaUmidadeObservada: base.coberturaUmidadeObservada,
    precipitacaoHorariaMaxMm: base.precipitacaoHorariaMaxMm,
    precipitacaoTotalMm: base.precipitacaoTotalMm,
    chuvaPrevistaDiaMm: Number.isFinite(openMeteo?.precipitacaoDiariaMm) ? openMeteo.precipitacaoDiariaMm : null,
    probabilidadeChuvaPrevista: probabilidadeChuvaEdicao.valor,
    probabilidadeChuvaJanela: probabilidadeChuvaEdicao.janela,
    probabilidadeChuvaRegra: probabilidadeChuvaEdicao.regra,
    precipitacaoDiariaMm: base.precipitacaoDiariaMm ?? null,
    precipitacaoHoraMm: base.precipitacaoHoraMm ?? null,
    precipitacaoHoraReferencia: base.precipitacaoHoraReferencia ?? null,
    precipitacaoHoraMedidaEm: base.precipitacaoHoraMedidaEm ?? null,
    precipitacaoUltimas24hMm: base.precipitacaoUltimas24hMm ?? null,
    chuvaEstimadaDiaMm: base.chuvaEstimadaDiaMm,
    chuvaEstimadaHoraMm: base.chuvaEstimadaHoraMm,
    chuvaEstimada24hMm: base.chuvaEstimada24hMm,
    chuvaEstimadaReferencia: base.chuvaEstimadaReferencia,
    chuvaEstimadaHoraReferencia: base.chuvaEstimadaHoraReferencia,
    coberturaChuvaEstimadaDia: base.coberturaChuvaEstimadaDia,
    coberturaChuvaEstimada24h: base.coberturaChuvaEstimada24h,
    chuvaEstimadaMotivoIndisponibilidade: base.chuvaEstimadaMotivoIndisponibilidade,
    precipitacaoPeriodoMm: base.precipitacaoPeriodoMm ?? null,
    rajadaMaxKmh: base.rajadaMaxKmh,
    rajadaPrevistaKmh: base.rajadaMaxKmh,
    rajadaPrevistaReferencia: base.rajadaPrioritariaReferencia || base.rajadaOceanopReferencia || null,
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
      temperaturaObservada: [base.tempMin, base.tempMax],
      umidadeObservada: [base.umidadeMin, base.umidadeMax],
      coberturaTemperatura: base.coberturaTemperaturaObservada,
      coberturaUmidade: base.coberturaUmidadeObservada,
      rajadaPrioritaria: base.rajadaPrioritariaReferencia || base.rajadaOceanopReferencia || null,
      oceanopVento: ventoOceanop?.resumo || null,
      geradoEm: dataNow.toISOString(),
    }),
    mar,
    qualidadeAr,
    indiceUv: Number.isFinite(qualidadeAr?.uvMax) ? {
      status: "operacional",
      valorAtual: qualidadeAr.uvMax,
      maximoPrevisto: qualidadeAr.uvMax,
      classificacao: qualidadeAr.uvClassificacao?.nivel || null,
      fonte: qualidadeAr.fonteUv || qualidadeAr.fonte,
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
    openMeteo,
    chuvaDiaria: null,
    contextoMeteorologicoSetor,
    previsaoOceanopDias,
    previsaoRajadaPortalDias,
    previsaoOpenMeteoDias: openMeteo?.previsaoDias || [],
    geradoEmISO: dataNow.toISOString(),
    horarioAgendado,
    tipoDocumento: tipoDocumentoPorHorario(horarioAgendado),
    previsaoAte: janelaEdicao?.previsaoAte || null,
    periodoCoberto: janelaEdicao?.periodo || null,
    validadeInformativo: validadeInformativo(horarioAgendado, dataNow),
    previsaoDias: horarioAgendado && (openMeteo || inmetPrevisao) ? [{
      ...(openMeteo?.previsaoDias?.[0] || {}),
      data: openMeteo?.dataReferencia || (inmetPrevisao?.dias || []).find((dia) => dia.dataBr === inmetPrevisao?.data)?.data || null,
      tempMin: previsaoHojeInmet?.tempMin ?? null,
      tempMax: previsaoHojeInmet?.tempMax ?? null,
      umidadeMin: previsaoHojeInmet?.umidadeMin ?? null,
      umidadeMax: previsaoHojeInmet?.umidadeMax ?? null,
      chuvaMm: openMeteo?.precipitacaoDiariaMm ?? null,
      probabilidadeChuvaPct: probabilidadeChuvaEdicao.valor,
      rajadaKmh: base.rajadaMaxKmh,
      condicao: base.condicaoGeral,
      janela: janelaEdicao?.periodo || "Hoje",
      periodo: `Hoje (${janelaEdicao?.periodo || "dia civil"})`,
    }] : null,
  };
  if (horarioAgendado) relatorio.horaConsulta = horarioAgendado;
  relatorio.fontesPorCampo.chuvaPrevistaDiaMm = Number.isFinite(relatorio.chuvaPrevistaDiaMm)
    ? "Open-Meteo — previsão meteorológica" : "Indisponível";
  relatorio.ocorrencias = montarOcorrencias(relatorio);
  relatorio.classificacaoDados = classificarDadosRelatorio(relatorio);
  validarDadosRelatorio(relatorio);
  return registrarDocumentoOperacional(relatorio);
}

module.exports = { montarRelatorio, montarVentoPorPeriodo, probabilidadeChuvaDaEdicao, PERIODO_COBERTO_AGENDADO };
