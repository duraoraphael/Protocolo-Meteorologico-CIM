// Fonte: Open-Meteo (https://open-meteo.com). Em produção, a licença
// comercial e a chave do endpoint customer-* são obrigatórias. Usada como base numérica (temperatura,
// umidade, vento, probabilidade e volume de chuva) por período do dia.

const WMO_DESCRICOES = {
  0: "Céu limpo",
  1: "Predomínio de sol, poucas nuvens",
  2: "Parcialmente nublado",
  3: "Nublado a encoberto",
  45: "Névoa",
  48: "Névoa com formação de geada",
  51: "Garoa fraca",
  53: "Garoa moderada",
  55: "Garoa intensa",
  56: "Garoa congelante fraca",
  57: "Garoa congelante intensa",
  61: "Chuva fraca",
  63: "Chuva moderada",
  65: "Chuva forte",
  66: "Chuva congelante fraca",
  67: "Chuva congelante forte",
  71: "Neve fraca",
  73: "Neve moderada",
  75: "Neve forte",
  77: "Grãos de neve",
  80: "Pancadas de chuva fracas e isoladas",
  81: "Pancadas de chuva moderadas",
  82: "Pancadas de chuva fortes/violentas",
  85: "Pancadas de neve fracas",
  86: "Pancadas de neve fortes",
  95: "Trovoada",
  96: "Trovoada com granizo fraco",
  99: "Trovoada com granizo forte",
};

const {
  API_TIMEOUT_MS,
  API_TENTATIVAS,
  buscarJsonComRetentativa,
} = require("./httpJsonClient");
const { aplicarConfiguracaoOpenMeteo, removerCredenciaisOpenMeteo } = require("./openMeteoConfig");

const CODIGOS_TEMPESTADE = new Set([95, 96, 99]);
const OPEN_METEO_TIMEOUT_MS = API_TIMEOUT_MS;
const OPEN_METEO_TENTATIVAS = API_TENTATIVAS;

function descreverCodigo(codigo) {
  return WMO_DESCRICOES[codigo] || "Condição indisponível";
}

function direcaoCardinal(graus) {
  if (graus === null || graus === undefined || Number.isNaN(graus)) return "—";
  const pontos = [
    "N", "N-NE", "NE", "E-NE", "E", "E-SE", "SE", "S-SE",
    "S", "S-SW", "SW", "W-SW", "W", "W-NW", "NW", "N-NW",
  ];
  const idx = Math.round(graus / 22.5) % 16;
  return pontos[idx];
}

// Classifica o VENTO (velocidade sustentada a 10 m), nunca a rajada: rajada
// é outra grandeza, exibida na sua própria coluna.
function classificarIntensidadeVento(kmh) {
  if (!Number.isFinite(kmh)) return "Sem dado";
  if (kmh >= 60) return "Muito forte";
  if (kmh >= 40) return "Forte";
  if (kmh >= 20) return "Moderado";
  return "Fraco";
}

// Divide as horas de hoje em três períodos operacionais. São as mesmas
// janelas no painel e nos PDFs das 05h e das 15h (hoje, das 05h até 00h).
const INICIO_JANELA_HOJE = 5;
const PERIODOS = {
  manha: { label: "Manhã", horaInicio: 5, horaFim: 12 },
  tarde: { label: "Tarde", horaInicio: 12, horaFim: 18 },
  noite: { label: "Noite", horaInicio: 18, horaFim: 24 },
};

const hh = (hora) => `${String(hora % 24).padStart(2, "0")}h`;

function resumirPeriodo(horas, chave, { dataReferencia, inicioHora = INICIO_JANELA_HOJE, fimHora = 24 } = {}) {
  const { horaInicio, horaFim } = PERIODOS[chave];
  const inicio = Math.max(horaInicio, inicioHora);
  const fim = Math.min(horaFim, fimHora);
  // Os horários da Open-Meteo vêm no fuso pedido ("AAAA-MM-DDTHH:MM", sem
  // offset): compara-se o texto, sem depender do fuso da máquina.
  const idxs = horas.time
    .map((t, i) => ({ t, i }))
    .filter(({ t }) => {
      const h = Number(t.slice(11, 13));
      return t.slice(0, 10) === dataReferencia && h >= inicio && h < fim;
    })
    .map(({ i }) => i);
  const janela = { inicioHora: inicio, fimHora: fim, janela: `${hh(inicio)}–${hh(fim)}` };

  if (idxs.length === 0) {
    return {
      periodo: PERIODOS[chave].label,
      ...janela,
      direcao: "—",
      intensidadeVento: "Sem dado",
      velocidadeMediaKmh: null,
      velocidadeMaxKmh: null,
      rajadaMaxKmh: null,
      probabilidadeChuva: null,
      precipitacaoMm: null,
      precipitacaoHorariaMaxMm: null,
      tempestade: false,
      disponivel: false,
    };
  }

  const serie = (campo) => idxs.map((i) => horas[campo]?.[i]);
  const completa = (campo) => {
    const valores = serie(campo);
    return valores.length === idxs.length && valores.every(Number.isFinite) ? valores : null;
  };
  const velocidades = completa("wind_speed_10m");
  const rajadas = completa("wind_gusts_10m");
  const direcoes = completa("wind_direction_10m");
  const probs = completa("precipitation_probability");
  const precs = completa("precipitation");
  const codigos = serie("weather_code").filter(Number.isFinite);

  const velocidadeMediaKmh = velocidades
    ? velocidades.reduce((a, b) => a + b, 0) / velocidades.length
    : null;
  const velocidadeMaxKmh = velocidades ? Math.max(...velocidades) : null;
  const rajadaMaxKmh = rajadas ? Math.max(...rajadas) : null;
  // Média vetorial: a aritmética dos graus erra perto do norte (350° e 10°
  // dariam 180°).
  const direcaoMedia = direcoes ? (Math.atan2(
    direcoes.reduce((a, d) => a + Math.sin((d * Math.PI) / 180), 0),
    direcoes.reduce((a, d) => a + Math.cos((d * Math.PI) / 180), 0)
  ) * 180 / Math.PI + 360) % 360 : null;
  const probabilidadeChuva = probs ? Math.max(...probs) : null;
  const precipitacaoMm = precs ? precs.reduce((a, b) => a + b, 0) : null;
  const precipitacaoHorariaMaxMm = precs ? Math.max(...precs) : null;
  const tempestade = codigos.some((c) => CODIGOS_TEMPESTADE.has(c));

  return {
    periodo: PERIODOS[chave].label,
    ...janela,
    direcao: direcaoCardinal(direcaoMedia),
    intensidadeVento: velocidadeMaxKmh == null ? "Sem dado" : `${classificarIntensidadeVento(Math.round(velocidadeMaxKmh))} (até ${Math.round(velocidadeMaxKmh)} km/h)`,
    velocidadeMediaKmh: velocidadeMediaKmh == null ? null : Math.round(velocidadeMediaKmh),
    velocidadeMaxKmh: velocidadeMaxKmh == null ? null : Math.round(velocidadeMaxKmh),
    rajadaMaxKmh: rajadaMaxKmh == null ? null : Math.round(rajadaMaxKmh),
    probabilidadeChuva: probabilidadeChuva == null ? null : Math.round(probabilidadeChuva),
    precipitacaoMm: precipitacaoMm == null ? null : Math.round(precipitacaoMm * 10) / 10,
    precipitacaoHorariaMaxMm:
      precipitacaoHorariaMaxMm == null
        ? null
        : Math.round(precipitacaoHorariaMaxMm * 10) / 10,
    tempestade,
    disponivel: [velocidadeMaxKmh, rajadaMaxKmh, probabilidadeChuva, precipitacaoMm].some(Number.isFinite) || codigos.length > 0,
  };
}

function validarResposta(json, fuso) {
  if (!json || !Array.isArray(json.hourly?.time) || !json.hourly.time.length
      || !Array.isArray(json.daily?.time) || !json.daily.time.length) {
    const erro = new Error("Open-Meteo retornou payload sem séries horária e diária válidas.");
    erro.name = "ParserError";
    throw erro;
  }
  if (!json.hourly.time.every((valor) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(String(valor)))
      || !json.daily.time.every((valor) => /^\d{4}-\d{2}-\d{2}$/.test(String(valor)))) {
    const erro = new Error("Open-Meteo retornou timestamps inválidos.");
    erro.name = "ParserError";
    throw erro;
  }
  if (json.timezone && json.timezone !== fuso) {
    const erro = new Error(`Open-Meteo retornou fuso divergente (${json.timezone}).`);
    erro.name = "ParserError";
    throw erro;
  }
  const unidadesEsperadas = {
    temperature_2m: "°C", relative_humidity_2m: "%", precipitation_probability: "%",
    precipitation: "mm", wind_speed_10m: "km/h", wind_gusts_10m: "km/h",
    wind_direction_10m: "°",
  };
  for (const [campo, esperada] of Object.entries(unidadesEsperadas)) {
    const recebida = json.hourly_units?.[campo];
    if (recebida != null && recebida !== esperada) {
      const erro = new Error(`Open-Meteo retornou unidade inesperada para ${campo}: ${recebida}.`);
      erro.name = "ParserError";
      throw erro;
    }
  }
}

/**
 * @param {object} [opcoes]
 * @param {number} [opcoes.inicioHora=5] início da janela de hoje (hora local).
 * @param {number} [opcoes.diasPrevisao=1] hoje + dias seguintes.
 * @param {boolean} [opcoes.agregarJanela=false] temperatura, umidade e
 *   condição de hoje calculadas só na janela (relatórios agendados); sem
 *   isso, usam o agregado diário da fonte.
 * @param {string} [opcoes.fuso] fuso da localidade: horários e agregados
 *   diários seguem o dia civil desse fuso.
 */
async function buscarOpenMeteo(latitude, longitude, {
  inicioHora = INICIO_JANELA_HOJE,
  fimHora = 24,
  diasPrevisao = 1,
  agregarJanela = false,
  fuso = "America/Sao_Paulo",
  fetchImpl = fetch,
  timeoutMs = OPEN_METEO_TIMEOUT_MS,
  esperarFn,
  logger,
} = {}) {
  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    current: "temperature_2m,weather_code,is_day",
    hourly:
      "temperature_2m,relative_humidity_2m,precipitation_probability,precipitation,wind_speed_10m,wind_gusts_10m,wind_direction_10m,weather_code",
    daily:
      "temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max,weather_code",
    timezone: fuso,
    forecast_days: String(diasPrevisao),
  });

  const url = aplicarConfiguracaoOpenMeteo(`https://api.open-meteo.com/v1/forecast?${params.toString()}`);

  const json = await buscarJsonComRetentativa(url, {
    nomeFonte: "Open-Meteo",
    fetchImpl,
    timeoutMs,
    tentativas: OPEN_METEO_TENTATIVAS,
    esperarFn,
    logger: logger === undefined && fetchImpl === globalThis.fetch ? console : logger,
    prefixoLog: "OPEN-METEO-WEATHER",
  });
  validarResposta(json, fuso);
  const horas = json.hourly;
  const dia = json.daily;
  const dataReferencia = dia.time[0];
  const indicesDia = horas.time.map((instante, i) => ({ instante, i }))
    .filter(({ instante }) => String(instante).slice(0, 10) === dataReferencia)
    .map(({ i }) => i);
  const indicesJanela = horas.time.map((instante, i) => ({ instante, i }))
    .filter(({ instante }) => {
      const hora = Number(instante.slice(11, 13));
      return instante.slice(0, 10) === dataReferencia && hora >= inicioHora && hora < fimHora;
    })
    .map(({ i }) => i);
  if (agregarJanela && !indicesJanela.length) throw new Error("Open-Meteo não retornou horas para a janela solicitada.");
  const valoresJanela = (campo) => indicesJanela.map((i) => horas[campo]?.[i]).filter(Number.isFinite);
  const minimoJanela = (campo) => valoresJanela(campo).length ? Math.min(...valoresJanela(campo)) : null;
  const maximoJanela = (campo) => valoresJanela(campo).length ? Math.max(...valoresJanela(campo)) : null;

  const periodos = {
    manha: resumirPeriodo(horas, "manha", { dataReferencia, inicioHora, fimHora }),
    tarde: resumirPeriodo(horas, "tarde", { dataReferencia, inicioHora, fimHora }),
    noite: resumirPeriodo(horas, "noite", { dataReferencia, inicioHora, fimHora }),
  };
  // As tabelas por período do PDF cobrem o dia operacional completo e mantêm
  // os três grupos originais, independentemente da janela do card da edição.
  // Esta visão é derivada da mesma resposta horária, sem nova consulta.
  const periodosDiaCompleto = {
    manha: resumirPeriodo(horas, "manha", { dataReferencia, inicioHora: INICIO_JANELA_HOJE, fimHora: 24 }),
    tarde: resumirPeriodo(horas, "tarde", { dataReferencia, inicioHora: INICIO_JANELA_HOJE, fimHora: 24 }),
    noite: resumirPeriodo(horas, "noite", { dataReferencia, inicioHora: INICIO_JANELA_HOJE, fimHora: 24 }),
  };

  const valoresDia = (campo) => indicesDia.map((i) => horas[campo]?.[i]).filter(Number.isFinite);
  const umidades = valoresDia("relative_humidity_2m");
  const listaPeriodos = Object.values(periodos).filter((p) => p.disponivel);
  const temTempestadeHoje = listaPeriodos.some((p) => p.tempestade);

  // Importante: os totais/máximos abaixo são derivados dos MESMOS períodos
  // (Manhã/Tarde/Noite, 05h-24h) exibidos nas tabelas — nunca do agregado
  // "dia inteiro" bruto da Open-Meteo (que inclui a madrugada 00h-05h já
  // encerrada). Misturar as duas janelas gerava alarmes de "chuva intensa"
  // baseados em picos de madrugada que já haviam passado na hora da consulta.
  const precipitacoesPeriodo = listaPeriodos.map((p) => p.precipitacaoMm);
  const precipitacaoTotalMm = listaPeriodos.length && precipitacoesPeriodo.every(Number.isFinite)
    ? Math.round(precipitacoesPeriodo.reduce((soma, valor) => soma + valor, 0) * 10) / 10
    : null;
  const maximoOuNulo = (valores) => valores.length ? Math.max(...valores) : null;
  const precipitacaoHorariaMaxMm = maximoOuNulo(listaPeriodos.map((p) => p.precipitacaoHorariaMaxMm).filter(Number.isFinite));
  const probabilidadeChuvaMax = maximoOuNulo(listaPeriodos.map((p) => p.probabilidadeChuva).filter(Number.isFinite));
  const rajadaMaxKmh = maximoOuNulo(listaPeriodos.map((p) => p.rajadaMaxKmh).filter(Number.isFinite));
  const velocidadeMaxKmh = maximoOuNulo(listaPeriodos.map((p) => p.velocidadeMaxKmh).filter(Number.isFinite));
  const chuvaHoraria = indicesJanela.map((i) => ({
    horario: horas.time[i].slice(11, 16),
    intervalo: `${horas.time[i].slice(11, 16)}–${hh(Number(horas.time[i].slice(11, 13)) + 1).replace("h", ":00")}`,
    precipitacaoMm: Number.isFinite(horas.precipitation?.[i]) ? Math.round(horas.precipitation[i] * 10) / 10 : null,
    probabilidade: Number.isFinite(horas.precipitation_probability?.[i]) ? Math.round(horas.precipitation_probability[i]) : null,
  }));

  return {
    fonte: "Open-Meteo",
    url: removerCredenciaisOpenMeteo(url),
    dataReferencia: dia.time[0],
    fuso,
    janelaHoje: { inicioHora, fimHora, rotulo: `${hh(inicioHora)}–${hh(fimHora)}` },
    condicaoGeral: !agregarJanela
      ? descreverCodigo(dia.weather_code?.[0])
      : descreverCodigo(horas.weather_code?.[indicesJanela[0]]),
    atual: json.current ? {
      temperaturaC: json.current.temperature_2m ?? null,
      codigo: json.current.weather_code ?? null,
      condicao: descreverCodigo(json.current.weather_code),
      dia: json.current.is_day === 1,
      horario: json.current.time,
      fonte: "Open-Meteo",
      // Apesar do nome "current", a fonte calcula este bloco com dados de
      // modelos meteorológicos; não se trata de observação de estação.
      previsao: true,
    } : null,
    tempMin: !agregarJanela ? (Number.isFinite(dia.temperature_2m_min?.[0]) ? Math.round(dia.temperature_2m_min[0]) : null) : minimoJanela("temperature_2m"),
    tempMax: !agregarJanela ? (Number.isFinite(dia.temperature_2m_max?.[0]) ? Math.round(dia.temperature_2m_max[0]) : null) : maximoJanela("temperature_2m"),
    umidadeMin: !agregarJanela ? (umidades.length ? Math.round(Math.min(...umidades)) : null) : minimoJanela("relative_humidity_2m"),
    umidadeMax: !agregarJanela ? (umidades.length ? Math.round(Math.max(...umidades)) : null) : maximoJanela("relative_humidity_2m"),
    precipitacaoTotalMm,
    precipitacaoDiariaMm: Number.isFinite(dia.precipitation_sum[0]) ? Math.round(dia.precipitation_sum[0] * 10) / 10 : null,
    precipitacaoHorariaMaxMm,
    probabilidadeChuvaMax,
    rajadaMaxKmh,
    velocidadeMaxKmh,
    temTempestadeHoje,
    periodos,
    periodosDiaCompleto,
    chuvaHoraria,
    previsaoDias: dia.time.map((data, i) => ({
      data,
      condicao: descreverCodigo(dia.weather_code?.[i]),
      tempMin: Number.isFinite(dia.temperature_2m_min?.[i]) ? dia.temperature_2m_min[i] : null,
      tempMax: Number.isFinite(dia.temperature_2m_max?.[i]) ? dia.temperature_2m_max[i] : null,
      // Agregado diário da fonte no dia civil local (00h–24h).
      janela: "00h–24h",
      chuvaMm: Number.isFinite(dia.precipitation_sum[i]) ? Math.round(dia.precipitation_sum[i] * 10) / 10 : null,
      rajadaKmh: Number.isFinite(dia.wind_gusts_10m_max[i]) ? Math.round(dia.wind_gusts_10m_max[i]) : null,
    })),
  };
}

module.exports = {
  buscarOpenMeteo,
  direcaoCardinal,
  classificarIntensidadeVento,
  INICIO_JANELA_HOJE,
  PERIODOS,
  OPEN_METEO_TIMEOUT_MS,
  OPEN_METEO_TENTATIVAS,
  validarResposta,
};
