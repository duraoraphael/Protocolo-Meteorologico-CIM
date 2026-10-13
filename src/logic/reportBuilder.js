const { buscarPacoteWindy } = require('../sources/windy');
const { integrarWindy } = require('./windyMerge');
const { buscarOpenMeteo, INICIO_JANELA_HOJE, PERIODOS: PERIODOS_HOJE } = require("../sources/openMeteo");
const { buscarPrevisaoInmet, buscarAvisosInmet, deduplicarAvisosInmet } = require("../sources/inmet");
const { montarOcorrencias } = require("./ocorrenciasPainel");
const { tipoDocumentoPorHorario } = require("./alertPresentation");
const { aplicarPoliticaFontes } = require("./weatherSourcePolicy");
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

const JANELAS_EDICAO = Object.freeze({
  "05:00": Object.freeze({ inicioHora: 5, fimHora: 15, previsaoAte: "15h", periodo: "hoje, das 05h até 15h" }),
  "15:00": Object.freeze({ inicioHora: 15, fimHora: 24, previsaoAte: "00h", periodo: "hoje, das 15h até 00h do dia seguinte" }),
});
const PERIODO_COBERTO_AGENDADO = "definido pela edição do informativo";
function intervaloAvisos(horarioAgendado, instante) {
  const janela = JANELAS_EDICAO[horarioAgendado];
  if (!janela) return { inicioPeriodo: instante, fimPeriodo: null };
  const data = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(instante);
  const inicioPeriodo = new Date(`${data}T${String(janela.inicioHora).padStart(2, "0")}:00:00-03:00`);
  const fimPeriodo = janela.fimHora === 24
    ? new Date(new Date(`${data}T00:00:00-03:00`).getTime() + 24 * 60 * 60 * 1000)
    : new Date(`${data}T${String(janela.fimHora).padStart(2, "0")}:00:00-03:00`);
  return { inicioPeriodo, fimPeriodo };
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

/**
 * Monta o objeto de dados completo do informativo para uma cidade cadastrada
 * em src/config/cities.js. Não lança em caso de falha parcial de uma fonte —
 * cada fonte que falhar é sinalizada em `avisosColeta` e o restante segue.
 */
async function montarRelatorio(cidade, { horarioAgendado = null, atualizarClimaSaude = false } = {}) {
  const dataNow = agora();
  const avisosColeta = [];
  const falhasApi = {};
  const windyPromise = buscarPacoteWindy(cidade);
  const climaSaudePromise = (horarioAgendado || atualizarClimaSaude)
    ? climaSaudeService.consultar(cidade)
    : Promise.resolve(climaSaudeService.lerArmazenado(cidade));
  let openMeteo, inmetPrevisao, inmetAvisos;

  const janelaEdicao = JANELAS_EDICAO[horarioAgendado] || null;
  try {
    openMeteo = await buscarOpenMeteo(cidade.latitude, cidade.longitude, {
      inicioHora: janelaEdicao?.inicioHora ?? INICIO_JANELA_HOJE,
      fimHora: janelaEdicao?.fimHora ?? 24,
      fuso: cidade.fusoHorario || "America/Sao_Paulo",
      ...(horarioAgendado ? { agregarJanela: true } : {}),
    });
  } catch (erro) {
    falhasApi.openMeteo = erro;
    registrarFalha("OPEN-METEO", erro);
    avisosColeta.push("Open-Meteo: não foi possível atualizar esta fonte.");
  }

  try {
    inmetPrevisao = await buscarPrevisaoInmet(cidade.codigoIbge);
  } catch (erro) {
    falhasApi.inmetPrevisao = erro;
    registrarFalha("INMET-PREVISAO", erro);
    avisosColeta.push("INMET — Previsão: não foi possível atualizar esta fonte.");
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

  // Qualidade do ar e índice UV: relevantes em todas as bases (exposição de
  // equipes em trabalho externo e qualidade do ar respirável).
  let qualidadeAr = null;
  try {
    qualidadeAr = await buscarQualidadeAr(cidade.latitude, cidade.longitude);
  } catch (erro) {
    falhasApi.airQuality = erro;
    registrarFalha("OPEN-METEO-AIR-QUALITY", erro);
    avisosColeta.push("Open-Meteo Air Quality: não foi possível atualizar esta fonte.");
  }

  const windy = await windyPromise;
  let climaSaude;
  try { climaSaude = await climaSaudePromise; }
  catch (erro) {
    registrarFalha(`CLIMA-SAÚDE:${cidade.chave}`, erro);
    climaSaude = { status: "indisponivel", mensagem: "Clima e Saúde: dados indisponíveis nesta atualização.", dados: null };
  }
  avisosColeta.push(...windy.avisos);
  if (horarioAgendado && !openMeteo) {
    throw new Error("Previsão horária e dos dias seguintes indisponível para a janela do relatório agendado.");
  }
  if (!openMeteo && !inmetPrevisao && windy.weather?.tempMax == null) {
    throw new Error(
      "Nenhuma fonte meteorológica respondeu (Windy, Open-Meteo e INMET indisponíveis). Verifique a conexão com a internet e tente novamente."
    );
  }

  // Open-Meteo é a base numérica primária (dados horários granulares);
  // INMET entra como validação oficial cruzada e fonte de avisos.
  let base = openMeteo || {
    condicaoGeral: inmetPrevisao?.periodos?.tarde?.resumo || "Indisponível",
    tempMin: inmetPrevisao?.periodos?.manha?.tempMin ?? null,
    tempMax: inmetPrevisao?.periodos?.tarde?.tempMax ?? null,
    umidadeMin: inmetPrevisao?.periodos?.tarde?.umidadeMin ?? null,
    umidadeMax: inmetPrevisao?.periodos?.manha?.umidadeMax ?? null,
    precipitacaoTotalMm: null,
    precipitacaoHorariaMaxMm: null,
    probabilidadeChuvaMax: null,
    rajadaMaxKmh: null,
    temTempestadeHoje: false,
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
  const integrado = integrarWindy(base, mar, qualidadeAr, windy, openMeteo ? 'Open-Meteo' : inmetPrevisao ? 'INMET' : 'Indisponível');
  ({ base, mar, qualidadeAr } = integrado);
  const marAtualParaRisco = mar;
  if (!mar && marArmazenado) {
    mar = marArmazenado;
    integrado.fontesPorCampo["mar.alturaMaxDiaM"] = "Open-Meteo Marine — dado armazenado";
    integrado.fontesPorCampo["mar.temperaturaMarC"] = mar.temperaturaMarC != null
      ? "Open-Meteo Marine — dado armazenado"
      : "Indisponível";
  }
  if (horarioAgendado) {
    for (const campo of ["condicaoGeral", "precipitacaoTotalMm", "precipitacaoHorariaMaxMm", "probabilidadeChuvaMax", "temTempestadeHoje"]) {
      base[campo] = openMeteo[campo];
      integrado.fontesPorCampo[campo] = "Open-Meteo";
    }
    base.periodos = openMeteo.periodos;
    for (const chave of ["manha", "tarde", "noite"]) {
      for (const campo of ["precipitacaoMm", "probabilidadeChuva", "precipitacaoHorariaMaxMm"]) {
        integrado.fontesPorCampo[`periodos.${chave}.${campo}`] = "Open-Meteo";
      }
    }
  }

  // Matriz campo a campo: Clima Saúde e INMET mantêm prioridade; somente o
  // indicador ausente usa Open-Meteo, com motivo registrado no diagnóstico.
  const { climaAtual, diagnosticos: diagnosticosFallback } = aplicarPoliticaFontes({
    base,
    openMeteo,
    inmetPrevisao,
    climaSaude,
    fontesPorCampo: integrado.fontesPorCampo,
    agora: dataNow,
  });
  for (const chave of ["manha", "tarde", "noite"]) {
    const p = base.periodos[chave];
    const oficial = inmetPrevisao?.periodos?.[chave];
    if (oficial) {
      p.direcao = oficial.direcaoVento || "—";
      p.intensidadeVento = oficial.intensidadeVento || "—";
    }
  }
  if (mar && cidade.pontoMar?.referencia) mar.referenciaPonto = cidade.pontoMar.referencia;
  // Repetições do mesmo aviso já saem da coleta; avisos distintos do mesmo
  // fenômeno permanecem separados (PDF e e-mail consolidam na renderização).
  const avisosInmet = deduplicarAvisosInmet(inmetAvisos?.avisos || []);

  const { eventoMaisRelevante, categoriasAtivas, severidade } = avaliarRiscos({
    tempMax: base.tempMax,
    umidadeMin: base.umidadeMin,
    rajadaMaxKmh: base.rajadaMaxKmh,
    probabilidadeChuvaMax: base.probabilidadeChuvaMax,
    precipitacaoHorariaMaxMm: base.precipitacaoHorariaMaxMm,
    precipitacaoTotalMm: base.precipitacaoTotalMm,
    temTempestadeHoje: base.temTempestadeHoje,
    periodos: base.periodos,
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
    tempMin: base.tempMin,
    tempMax: base.tempMax,
    umidadeMin: base.umidadeMin,
    umidadeMax: base.umidadeMax,
  }];

  // Mesmos três períodos (e janelas) no painel e nos PDFs das 05h e 15h.
  const chavesPeriodo = ["manha", "tarde", "noite"].filter((k) => base.periodos[k]?.disponivel !== false);
  const ventoPorPeriodo = chavesPeriodo.map((k) => {
    const p = base.periodos[k];
    const i = inmetPrevisao?.periodos[k];
    return {
      periodo: p.periodo,
      janela: p.janela || janelaPeriodo(k),
      direcao: p.direcao,
      // Vento (velocidade sustentada) e rajada são grandezas distintas.
      intensidade: p.intensidadeVento,
      velocidadeMaxKmh: p.velocidadeMaxKmh ?? null,
      rajadaMaxKmh: p.rajadaMaxKmh,
      referenciaInmet: i ? `${i.direcaoVento || "—"} / ${i.intensidadeVento || "—"}` : null,
    };
  });

  const chuvaPorPeriodo = ["manha", "tarde", "noite"].map((k) => {
    const p = openMeteo?.periodosDiaCompleto?.[k] || base.periodos[k];
    const i = inmetPrevisao?.periodos[k];
    const precipitacaoOficial = Number.isFinite(i?.precipitacaoMm) ? i.precipitacaoMm : null;
    const precipitacaoMm = precipitacaoOficial ?? p?.precipitacaoMm ?? null;
    integrado.fontesPorCampo[`periodos.${k}.precipitacaoMm`] = precipitacaoOficial !== null
      ? "INMET — previsão oficial"
      : Number.isFinite(precipitacaoMm) ? "Open-Meteo" : "Indisponível";
    return {
      periodo: p?.periodo || PERIODOS_HOJE[k].label,
      janela: p?.janela || janelaPeriodo(k),
      probabilidade: p?.probabilidadeChuva ?? null,
      precipitacaoMm,
      precipitacaoHorariaMaxMm: p?.precipitacaoHorariaMaxMm ?? null,
      resumoInmet: i?.resumo || null,
    };
  });
  const chuvaPorHora = openMeteo?.chuvaHoraria || [];

  // Fontes listadas por NOME, sem URL: as chamadas de API carregam a query
  // completa (dezenas de parâmetros) e poluíam o documento sem agregar nada
  // para quem lê o informativo.
  //
  // Separadas em dois grupos para deixar explícito o que entrou na coleta
  // automática e o que ainda depende de conferência humana — a transparência
  // sobre o que NÃO é automatizado é exigência do protocolo original.
  const fontesAutomatizadas = [];
  for (const [grupo, dados] of Object.entries(windy)) if (dados?.fonte) fontesAutomatizadas.push({ nome: dados.fonte, uso: ({weather:'Previsão meteorológica normalizada; valores ausentes usam a fonte alternativa',sea:'Ondas e marulho',air:'PM2,5 e AQI US; UV preservado na fonte Open-Meteo'})[grupo] });
  if (openMeteo)
    fontesAutomatizadas.push({
      nome: "Open-Meteo",
      uso: "Alternativa numérica por indicador para temperatura, umidade, rajada e precipitação quando a fonte prioritária não publica o campo; não determina alertas oficiais",
    });
  if (inmetPrevisao)
    fontesAutomatizadas.push({
      nome: "INMET — Previsão",
      uso: "Previsão oficial municipal; direção e intensidade do vento em faixas textuais e demais campos efetivamente publicados",
    });
  if (inmetAvisos)
    fontesAutomatizadas.push({
      nome: "INMET — Avisos de Perigo",
      uso: "Avisos oficiais ativos para o município",
    });
  if (marOpenMeteo)
    fontesAutomatizadas.push({
      nome: "Open-Meteo Marine",
      uso: `Ondas, marulho e temperatura da superfície do mar${mar.referenciaPonto ? ` (ponto de referência: ${mar.referenciaPonto})` : ""}`,
    });
  if (arOpenMeteo)
    fontesAutomatizadas.push({
      nome: "Open-Meteo Air Quality",
      uso: "Material particulado (PM2,5 e PM10) e índice UV",
    });
  if (climaSaude.dados)
    fontesAutomatizadas.push({ nome: "Clima e Saúde — Ministério da Saúde", uso: "EHF, risco combinado à saúde e vulnerabilidade social municipal" });

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
  const windyConfigurado = Boolean(process.env.WINDY_API_KEY?.trim());
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
    if (evento.tipo === "raios" && evento.fonteDados?.startsWith("Previsão horária")) {
      evento.fonteDados = openMeteo?.temTempestadeHoje
        ? "Open-Meteo — código de trovoada"
        : windy.weather?.temTempestadeHoje
          ? `${windy.weather.fonte} — código de trovoada`
          : evento.fonteDados;
    }
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
        qualidadeArRuim: "ar.pm25Medio",
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
    paraMonitoramento("windy-weather", "Windy Point — Meteorologia", windyConfigurado
      ? healthDaColeta("Windy Point — Meteorologia", Boolean(windy.weather), windy.falhas?.weather, `${windy.weather?.amostras ?? 0} amostras recebidas`)
      : naoConfigurada("Windy Point — Meteorologia", "WINDY_API_KEY não configurada.")),
    paraMonitoramento("windy-air", "Windy Point — Qualidade do ar", windyConfigurado
      ? healthDaColeta("Windy Point — Qualidade do ar", Boolean(windy.air), windy.falhas?.air, `${windy.air?.amostras ?? 0} amostras recebidas`)
      : naoConfigurada("Windy Point — Qualidade do ar", "WINDY_API_KEY não configurada.")),
    paraMonitoramento("windy-sea", "Windy Point — Ondas", !cidade.costeira
      ? naoAplicavel("Windy Point — Ondas", "Base não costeira.")
      : windyConfigurado
        ? healthDaColeta("Windy Point — Ondas", Boolean(windy.sea), windy.falhas?.sea, `${windy.sea?.amostras ?? 0} amostras recebidas`)
        : naoConfigurada("Windy Point — Ondas", "WINDY_API_KEY não configurada.")),
    paraMonitoramento("open-meteo", "Open-Meteo — Meteorologia",
      healthDaColeta("Open-Meteo — Meteorologia", Boolean(openMeteo), falhasApi.openMeteo, "Previsão e condição atual recebidas")),
    paraMonitoramento("inmet-previsao", "INMET — Previsão",
      healthDaColeta("INMET — Previsão", Boolean(inmetPrevisao), falhasApi.inmetPrevisao, "Previsão oficial recebida")),
    paraMonitoramento("inmet-avisos", "INMET — Avisos",
      healthDaColeta("INMET — Avisos", Boolean(inmetAvisos), falhasApi.inmetAvisos, `${inmetAvisos?.avisos?.length ?? 0} aviso(s) para a base`)),
    paraMonitoramento("open-meteo-marine", "Open-Meteo Marine", healthMarine),
    paraMonitoramento("open-meteo-air", "Open-Meteo Air Quality",
      healthDaColeta("Open-Meteo Air Quality", Boolean(arOpenMeteo), falhasApi.airQuality, "Qualidade do ar e UV recebidos")),
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
      timeZone: "America/Sao_Paulo",
    }).format(dataNow),
    condicaoGeral: base.condicaoGeral,
    atual: integrado.atual ?? null,
    fontesPorCampo: integrado.fontesPorCampo,
    tempMin: base.tempMin,
    tempMax: base.tempMax,
    umidadeMin: base.umidadeMin,
    umidadeMax: base.umidadeMax,
    precipitacaoHorariaMaxMm: base.precipitacaoHorariaMaxMm,
    precipitacaoTotalMm: base.precipitacaoTotalMm,
    precipitacaoDiariaMm: base.precipitacaoDiariaMm ?? null,
    rajadaMaxKmh: base.rajadaMaxKmh,
    tabelaTemperaturaUmidade,
    ventoPorPeriodo,
    chuvaPorPeriodo,
    chuvaPorHora,
    mar,
    qualidadeAr,
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
    geradoEmISO: dataNow.toISOString(),
    horarioAgendado,
    tipoDocumento: tipoDocumentoPorHorario(horarioAgendado),
    previsaoAte: janelaEdicao?.previsaoAte || null,
    periodoCoberto: janelaEdicao?.periodo || null,
    // Só hoje: chuva e rajada na janela 05h–00h (as mesmas dos períodos acima).
    previsaoDias: horarioAgendado ? openMeteo.previsaoDias.slice(0, 1).map((dia) => ({
      ...dia,
      janela: openMeteo.janelaHoje.rotulo,
      tempMin: base.tempMin,
      tempMax: base.tempMax,
      chuvaMm: base.precipitacaoTotalMm,
      rajadaKmh: base.rajadaMaxKmh,
      periodo: `Hoje (${openMeteo.janelaHoje.rotulo})`,
    })) : null,
  };
  if (horarioAgendado) relatorio.horaConsulta = horarioAgendado;
  relatorio.ocorrencias = montarOcorrencias(relatorio);
  return relatorio;
}

module.exports = { montarRelatorio, PERIODO_COBERTO_AGENDADO };
