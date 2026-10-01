const { buscarPacoteWindy } = require('../sources/windy');
const { integrarWindy } = require('./windyMerge');
const { buscarOpenMeteo } = require("../sources/openMeteo");
const { buscarPrevisaoInmet, buscarAvisosInmet, deduplicarAvisosInmet } = require("../sources/inmet");
const { montarOcorrencias } = require("./ocorrenciasPainel");
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

function slugCidade(nome) {
  return nome
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "");
}

function detectarDivergencias(openMeteo, inmet) {
  const divergencias = [];
  const diffMax = Math.abs(openMeteo.tempMax - (inmet.periodos.tarde?.tempMax ?? openMeteo.tempMax));
  const diffMin = Math.abs(openMeteo.tempMin - (inmet.periodos.manha?.tempMin ?? openMeteo.tempMin));

  if (diffMax >= 3) {
    divergencias.push(
      `Divergência de temperatura máxima entre Open-Meteo (${openMeteo.tempMax}°C) e INMET (${inmet.periodos.tarde?.tempMax ?? "—"}°C).`
    );
  }
  if (diffMin >= 3) {
    divergencias.push(
      `Divergência de temperatura mínima entre Open-Meteo (${openMeteo.tempMin}°C) e INMET (${inmet.periodos.manha?.tempMin ?? "—"}°C).`
    );
  }

  const resumoInmet = [inmet.periodos.manha, inmet.periodos.tarde, inmet.periodos.noite]
    .map((p) => p?.resumo || "")
    .join(" ")
    .toLowerCase();
  const mencionaChuvaInmet = /chuva|pancada|tempestade|garoa/.test(resumoInmet);
  const mencionaChuvaOpenMeteo = openMeteo.probabilidadeChuvaMax >= 30;

  if (mencionaChuvaInmet !== mencionaChuvaOpenMeteo) {
    divergencias.push(
      "As fontes divergem quanto à indicação de chuva relevante para o dia — considerado o cenário mais conservador (maior risco) para fins de planejamento de segurança."
    );
  }

  return divergencias;
}

/**
 * Monta o objeto de dados completo do informativo para uma cidade cadastrada
 * em src/config/cities.js. Não lança em caso de falha parcial de uma fonte —
 * cada fonte que falhar é sinalizada em `avisosColeta` e o restante segue.
 */
async function montarRelatorio(cidade, { horarioAgendado = null, atualizarClimaSaude = false } = {}) {
  const avisosColeta = [];
  const falhasApi = {};
  const windyPromise = buscarPacoteWindy(cidade);
  const climaSaudePromise = (horarioAgendado || atualizarClimaSaude)
    ? climaSaudeService.consultar(cidade)
    : Promise.resolve(climaSaudeService.lerArmazenado(cidade));
  let openMeteo, inmetPrevisao, inmetAvisos;

  try {
    openMeteo = await buscarOpenMeteo(
      cidade.latitude,
      cidade.longitude,
      horarioAgendado ? { inicioHora: horarioAgendado === "15:00" ? 15 : 5, diasPrevisao: horarioAgendado === "15:00" ? 2 : 4 } : undefined
    );
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
    inmetAvisos = await buscarAvisosInmet(cidade.codigoIbge);
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
      manha: { periodo: "Manhã", direcao: inmetPrevisao?.periodos?.manha?.direcaoVento || "—", intensidadeVento: inmetPrevisao?.periodos?.manha?.intensidadeVento || "—", rajadaMaxKmh: null, probabilidadeChuva: null, precipitacaoMm: null, tempestade: false },
      tarde: { periodo: "Tarde", direcao: inmetPrevisao?.periodos?.tarde?.direcaoVento || "—", intensidadeVento: inmetPrevisao?.periodos?.tarde?.intensidadeVento || "—", rajadaMaxKmh: null, probabilidadeChuva: null, precipitacaoMm: null, tempestade: false },
      noite: { periodo: "Noite", direcao: inmetPrevisao?.periodos?.noite?.direcaoVento || "—", intensidadeVento: inmetPrevisao?.periodos?.noite?.intensidadeVento || "—", rajadaMaxKmh: null, probabilidadeChuva: null, precipitacaoMm: null, tempestade: false },
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
    // O Windy resume o dia inteiro; nesta versão só a série horária filtrada
    // da Open-Meteo representa corretamente 05/15h até a meia-noite.
    for (const campo of ["condicaoGeral", "tempMin", "tempMax", "umidadeMin", "umidadeMax", "rajadaMaxKmh", "precipitacaoTotalMm", "precipitacaoHorariaMaxMm", "probabilidadeChuvaMax", "temTempestadeHoje"]) {
      base[campo] = openMeteo[campo];
      integrado.fontesPorCampo[campo] = "Open-Meteo";
    }
    base.periodos = openMeteo.periodos;
    for (const chave of ["manha", "tarde", "noite"]) {
      for (const campo of ["rajadaMaxKmh", "precipitacaoMm", "probabilidadeChuva", "precipitacaoHorariaMaxMm"]) {
        integrado.fontesPorCampo[`periodos.${chave}.${campo}`] = "Open-Meteo";
      }
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

  const divergencias =
    openMeteo && inmetPrevisao ? detectarDivergencias(openMeteo, inmetPrevisao) : [];

  const dataNow = agora();
  const tabelaTemperaturaUmidade = [];
  if (windy.weather && !horarioAgendado) tabelaTemperaturaUmidade.push({ fonte: windy.weather.fonte, tempMin: windy.weather.tempMin, tempMax: windy.weather.tempMax, umidadeMin: windy.weather.umidadeMin, umidadeMax: windy.weather.umidadeMax });
  if (openMeteo) {
    tabelaTemperaturaUmidade.push({
      fonte: "Open-Meteo",
      tempMin: openMeteo.tempMin,
      tempMax: openMeteo.tempMax,
      umidadeMin: openMeteo.umidadeMin,
      umidadeMax: openMeteo.umidadeMax,
    });
  }
  if (inmetPrevisao) {
    tabelaTemperaturaUmidade.push({
      fonte: "INMET",
      tempMin: inmetPrevisao?.periodos?.manha?.tempMin ?? "—",
      tempMax: inmetPrevisao?.periodos?.tarde?.tempMax ?? "—",
      umidadeMin: inmetPrevisao?.periodos?.tarde?.umidadeMin ?? "—",
      umidadeMax: inmetPrevisao?.periodos?.manha?.umidadeMax ?? "—",
    });
  }

  const chavesPeriodo = horarioAgendado === "15:00" ? ["tarde", "noite"] : ["manha", "tarde", "noite"];
  const ventoPorPeriodo = chavesPeriodo.map((k) => {
    const p = base.periodos[k];
    const i = inmetPrevisao?.periodos[k];
    return {
      periodo: p.periodo,
      direcao: p.direcao,
      intensidade: p.intensidadeVento,
      rajadaMaxKmh: p.rajadaMaxKmh,
      referenciaInmet: i ? `${i.direcaoVento || "—"} / ${i.intensidadeVento || "—"}` : null,
    };
  });

  const chuvaPorPeriodo = chavesPeriodo.map((k) => {
    const p = base.periodos[k];
    const i = inmetPrevisao?.periodos[k];
    return {
      periodo: p.periodo,
      probabilidade: p.probabilidadeChuva,
      precipitacaoMm: p.precipitacaoMm,
      precipitacaoHorariaMaxMm: p.precipitacaoHorariaMaxMm,
      resumoInmet: i?.resumo || null,
    };
  });

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
      uso: "Previsão numérica: temperatura, umidade, vento e chuva por período",
    });
  if (inmetPrevisao)
    fontesAutomatizadas.push({
      nome: "INMET — Previsão",
      uso: "Previsão oficial do município (validação cruzada)",
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
    cidade: { chave: cidade.chave, nome: cidade.nome, uf: cidade.uf },
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
    rajadaMaxKmh: base.rajadaMaxKmh,
    tabelaTemperaturaUmidade,
    ventoPorPeriodo,
    chuvaPorPeriodo,
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
    deslocamento,
    edificacao,
    fontes,
    fontesAutomatizadas,
    fontesManuais,
    monitoramentoApis,
    climaSaude,
    geradoEmISO: dataNow.toISOString(),
    horarioAgendado,
    periodoCoberto: horarioAgendado === "05:00"
      ? "Hoje, das 05:00 até 00:00, mais os três dias seguintes"
      : horarioAgendado === "15:00"
        ? "Hoje, das 15:00 até 00:00, mais o dia seguinte"
        : null,
    previsaoDias: horarioAgendado ? openMeteo.previsaoDias.map((dia, i) => i === 0
      ? { ...dia, chuvaMm: base.precipitacaoTotalMm, rajadaKmh: base.rajadaMaxKmh, periodo: horarioAgendado === "15:00" ? "Hoje (15:00–00:00)" : "Hoje (05:00–00:00)" }
      : { ...dia, periodo: i === 1 ? "Amanhã" : `Dia +${i}` }) : null,
  };
  relatorio.ocorrencias = montarOcorrencias(relatorio);
  return relatorio;
}

module.exports = { montarRelatorio };
