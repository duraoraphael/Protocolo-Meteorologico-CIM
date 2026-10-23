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

function classificarIndiceUv(valor) {
  if (!Number.isFinite(valor)) return null;
  if (valor < 3) return { nivel: "Baixo", faixa: "0–2" };
  if (valor < 6) return { nivel: "Moderado", faixa: "3–5" };
  if (valor < 8) return { nivel: "Alto", faixa: "6–7" };
  if (valor < 11) return { nivel: "Muito alto", faixa: "8–10" };
  return { nivel: "Extremo", faixa: "11+" };
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
  const plausivel = (campo, valor) => Number.isFinite(valor)
    && (campo === "precipitation" ? valor >= 0 && valor <= 500
      : campo === "precipitation_probability" ? valor >= 0 && valor <= 100
        : campo === "wind_gusts_10m" || campo === "wind_speed_10m" ? valor >= 0 && valor <= 500
          : true);
  const completa = (campo) => {
    const valores = serie(campo);
    return valores.length === idxs.length && valores.every((v) => plausivel(campo, v)) ? valores : null;
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
    rajadaMaxKmh: rajadas ? Math.round(Math.max(...rajadas)) : null,
    probabilidadeChuva: probabilidadeChuva == null ? null : Math.round(probabilidadeChuva),
    precipitacaoMm: precipitacaoMm == null ? null : Math.round(precipitacaoMm * 10) / 10,
    precipitacaoHorariaMaxMm:
      precipitacaoHorariaMaxMm == null
        ? null
        : Math.round(precipitacaoHorariaMaxMm * 10) / 10,
    tempestade,
    disponivel: [velocidadeMaxKmh, probabilidadeChuva, precipitacaoMm].some(Number.isFinite) || codigos.length > 0,
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
      || !json.daily.time.every((valor) => /^\d{4}-\d{2}-\d{2}$/.test(String(valor))
        && Number.isFinite(Date.parse(`${valor}T00:00:00Z`))
        && new Date(`${valor}T00:00:00Z`).toISOString().slice(0, 10) === valor)) {
    const erro = new Error("Open-Meteo retornou timestamps inválidos.");
    erro.name = "ParserError";
    throw erro;
  }
  if (json.timezone !== fuso || !Number.isInteger(json.utc_offset_seconds)
      || Math.abs(json.utc_offset_seconds) > 50400) {
    const erro = new Error(`Open-Meteo retornou fuso ou deslocamento UTC inválido (${json.timezone}).`);
    erro.name = "ParserError";
    throw erro;
  }
  if (json.hourly.time.some((t, i) => !/^\d{4}-\d{2}-\d{2}T\d{2}:00$/.test(t)
      || !Number.isFinite(Date.parse(`${t}:00Z`))
      || new Date(`${t}:00Z`).toISOString().slice(0, 16) !== t
      || (i > 0 && t <= json.hourly.time[i - 1]))) {
    const erro = new Error("Open-Meteo retornou horas duplicadas, fora de ordem ou inválidas.");
    erro.name = "ParserError";
    throw erro;
  }
  const seriesEsperadas = [
    ["hourly", "temperature_2m"], ["hourly", "relative_humidity_2m"],
    ["hourly", "precipitation_probability"], ["hourly", "precipitation"],
    ["hourly", "rain"], ["hourly", "showers"],
    ["hourly", "wind_speed_10m"], ["hourly", "wind_direction_10m"],
    ["hourly", "wind_gusts_10m"],
    ["hourly", "weather_code"], ["hourly", "uv_index"],
    ["daily", "temperature_2m_max"], ["daily", "temperature_2m_min"],
    ["daily", "precipitation_sum"], ["daily", "precipitation_probability_max"],
    ["daily", "wind_speed_10m_max"], ["daily", "weather_code"],
    ["daily", "uv_index_max"],
  ];
  for (const [bloco, campo] of seriesEsperadas) {
    const serie = json[bloco]?.[campo];
    const esperado = json[bloco].time.length;
    if (!Array.isArray(serie) || serie.length !== esperado) {
      const erro = new Error(
        `Open-Meteo retornou série ${bloco}.${campo} ausente ou desalinhada (${Array.isArray(serie) ? serie.length : "ausente"}/${esperado}).`,
      );
      erro.name = "ParserError";
      erro.code = "OPEN_METEO_INVALID_SERIES";
      throw erro;
    }
  }
  const unidadesEsperadas = {
    temperature_2m: "°C", relative_humidity_2m: "%", precipitation_probability: "%",
    precipitation: "mm", rain: "mm", showers: "mm", wind_speed_10m: "km/h", uv_index: "",
    wind_direction_10m: "°", wind_gusts_10m: "km/h",
  };
  for (const [campo, esperada] of Object.entries(unidadesEsperadas)) {
    const recebida = json.hourly_units?.[campo];
    if (recebida !== esperada) {
      const erro = new Error(`Open-Meteo retornou unidade inesperada para ${campo}: ${recebida}.`);
      erro.name = "ParserError";
      throw erro;
    }
  }
  const unidadesDiariasEsperadas = {
    temperature_2m_max: "°C", temperature_2m_min: "°C",
    precipitation_sum: "mm", precipitation_probability_max: "%",
    wind_speed_10m_max: "km/h", uv_index_max: "",
  };
  for (const [campo, esperada] of Object.entries(unidadesDiariasEsperadas)) {
    const recebida = json.daily_units?.[campo];
    if (recebida !== esperada) {
      const erro = new Error(`Open-Meteo retornou unidade diária inesperada para ${campo}: ${recebida}.`);
      erro.name = "ParserError";
      erro.code = "OPEN_METEO_INVALID_UNIT";
      throw erro;
    }
  }
}

// precipitation já contém rain e showers: somar essas séries duplicaria a chuva.
// Cada horário da API representa o acumulado da hora precedente.
function agregarChuvaEstimada(json, agora = new Date()) {
  const vazio = (motivo) => ({ diaMm: null, ultimaHoraMm: null, ultimas24hMm: null,
    referenciaEm: null, ultimaHoraReferencia: null, coberturaDia: { amostras: 0, horasEsperadas: 0, parcial: true },
    cobertura24h: { amostras: 0, horasEsperadas: 24, parcial: true },
    motivoIndisponibilidade: motivo, consultadoEm: agora.toISOString(), tipoDado: "estimado" });
  const offset = json.utc_offset_seconds;
  if (!Number.isInteger(offset) || Math.abs(offset) > 50400) return vazio("Deslocamento UTC ausente ou inválido.");
  const local = new Intl.DateTimeFormat("sv-SE", { timeZone: json.timezone,
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" })
    .format(agora).replace(" ", "T");
  const limite = `${local}:00`;
  const dia = local.slice(0, 10);
  const localCompleto = new Intl.DateTimeFormat("sv-SE", { timeZone: json.timezone,
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
    second: "2-digit", hourCycle: "h23" }).format(agora).replace(" ", "T");
  const offsetEsperado = Math.round((Date.parse(`${localCompleto}Z`) - agora.getTime()) / 60_000) * 60;
  if (offsetEsperado !== offset) return vazio("Deslocamento UTC incompatível com o fuso da localidade.");
  const limiteUtc = Date.parse(`${limite}:00Z`) - offset * 1000;
  const itens = json.hourly.time.map((tempo, i) => ({
    tempo, utc: Date.parse(`${tempo}:00Z`) - offset * 1000,
    mm: json.hourly.precipitation[i],
  })).filter((x) => x.tempo <= limite && Number.isFinite(x.utc));
  const ultimo = itens.at(-1);
  if (!ultimo || agora.getTime() - ultimo.utc > 3 * 3600_000 || ultimo.utc > agora.getTime() + 15 * 60_000) {
    return vazio("Série histórica do modelo ausente ou anterior à janela de atualização de 3 horas.");
  }
  const valido = (x) => Number.isFinite(x.mm) && x.mm >= 0 && x.mm <= 500;
  const somar = (lista) => lista.some(valido) ? Math.round(lista.filter(valido).reduce((s, x) => s + x.mm, 0) * 10) / 10 : null;
  // 00h é o acumulado de 23h–00h do dia anterior.
  const hoje = itens.filter((x) => x.tempo.slice(0, 10) === dia && x.tempo.slice(11, 13) !== "00");
  const ultimas24h = itens.filter((x) => x.utc > limiteUtc - 24 * 3600_000 && x.utc <= limiteUtc);
  const ultimaValida = itens.filter((x) => x.utc > limiteUtc - 3 * 3600_000 && valido(x)).at(-1);
  const horasEsperadasDia = Number(local.slice(11, 13));
  const coberturaDia = { amostras: hoje.filter(valido).length, horasEsperadas: horasEsperadasDia,
    parcial: hoje.filter(valido).length !== horasEsperadasDia };
  const cobertura24h = { amostras: ultimas24h.filter(valido).length, horasEsperadas: 24,
    parcial: ultimas24h.filter(valido).length !== 24 };
  return { diaMm: somar(hoje), ultimaHoraMm: ultimaValida?.mm ?? null,
    ultimas24hMm: somar(ultimas24h), referenciaEm: ultimo.tempo,
    ultimaHoraReferencia: ultimaValida?.tempo || null, coberturaDia, cobertura24h,
    motivoIndisponibilidade: !hoje.some(valido) && !ultimas24h.some(valido)
      ? "Precipitação histórica sem horas numéricas válidas." : null,
    consultadoEm: agora.toISOString(), tipoDado: "estimado" };
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
  agora = () => new Date(),
} = {}) {
  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    current: "temperature_2m,weather_code,is_day",
    hourly:
      "temperature_2m,relative_humidity_2m,precipitation_probability,precipitation,rain,showers,wind_speed_10m,wind_direction_10m,wind_gusts_10m,weather_code,uv_index",
    daily:
      "temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,weather_code,uv_index_max",
    wind_speed_unit: "kmh",
    timezone: fuso,
    forecast_days: String(diasPrevisao),
    past_hours: "30",
    forecast_hours: String(Math.max(24, diasPrevisao * 24)),
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
  const velocidadeMaxKmh = maximoOuNulo(listaPeriodos.map((p) => p.velocidadeMaxKmh).filter(Number.isFinite));
  const rajadaMaxKmh = maximoOuNulo(listaPeriodos.map((p) => p.rajadaMaxKmh).filter(Number.isFinite));
  const valoresUvDia = valoresDia("uv_index");
  const uvMax = Number.isFinite(dia.uv_index_max?.[0]) ? dia.uv_index_max[0] : maximoOuNulo(valoresUvDia);
  const indiceUvPico = uvMax === null ? -1 : indicesDia.find((i) => horas.uv_index?.[i] === uvMax);
  const chuvaHoraria = indicesJanela.map((i) => ({
    horario: horas.time[i].slice(11, 16),
    intervalo: `${horas.time[i].slice(11, 16)}–${hh(Number(horas.time[i].slice(11, 13)) + 1).replace("h", ":00")}`,
    precipitacaoMm: Number.isFinite(horas.precipitation?.[i]) && horas.precipitation[i] >= 0 && horas.precipitation[i] <= 500 ? Math.round(horas.precipitation[i] * 10) / 10 : null,
    probabilidade: Number.isFinite(horas.precipitation_probability?.[i]) && horas.precipitation_probability[i] >= 0 && horas.precipitation_probability[i] <= 100 ? Math.round(horas.precipitation_probability[i]) : null,
  }));

  return {
    fonte: "Open-Meteo",
    url: removerCredenciaisOpenMeteo(url),
    dataReferencia: dia.time[0],
    fuso,
    estimativaChuva: agregarChuvaEstimada(json, agora()),
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
    precipitacaoDiariaMm: Number.isFinite(dia.precipitation_sum[0]) && dia.precipitation_sum[0] >= 0 && dia.precipitation_sum[0] <= 1500 ? Math.round(dia.precipitation_sum[0] * 10) / 10 : null,
    precipitacaoHorariaMaxMm,
    probabilidadeChuvaMax,
    rajadaMaxKmh,
    velocidadeMaxKmh,
    uvMax: uvMax == null ? null : Math.round(uvMax * 10) / 10,
    uvClassificacao: classificarIndiceUv(uvMax),
    horaPicoUv: indiceUvPico >= 0 ? horas.time[indiceUvPico] : null,
    temTempestadeHoje,
    periodos,
    periodosDiaCompleto,
    chuvaHoraria,
    previsaoDias: dia.time.map((data, i) => {
      const indices = horas.time.map((instante, indice) => ({ instante, indice }))
        .filter((item) => String(item.instante).slice(0, 10) === data)
        .map((item) => item.indice);
      const umidadeDia = indices.map((indice) => horas.relative_humidity_2m?.[indice]).filter(Number.isFinite);
      const rajadasDia = indices.map((indice) => horas.wind_gusts_10m?.[indice]).filter(Number.isFinite);
      return ({
      data,
      condicao: descreverCodigo(dia.weather_code?.[i]),
      tempMin: Number.isFinite(dia.temperature_2m_min?.[i]) ? dia.temperature_2m_min[i] : null,
      tempMax: Number.isFinite(dia.temperature_2m_max?.[i]) ? dia.temperature_2m_max[i] : null,
      umidadeMin: umidadeDia.length ? Math.round(Math.min(...umidadeDia)) : null,
      umidadeMax: umidadeDia.length ? Math.round(Math.max(...umidadeDia)) : null,
      // Agregado diário da fonte no dia civil local (00h–24h).
      janela: "00h–24h",
      chuvaMm: Number.isFinite(dia.precipitation_sum[i]) && dia.precipitation_sum[i] >= 0 && dia.precipitation_sum[i] <= 1500 ? Math.round(dia.precipitation_sum[i] * 10) / 10 : null,
      probabilidadeChuvaPct: Number.isFinite(dia.precipitation_probability_max?.[i])
        && dia.precipitation_probability_max[i] >= 0 && dia.precipitation_probability_max[i] <= 100
        ? Math.round(dia.precipitation_probability_max[i]) : null,
      uvMax: Number.isFinite(dia.uv_index_max?.[i]) ? Math.round(dia.uv_index_max[i] * 10) / 10 : null,
      rajadaKmh: rajadasDia.length ? Math.round(Math.max(...rajadasDia)) : null,
    }); }),
  };
}

module.exports = {
  buscarOpenMeteo,
  direcaoCardinal,
  classificarIntensidadeVento,
  classificarIndiceUv,
  INICIO_JANELA_HOJE,
  PERIODOS,
  OPEN_METEO_TIMEOUT_MS,
  OPEN_METEO_TENTATIVAS,
  validarResposta,
  agregarChuvaEstimada,
};
