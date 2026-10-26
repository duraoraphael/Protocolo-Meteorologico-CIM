// Fonte pública: Open-Meteo Forecast (https://open-meteo.com), com modelo
// best_match e fallback de indicador para o modelo global GFS.

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

const CODIGOS_TEMPESTADE = new Set([95, 96, 99]);
const OPEN_METEO_TIMEOUT_MS = API_TIMEOUT_MS;
const OPEN_METEO_TENTATIVAS = API_TENTATIVAS;
const MODELO_PRINCIPAL = "best_match";
const MODELO_FALLBACK = "ncep_gfs_seamless";
const CACHE_MAX_AGE_MS = Number(process.env.OPEN_METEO_CACHE_MAX_AGE_MS) || 30 * 60 * 1000;
const cachePrevisoes = new Map();
const INDICADORES_OPEN_METEO = [
  { bloco: "hourly", campo: "wind_gusts_10m", indicador: "Rajada prevista (horária)", minimo: 0, maximo: 400 },
  { bloco: "daily", campo: "wind_gusts_10m_max", indicador: "Rajada prevista (diária)", minimo: 0, maximo: 400 },
  { bloco: "hourly", campo: "precipitation", indicador: "Chuva acumulada prevista no período", minimo: 0, maximo: 1000 },
  { bloco: "daily", campo: "precipitation_sum", indicador: "Chuva acumulada prevista/dia", minimo: 0, maximo: 10000 },
  { bloco: "hourly", campo: "precipitation_probability", indicador: "Probabilidade de chuva no período", minimo: 0, maximo: 100 },
  { bloco: "daily", campo: "precipitation_probability_max", indicador: "Probabilidade máxima diária de chuva", minimo: 0, maximo: 100 },
];
const CAMPOS_COM_FALLBACK = new Set(INDICADORES_OPEN_METEO.map(({ campo }) => campo));

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

function partesLocais(instante, fuso) {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: fuso, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(instante);
  const valor = (tipo) => partes.find((p) => p.type === tipo)?.value;
  return {
    data: `${valor("year")}-${valor("month")}-${valor("day")}`,
    hora: Number(valor("hour")),
    minuto: Number(valor("minute")),
  };
}

function horaLocalParaIso(horario, offsetSegundos) {
  if (typeof horario !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(horario)
      || !Number.isFinite(offsetSegundos)) return null;
  const instante = new Date(Date.parse(`${horario}Z`) - offsetSegundos * 1000);
  return Number.isFinite(instante.getTime()) ? instante.toISOString() : null;
}

function acumularPrecipitacaoDecorrida(hourly, { now = new Date(), agoraLocal = null, fuso = "America/Sao_Paulo" } = {}) {
  const local = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(String(agoraLocal || ""))
    ? { data: agoraLocal.slice(0, 10), hora: Number(agoraLocal.slice(11, 13)), minuto: Number(agoraLocal.slice(14, 16)) }
    : partesLocais(now, fuso);
  // A precipitação horária é um total do intervalo anterior. Assim, o valor
  // rotulado 01:00 representa 00:00–01:00 e o valor 00:00 pertence ao dia
  // anterior. Nunca usamos horas futuras nem daily.precipitation_sum aqui.
  const esperadas = local.hora;
  if (!esperadas) return {
    valorMm: null, disponivel: false, cobertura: { amostras: 0, esperadas: 0 },
    janela: `${local.data} 00:00–00:00`, motivo: "Ainda não há intervalo horário completo no dia local.",
  };
  const porHora = new Map();
  for (let i = 0; i < (hourly?.time || []).length; i += 1) {
    const instante = String(hourly.time[i]);
    if (instante.slice(0, 10) !== local.data) continue;
    const hora = Number(instante.slice(11, 13));
    if (hora >= 1 && hora <= esperadas && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(instante)) {
      porHora.set(hora, hourly.precipitation?.[i]);
    }
  }
  const valores = Array.from({ length: esperadas }, (_, i) => porHora.get(i + 1));
  if (valores.some((valor) => !Number.isFinite(valor) || valor < 0)) return {
    valorMm: null, disponivel: false,
    cobertura: { amostras: valores.filter(Number.isFinite).length, esperadas },
    janela: `${local.data} 00:00–${String(esperadas).padStart(2, "0")}:00`,
    motivo: "A série horária tem lacunas ou valores inválidos no período transcorrido.",
  };
  return {
    valorMm: Math.round(valores.reduce((soma, valor) => soma + valor, 0) * 10) / 10,
    disponivel: true,
    cobertura: { amostras: valores.length, esperadas },
    janela: `${local.data} 00:00–${String(esperadas).padStart(2, "0")}:00`,
    motivo: null,
  };
}

function resumirPeriodo(horas, chave, { dataReferencia, inicioHora = INICIO_JANELA_HOJE, fimHora = 24 } = {}) {
  const { horaInicio, horaFim } = PERIODOS[chave];
  const inicio = Math.min(Math.max(horaInicio, inicioHora), horaFim);
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

  // Uma série esparsa ou duplicada não representa o acumulado do período.
  const horasRecebidas = idxs.map((i) => Number(horas.time[i].slice(11, 13)));
  const coberturaCompleta = fim > inicio && horasRecebidas.length === fim - inicio
    && Array.from({ length: fim - inicio }, (_, i) => inicio + i)
      .every((hora) => horasRecebidas.includes(hora));

  if (idxs.length === 0) {
    return {
      periodo: PERIODOS[chave].label,
      ...janela,
      referenciaEm: `${dataReferencia} ${janela.janela}`,
      cobertura: { amostras: 0, esperadas: fim - inicio, completa: false },
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
  const completa = (campo, minimo = -Infinity, maximo = Infinity) => {
    const valores = serie(campo);
    return coberturaCompleta && valores.every((valor) => Number.isFinite(valor) && valor >= minimo && valor <= maximo) ? valores : null;
  };
  const velocidades = completa("wind_speed_10m", 0, 300);
  const direcoes = completa("wind_direction_10m");
  // Chuva e rajada horárias representam a hora ANTERIOR ao timestamp.
  // Para 05h–12h, portanto, usamos rótulos 06h..12h; para 18h–00h,
  // 19h..00h do dia seguinte.
  const diaSeguinte = new Date(`${dataReferencia}T12:00:00Z`);
  diaSeguinte.setUTCDate(diaSeguinte.getUTCDate() + 1);
  const dataSeguinte = diaSeguinte.toISOString().slice(0, 10);
  const indicesChuva = Array.from({ length: Math.max(0, fim - inicio) }, (_, i) => {
    const horaFinal = inicio + i + 1;
    const rotulo = horaFinal === 24 ? `${dataSeguinte}T00:00`
      : `${dataReferencia}T${String(horaFinal).padStart(2, "0")}:00`;
    const primeiro = horas.time.indexOf(rotulo);
    return primeiro >= 0 && horas.time.lastIndexOf(rotulo) === primeiro ? primeiro : -1;
  });
  const chuvaCompleta = (campo, maximo) => {
    const valores = indicesChuva.map((i) => i < 0 ? null : horas[campo]?.[i]);
    return valores.length === fim - inicio
      && valores.every((valor) => Number.isFinite(valor) && valor >= 0 && valor <= maximo) ? valores : null;
  };
  const probs = chuvaCompleta("precipitation_probability", 100);
  const precs = chuvaCompleta("precipitation", 1000);
  const coberturaChuva = { amostras: indicesChuva.filter((i) => i >= 0).length,
    esperadas: fim - inicio, completa: precs !== null && probs !== null };
  const indicesRajada = horas.time.map((t, i) => ({ t, i })).filter(({ t }) => {
    const hora = Number(t.slice(11, 13));
    return (t.slice(0, 10) === dataReferencia && hora > inicio && hora <= Math.min(fim, 23))
      || (fim === 24 && t.slice(0, 10) === dataSeguinte && hora === 0);
  }).map(({ i }) => i);
  const rajadas = indicesRajada.map((i) => horas.wind_gusts_10m?.[i]);
  const rajadasCompletas = indicesRajada.length === fim - inicio
    && rajadas.every((valor) => Number.isFinite(valor) && valor >= 0);
  const indicePicoRajada = rajadasCompletas
    ? indicesRajada.reduce((pico, i) => horas.wind_gusts_10m[i] > horas.wind_gusts_10m[pico] ? i : pico)
    : null;
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
    referenciaEm: `${dataReferencia} ${janela.janela}`,
    cobertura: { amostras: idxs.length, esperadas: fim - inicio, completa: coberturaCompleta },
    coberturaChuva,
    direcao: direcaoCardinal(direcaoMedia),
    intensidadeVento: velocidadeMaxKmh == null ? "Sem dado" : `${classificarIntensidadeVento(Math.round(velocidadeMaxKmh))} (até ${Math.round(velocidadeMaxKmh)} km/h)`,
    velocidadeMediaKmh: velocidadeMediaKmh == null ? null : Math.round(velocidadeMediaKmh),
    velocidadeMaxKmh: velocidadeMaxKmh == null ? null : Math.round(velocidadeMaxKmh),
    rajadaMaxKmh: indicePicoRajada === null ? null : Math.round(horas.wind_gusts_10m[indicePicoRajada] * 10) / 10,
    rajadaPrevistaEm: indicePicoRajada === null ? null : horas.time[indicePicoRajada],
    probabilidadeChuva: probabilidadeChuva == null ? null : Math.round(probabilidadeChuva),
    precipitacaoMm: precipitacaoMm == null ? null : Math.round(precipitacaoMm * 10) / 10,
    precipitacaoHorariaMaxMm:
      precipitacaoHorariaMaxMm == null
        ? null
        : Math.round(precipitacaoHorariaMaxMm * 10) / 10,
    tempestade,
    disponivel: [velocidadeMaxKmh, probabilidadeChuva, precipitacaoMm,
      indicePicoRajada === null ? null : horas.wind_gusts_10m[indicePicoRajada]].some(Number.isFinite) || codigos.length > 0,
  };
}

function picoRajadaRestante(horas, { dataReferencia, inicioHora, fimHora, agora, fuso, offsetSegundos }) {
  const local = partesLocais(agora, fuso);
  if (local.data !== dataReferencia || !Number.isFinite(offsetSegundos)) return null;
  // A hora em curso ainda contém minutos transcorridos. Só use intervalos
  // inteiramente futuros para o pico de rajada restante.
  const inicio = Math.max(inicioHora, local.hora + (local.minuto > 0 ? 1 : 0));
  if (inicio >= fimHora) return null;
  const diaSeguinte = new Date(`${dataReferencia}T12:00:00Z`);
  diaSeguinte.setUTCDate(diaSeguinte.getUTCDate() + 1);
  const dataSeguinte = diaSeguinte.toISOString().slice(0, 10);
  const candidatos = [];
  for (let horaFinal = inicio + 1; horaFinal <= fimHora; horaFinal++) {
    const rotulo = horaFinal === 24
      ? `${dataSeguinte}T00:00`
      : `${dataReferencia}T${String(horaFinal).padStart(2, "0")}:00`;
    const indice = horas.time.indexOf(rotulo);
    const valor = indice < 0 ? null : horas.wind_gusts_10m?.[indice];
    if (!Number.isFinite(valor) || valor < 0) return null;
    candidatos.push({ rotulo, valor });
  }
  const pico = candidatos.reduce((maior, item) => item.valor > maior.valor ? item : maior);
  return {
    valor: Math.round(pico.valor * 10) / 10,
    em: horaLocalParaIso(pico.rotulo, offsetSegundos),
    janela: `${hh(inicio)}–${hh(fimHora)}`,
  };
}

function validarResposta(json, fuso, coordenadasSolicitadas = null, { permitirFallbackIndicadores = false } = {}) {
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
  if (json.hourly.time.some((valor, indice, serie) => indice > 0 && valor <= serie[indice - 1])) {
    const erro = new Error("Open-Meteo retornou horas duplicadas ou fora de ordem.");
    erro.name = "ParserError";
    throw erro;
  }
  if (json.timezone && json.timezone !== fuso) {
    const erro = new Error(`Open-Meteo retornou fuso divergente (${json.timezone}).`);
    erro.name = "ParserError";
    throw erro;
  }
  for (const [bloco, campo] of [["hourly", "time"], ["daily", "time"]]) {
    const serie = json[bloco]?.[campo];
    if (!Array.isArray(serie)) throw new Error(`Open-Meteo retornou ${bloco}.time inválido.`);
  }
  for (const bloco of ["hourly", "daily"]) {
    for (const [campo, serie] of Object.entries(json[bloco])) {
      if (campo === "time" || serie == null) continue;
      if (permitirFallbackIndicadores && CAMPOS_COM_FALLBACK.has(campo)) continue;
      if (!Array.isArray(serie) || serie.length !== json[bloco].time.length) {
        const erro = new Error(`Open-Meteo retornou série ${bloco}.${campo} ausente ou desalinhada.`);
        erro.name = "ParserError";
        erro.code = "OPEN_METEO_INVALID_SERIES";
        throw erro;
      }
    }
  }
  const unidadesEsperadas = {
    temperature_2m: "°C", relative_humidity_2m: "%", precipitation_probability: "%",
    precipitation: "mm", wind_speed_10m: "km/h", wind_gusts_10m: "km/h", uv_index: "",
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
  const unidadesDiariasEsperadas = {
    temperature_2m_max: "°C", temperature_2m_min: "°C",
    precipitation_sum: "mm", precipitation_probability_max: "%",
    wind_speed_10m_max: "km/h", wind_gusts_10m_max: "km/h", uv_index_max: "",
  };
  for (const [campo, esperada] of Object.entries(unidadesDiariasEsperadas)) {
    const recebida = json.daily_units?.[campo];
    if (recebida != null && recebida !== esperada) {
      const erro = new Error(`Open-Meteo retornou unidade diária inesperada para ${campo}: ${recebida}.`);
      erro.name = "ParserError";
      erro.code = "OPEN_METEO_INVALID_UNIT";
      throw erro;
    }
  }
  if (coordenadasSolicitadas) {
    const { latitude, longitude } = json;
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      const erro = new Error("Open-Meteo não informou coordenadas da grade meteorológica.");
      erro.name = "ParserError";
      erro.code = "OPEN_METEO_LOCATION_INVALID";
      throw erro;
    }
    const rad = (graus) => graus * Math.PI / 180;
    const deltaLat = rad(latitude - coordenadasSolicitadas.latitude);
    const deltaLon = rad(longitude - coordenadasSolicitadas.longitude);
    const a = Math.sin(deltaLat / 2) ** 2
      + Math.cos(rad(coordenadasSolicitadas.latitude)) * Math.cos(rad(latitude)) * Math.sin(deltaLon / 2) ** 2;
    const distanciaKm = 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    if (distanciaKm > 100) {
      const erro = new Error(`Open-Meteo retornou grade a ${Math.round(distanciaKm)} km da localidade solicitada.`);
      erro.name = "ParserError";
      erro.code = "OPEN_METEO_LOCATION_MISMATCH";
      throw erro;
    }
  }
}

function criarUrlPublicaOpenMeteo(latitude, longitude, {
  diasPrevisao = 4,
  fuso = "America/Sao_Paulo",
  modelo = MODELO_PRINCIPAL,
  hourlyCampos = null,
  dailyCampos = null,
} = {}) {
  const hourlyPadrao = "temperature_2m,relative_humidity_2m,precipitation_probability,precipitation,wind_speed_10m,wind_direction_10m,wind_gusts_10m,weather_code,uv_index";
  const dailyPadrao = "temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max,weather_code,uv_index_max";
  const params = new URLSearchParams({
    latitude: String(latitude), longitude: String(longitude),
    current: "temperature_2m,relative_humidity_2m,weather_code,is_day,uv_index",
    hourly: Array.isArray(hourlyCampos) ? hourlyCampos.join(",") : hourlyPadrao,
    daily: Array.isArray(dailyCampos) ? dailyCampos.join(",") : dailyPadrao,
    wind_speed_unit: "kmh", precipitation_unit: "mm", timezone: fuso,
    forecast_days: String(diasPrevisao), past_days: "1", models: modelo,
  });
  if (Array.isArray(hourlyCampos) && hourlyCampos.length === 0) params.delete("hourly");
  if (Array.isArray(dailyCampos) && dailyCampos.length === 0) params.delete("daily");
  return `https://api.open-meteo.com/v1/forecast?${params.toString()}`;
}

function validarRespostaFallback(json, fuso, coordenadasSolicitadas, definicao) {
  if (!Array.isArray(json?.[definicao.bloco]?.time)
      || !Array.isArray(json?.[definicao.bloco]?.[definicao.campo])) {
    const erro = new Error(`Open-Meteo não retornou ${definicao.bloco}.${definicao.campo} no modelo de fallback.`);
    erro.name = "ParserError";
    erro.code = "OPEN_METEO_INVALID_SERIES";
    throw erro;
  }
  if (json.timezone && json.timezone !== fuso) {
    const erro = new Error(`Open-Meteo retornou fuso divergente (${json.timezone}).`);
    erro.name = "ParserError";
    erro.code = "OPEN_METEO_INVALID_TIMEZONE";
    throw erro;
  }
  if (Number.isFinite(json.latitude) && Number.isFinite(json.longitude)) {
    validarResposta({ ...json, hourly: json.hourly || { time: ["2000-01-01T00:00"] },
      daily: json.daily || { time: ["2000-01-01"] } }, fuso, coordenadasSolicitadas);
  } else {
    const erro = new Error("Open-Meteo não informou coordenadas da grade meteorológica.");
    erro.name = "ParserError";
    erro.code = "OPEN_METEO_LOCATION_INVALID";
    throw erro;
  }
  const tempos = json[definicao.bloco].time;
  const valores = json[definicao.bloco][definicao.campo];
  if (tempos.length !== valores.length) {
    const erro = new Error(`Open-Meteo retornou série ${definicao.bloco}.${definicao.campo} desalinhada.`);
    erro.name = "ParserError";
    erro.code = "OPEN_METEO_INVALID_SERIES";
    throw erro;
  }
}

function valoresIndicadorAusentes(json, definicao) {
  const bloco = json?.[definicao.bloco];
  const tempos = bloco?.time;
  const valores = bloco?.[definicao.campo];
  if (!Array.isArray(tempos) || !Array.isArray(valores) || tempos.length !== valores.length) return true;
  const referencia = json?.current?.time || tempos[0];
  const limiteTemporal = definicao.bloco === "daily" ? String(referencia).slice(0, 10) : referencia;
  return tempos.some((tempo, indice) => {
    if (tempo < limiteTemporal) return false;
    const valor = valores[indice];
    return !Number.isFinite(valor) || valor < definicao.minimo || valor > definicao.maximo;
  });
}

function mesclarSerieSemSobrescrever(principal, alternativa, definicao) {
  const temposPrincipais = principal?.[definicao.bloco]?.time;
  const temposAlternativos = alternativa?.[definicao.bloco]?.time;
  const valoresAlternativos = alternativa?.[definicao.bloco]?.[definicao.campo];
  if (!Array.isArray(temposPrincipais) || !Array.isArray(temposAlternativos)
      || !Array.isArray(valoresAlternativos) || temposAlternativos.length !== valoresAlternativos.length) return false;
  const porTempo = new Map(temposAlternativos.map((tempo, indice) => [tempo, valoresAlternativos[indice]]));
  const bloco = principal[definicao.bloco];
  const existentes = Array.isArray(bloco[definicao.campo]) ? bloco[definicao.campo] : Array(temposPrincipais.length).fill(null);
  let preencheu = false;
  bloco[definicao.campo] = temposPrincipais.map((tempo, indice) => {
    const existente = existentes[indice];
    if (Number.isFinite(existente)) return existente;
    const candidato = porTempo.get(tempo);
    if (Number.isFinite(candidato) && candidato >= definicao.minimo && candidato <= definicao.maximo) {
      preencheu = true;
      return candidato;
    }
    return null;
  });
  const unidadesAlternativas = alternativa[`${definicao.bloco}_units`]?.[definicao.campo];
  if (!principal[`${definicao.bloco}_units`]?.[definicao.campo] && unidadesAlternativas) {
    principal[`${definicao.bloco}_units`] ||= {};
    principal[`${definicao.bloco}_units`][definicao.campo] = unidadesAlternativas;
  }
  return preencheu;
}

function registrarDiagnosticoOpenMeteo(logger, detalhe) {
  if (logger === null) return;
  (logger?.info || logger?.log || console.info).call(logger || console, "[OPEN-METEO]", detalhe);
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
  now = null,
  fetchImpl = fetch,
  timeoutMs = OPEN_METEO_TIMEOUT_MS,
  esperarFn,
  logger,
  localidade = null,
} = {}) {
  const url = criarUrlPublicaOpenMeteo(latitude, longitude, { diasPrevisao, fuso });
  const chaveCache = `${latitude},${longitude}|${fuso}|${diasPrevisao}`;
  const log = logger === undefined && fetchImpl === globalThis.fetch ? console : logger;
  const consulta = async (urlConsulta, nomeFonte = "Open-Meteo") => {
    let statusHttp = null;
    const inicioConsulta = Date.now();
    const fetchComStatus = async (...argumentos) => {
      statusHttp = null;
      const resposta = await fetchImpl(...argumentos);
      statusHttp = resposta.status ?? null;
      return resposta;
    };
    try {
      const respostaJson = await buscarJsonComRetentativa(urlConsulta, {
        nomeFonte, fetchImpl: fetchComStatus, timeoutMs, tentativas: OPEN_METEO_TENTATIVAS, esperarFn,
        logger: log, prefixoLog: "OPEN-METEO-WEATHER",
      });
      return { json: respostaJson, statusHttp, tempoMs: Date.now() - inicioConsulta };
    } catch (erro) {
      erro.httpStatus = erro.httpStatus ?? statusHttp;
      erro.tempoMs = Date.now() - inicioConsulta;
      throw erro;
    }
  };
  let json;
  let modeloBase = MODELO_PRINCIPAL;
  let metadadosCache = null;
  let metadadosConsultaPrincipal = {};
  let metadadosConsultaGfs = {};
  const modelosIndicadores = Object.fromEntries(INDICADORES_OPEN_METEO.map(({ campo }) => [campo, MODELO_PRINCIPAL]));
  const diagnósticosIndicadores = [];
  try {
    const resultado = await consulta(url);
    json = resultado.json;
    metadadosConsultaPrincipal = resultado;
  } catch (erroPrincipal) {
    metadadosConsultaPrincipal = { statusHttp: erroPrincipal.httpStatus, tempoMs: erroPrincipal.tempoMs };
    try {
      const urlFallback = criarUrlPublicaOpenMeteo(latitude, longitude, { diasPrevisao, fuso, modelo: MODELO_FALLBACK });
      const resultado = await consulta(urlFallback, `Open-Meteo (${MODELO_FALLBACK})`);
      json = resultado.json;
      metadadosConsultaGfs = resultado;
      validarResposta(json, fuso, { latitude, longitude }, { permitirFallbackIndicadores: true });
      modeloBase = MODELO_FALLBACK;
      for (const item of INDICADORES_OPEN_METEO) modelosIndicadores[item.campo] = MODELO_FALLBACK;
      const diagnostico = {
        localidade, latitude, longitude, consultadoEm: new Date().toISOString(),
        endpoint: new URL(urlFallback).origin + new URL(urlFallback).pathname,
        status: "fallback", modeloSolicitado: MODELO_PRINCIPAL, modeloUtilizado: MODELO_FALLBACK,
        statusHttp: metadadosConsultaGfs.statusHttp, tempoMs: metadadosConsultaGfs.tempoMs,
        motivo: erroPrincipal.message,
      };
      diagnósticosIndicadores.push(diagnostico);
      registrarDiagnosticoOpenMeteo(log, diagnostico);
    } catch (erroFallback) {
      metadadosConsultaGfs = { statusHttp: erroFallback.httpStatus, tempoMs: erroFallback.tempoMs };
      const cache = cachePrevisoes.get(chaveCache);
      const idadeMs = cache ? Date.now() - cache.armazenadoEm : Infinity;
      if (!cache || idadeMs > CACHE_MAX_AGE_MS) {
        const erro = new Error(`Open-Meteo indisponível nos modelos ${MODELO_PRINCIPAL} e ${MODELO_FALLBACK}; cache recente indisponível.`, { cause: erroFallback });
        erro.code = erroPrincipal.code || erroFallback.code;
        erro.httpStatus = erroPrincipal.httpStatus || erroFallback.httpStatus || null;
        erro.diagnosticos = [erroPrincipal.message, erroFallback.message];
        throw erro;
      }
      json = structuredClone(cache.json);
      modeloBase = cache.modelo || MODELO_PRINCIPAL;
      metadadosCache = { utilizado: true, idadeMs, atualizadoEm: new Date(cache.armazenadoEm).toISOString() };
      const diagnostico = {
        localidade, latitude, longitude, consultadoEm: new Date().toISOString(),
        statusHttp: erroPrincipal.httpStatus ?? erroFallback.httpStatus ?? null,
        tempoMs: (erroPrincipal.tempoMs || 0) + (erroFallback.tempoMs || 0),
        status: "cache", idadeMs, atualizadoEm: metadadosCache.atualizadoEm,
        motivo: `${erroPrincipal.message}; fallback ${MODELO_FALLBACK}: ${erroFallback.message}`,
      };
      diagnósticosIndicadores.push(diagnostico);
      registrarDiagnosticoOpenMeteo(log, diagnostico);
    }
  }
  validarResposta(json, fuso, { latitude, longitude }, { permitirFallbackIndicadores: true });

  if (!metadadosCache && modeloBase === MODELO_PRINCIPAL) {
    for (const item of INDICADORES_OPEN_METEO) {
      if (!valoresIndicadorAusentes(json, item)) continue;
      const urlFallback = criarUrlPublicaOpenMeteo(latitude, longitude, {
        diasPrevisao, fuso, modelo: MODELO_FALLBACK,
        hourlyCampos: item.bloco === "hourly" ? [item.campo] : [],
        dailyCampos: item.bloco === "daily" ? [item.campo] : [],
      });
      const inicioConsulta = Date.now();
      let statusHttp = null;
      let motivo = null;
      try {
        const resultadoAlternativo = await consulta(urlFallback, `Open-Meteo (${MODELO_FALLBACK})`);
        const alternativo = resultadoAlternativo.json;
        statusHttp = resultadoAlternativo.statusHttp;
        validarRespostaFallback(alternativo, fuso, { latitude, longitude }, item);
        const utilizou = mesclarSerieSemSobrescrever(json, alternativo, item);
        if (utilizou) modelosIndicadores[item.campo] = MODELO_FALLBACK;
        else motivo = `Série ${item.bloco}.${item.campo} ausente ou sem valores válidos no período.`;
        diagnósticosIndicadores.push({
          localidade, latitude, longitude, consultadoEm: new Date().toISOString(),
          endpoint: new URL(urlFallback).origin + new URL(urlFallback).pathname,
          modeloSolicitado: MODELO_FALLBACK, indicador: item.indicador,
          status: utilizou ? "fallback_utilizado" : "indisponivel",
          statusHttp, tempoMs: resultadoAlternativo.tempoMs ?? Date.now() - inicioConsulta, motivo,
        });
        registrarDiagnosticoOpenMeteo(log, diagnósticosIndicadores.at(-1));
      } catch (erro) {
        statusHttp = erro.httpStatus ?? statusHttp;
        motivo = erro.message;
        diagnósticosIndicadores.push({
          localidade, latitude, longitude, consultadoEm: new Date().toISOString(),
          endpoint: new URL(urlFallback).origin + new URL(urlFallback).pathname,
          modeloSolicitado: MODELO_FALLBACK, indicador: item.indicador,
          status: "indisponivel", statusHttp,
          tempoMs: Date.now() - inicioConsulta, motivo,
        });
        registrarDiagnosticoOpenMeteo(log, diagnósticosIndicadores.at(-1));
      }
    }
  }
  for (const item of INDICADORES_OPEN_METEO) {
    const bloco = json[item.bloco];
    if (!Array.isArray(bloco[item.campo]) || bloco[item.campo].length !== bloco.time.length) {
      bloco[item.campo] = Array(bloco.time.length).fill(null);
    }
  }
  validarResposta(json, fuso, { latitude, longitude });
  if (!metadadosCache) cachePrevisoes.set(chaveCache, { json: structuredClone(json), modelo: modeloBase, armazenadoEm: Date.now() });
  const respostaNormalizada = normalizarRespostaOpenMeteo(json, latitude, longitude, {
    inicioHora, fimHora, agregarJanela, fuso, now, url,
    modelo: modeloBase, modelosIndicadores, diagnósticosIndicadores, cache: metadadosCache,
  });
  for (const item of INDICADORES_OPEN_METEO) {
    const indisponivel = valoresIndicadorAusentes(json, item);
    const tentativaFallback = [...diagnósticosIndicadores].reverse()
      .find((diagnostico) => diagnostico.indicador === item.indicador);
    const valorRetornado = {
      "hourly.wind_gusts_10m": respostaNormalizada.rajadaMaxKmh,
      "daily.wind_gusts_10m_max": respostaNormalizada.previsaoDias
        .find((dia) => dia.data === respostaNormalizada.dataReferencia)?.rajadaKmh ?? null,
      "hourly.precipitation": respostaNormalizada.precipitacaoTotalMm,
      "daily.precipitation_sum": respostaNormalizada.precipitacaoPrevistaDiaMm,
      "hourly.precipitation_probability": respostaNormalizada.probabilidadeChuvaMax,
      "daily.precipitation_probability_max": respostaNormalizada.probabilidadeChuvaDiariaPct,
    }[`${item.bloco}.${item.campo}`];
    const diagnostico = {
      localidade, latitude, longitude, consultadoEm: new Date().toISOString(),
      endpoint: new URL(url).origin + new URL(url).pathname,
      modeloSolicitado: MODELO_PRINCIPAL, modeloUtilizado: modelosIndicadores[item.campo] || modeloBase,
      indicador: item.indicador,
      status: metadadosCache ? (indisponivel ? "cache_indisponivel" : "cache")
        : tentativaFallback?.status || (modeloBase === MODELO_FALLBACK ? "fallback" : indisponivel ? "indisponivel" : "operacional"),
      statusHttp: tentativaFallback?.statusHttp
        ?? (modeloBase === MODELO_FALLBACK ? metadadosConsultaGfs.statusHttp : metadadosConsultaPrincipal.statusHttp) ?? null,
      tempoMs: tentativaFallback?.tempoMs
        ?? (modeloBase === MODELO_FALLBACK ? metadadosConsultaGfs.tempoMs : metadadosConsultaPrincipal.tempoMs) ?? null,
      valorRetornado: Number.isFinite(valorRetornado) ? valorRetornado : null,
      motivo: indisponivel ? `Campo ${item.bloco}.${item.campo} ausente, nulo ou incompleto no período.` : null,
      cacheIdadeMs: metadadosCache?.idadeMs ?? null,
    };
    diagnósticosIndicadores.push(diagnostico);
    registrarDiagnosticoOpenMeteo(log, diagnostico);
  }
  respostaNormalizada.diagnosticosIndicadores = diagnósticosIndicadores;
  return respostaNormalizada;
}

// precipitation já contém rain e showers: somar essas séries duplicaria a chuva.
// Cada horário da API representa o acumulado da hora precedente.
function agregarChuvaEstimada(json, agora = new Date()) {
  const vazio = (motivo) => ({
    diaMm: null,
    ultimaHoraMm: null,
    ultimas24hMm: null,
    referenciaEm: null,
    ultimaHoraReferencia: null,
    coberturaDia: { amostras: 0, horasEsperadas: 0, parcial: true },
    cobertura24h: { amostras: 0, horasEsperadas: 24, parcial: true },
    motivoIndisponibilidade: motivo,
    consultadoEm: agora.toISOString(),
    tipoDado: "estimado",
  });
  const offset = json?.utc_offset_seconds;
  if (!Number.isInteger(offset) || Math.abs(offset) > 50400) return vazio("Deslocamento UTC ausente ou inválido.");
  let local;
  let localCompleto;
  try {
    local = new Intl.DateTimeFormat("sv-SE", {
      timeZone: json.timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23",
    }).format(agora).replace(" ", "T");
    localCompleto = new Intl.DateTimeFormat("sv-SE", {
      timeZone: json.timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit",
      minute: "2-digit", second: "2-digit", hourCycle: "h23",
    }).format(agora).replace(" ", "T");
  } catch {
    return vazio("Fuso da localidade ausente ou inválido.");
  }
  const offsetEsperado = Math.round((Date.parse(`${localCompleto}Z`) - agora.getTime()) / 60000) * 60;
  if (offsetEsperado !== offset) return vazio("Deslocamento UTC incompatível com o fuso da localidade.");
  const limite = `${local}:00`;
  const limiteUtc = Date.parse(`${limite}:00Z`) - offset * 1000;
  const tempos = json.hourly?.time;
  const precipitacao = json.hourly?.precipitation;
  if (!Array.isArray(tempos) || !Array.isArray(precipitacao) || tempos.length !== precipitacao.length) {
    return vazio("Série histórica de precipitação ausente ou desalinhada.");
  }
  const itens = tempos.map((tempo, i) => ({
    tempo,
    utc: Date.parse(`${tempo}:00Z`) - offset * 1000,
    mm: precipitacao[i],
  })).filter((item) => item.tempo <= limite && Number.isFinite(item.utc));
  const ultimo = itens.at(-1);
  if (!ultimo || agora.getTime() - ultimo.utc > 3 * 3600000 || ultimo.utc > agora.getTime() + 15 * 60000) {
    return vazio("Série histórica do modelo ausente ou anterior à janela de atualização de 3 horas.");
  }
  const valido = (item) => Number.isFinite(item.mm) && item.mm >= 0 && item.mm <= 500;
  const somar = (lista) => lista.some(valido)
    ? Math.round(lista.filter(valido).reduce((soma, item) => soma + item.mm, 0) * 10) / 10
    : null;
  const dia = local.slice(0, 10);
  const hoje = itens.filter((item) => item.tempo.slice(0, 10) === dia && item.tempo.slice(11, 13) !== "00");
  const ultimas24h = itens.filter((item) => item.utc > limiteUtc - 24 * 3600000 && item.utc <= limiteUtc);
  const ultimaValida = itens.filter((item) => item.utc > limiteUtc - 3 * 3600000 && valido(item)).at(-1);
  const horasEsperadasDia = Number(local.slice(11, 13));
  const horasDiaValidas = hoje.filter(valido).length;
  const horas24Validas = ultimas24h.filter(valido).length;
  return {
    diaMm: somar(hoje),
    ultimaHoraMm: ultimaValida?.mm ?? null,
    ultimas24hMm: somar(ultimas24h),
    referenciaEm: ultimo.tempo,
    ultimaHoraReferencia: ultimaValida?.tempo || null,
    coberturaDia: { amostras: horasDiaValidas, horasEsperadas: horasEsperadasDia, parcial: horasDiaValidas !== horasEsperadasDia },
    cobertura24h: { amostras: horas24Validas, horasEsperadas: 24, parcial: horas24Validas !== 24 },
    motivoIndisponibilidade: !hoje.some(valido) && !ultimas24h.some(valido)
      ? "Precipitação histórica sem horas numéricas válidas." : null,
    consultadoEm: agora.toISOString(),
    tipoDado: "estimado",
  };
}

function normalizarRespostaOpenMeteo(json, latitude, longitude, {
  inicioHora = INICIO_JANELA_HOJE,
  fimHora = 24,
  agregarJanela = false,
  fuso = "America/Sao_Paulo",
  now = null,
  url = null,
  modelo = MODELO_PRINCIPAL,
  modelosIndicadores = {},
  diagnósticosIndicadores = [],
  cache = null,
} = {}) {
  validarResposta(json, fuso, { latitude, longitude });
  const estimativaChuva = agregarChuvaEstimada(json, now || new Date());
  const horas = json.hourly;
  const dia = json.daily;
  const agoraLocal = now ? null : json.current?.time;
  const horaAtualModeloIso = horaLocalParaIso(json.current?.time, json.utc_offset_seconds);
  const dataReferencia = now ? partesLocais(now, fuso).data
    : agoraLocal?.slice(0, 10) || partesLocais(new Date(), fuso).data;
  const indiceDiaAtual = dia.time.indexOf(dataReferencia);
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

  // Um total rotulado como previsão não incorpora intervalos já transcorridos.
  // A estimativa modelada decorrida é calculada separadamente abaixo.
  const localConsulta = partesLocais(now || new Date(), fuso);
  const inicioFuturo = Math.max(inicioHora,
    localConsulta.data === dataReferencia ? localConsulta.hora + (localConsulta.minuto > 0 ? 1 : 0) : inicioHora);
  const periodos = {
    manha: resumirPeriodo(horas, "manha", { dataReferencia, inicioHora: inicioFuturo, fimHora }),
    tarde: resumirPeriodo(horas, "tarde", { dataReferencia, inicioHora: inicioFuturo, fimHora }),
    noite: resumirPeriodo(horas, "noite", { dataReferencia, inicioHora: inicioFuturo, fimHora }),
  };
  for (const periodo of Object.values(periodos))
    periodo.rajadaPrevistaEm = horaLocalParaIso(periodo.rajadaPrevistaEm, json.utc_offset_seconds);
  // As tabelas por período do PDF cobrem o dia operacional completo e mantêm
  // os três grupos originais, independentemente da janela do card da edição.
  // Esta visão é derivada da mesma resposta horária, sem nova consulta.
  const periodosDiaCompleto = {
    manha: resumirPeriodo(horas, "manha", { dataReferencia, inicioHora: INICIO_JANELA_HOJE, fimHora: 24 }),
    tarde: resumirPeriodo(horas, "tarde", { dataReferencia, inicioHora: INICIO_JANELA_HOJE, fimHora: 24 }),
    noite: resumirPeriodo(horas, "noite", { dataReferencia, inicioHora: INICIO_JANELA_HOJE, fimHora: 24 }),
  };
  for (const periodo of Object.values(periodosDiaCompleto))
    periodo.rajadaPrevistaEm = horaLocalParaIso(periodo.rajadaPrevistaEm, json.utc_offset_seconds);
  const picoRajada = Object.values(periodos).filter((p) => Number.isFinite(p.rajadaMaxKmh))
    .sort((a, b) => b.rajadaMaxKmh - a.rajadaMaxKmh)[0] || null;
  const rajadaRestante = picoRajadaRestante(horas, {
    dataReferencia, inicioHora, fimHora, agora: now || new Date(), fuso,
    offsetSegundos: json.utc_offset_seconds,
  });

  const valoresDia = (campo) => indicesDia.map((i) => horas[campo]?.[i]).filter(Number.isFinite);
  const umidades = valoresDia("relative_humidity_2m");
  const listaPeriodos = Object.values(periodos).filter((p) => p.disponivel);
  const temTempestadeHoje = listaPeriodos.some((p) => p.tempestade);

  // Importante: os totais/máximos abaixo são derivados dos MESMOS períodos
  // (Manhã/Tarde/Noite, 05h-24h) exibidos nas tabelas — nunca do agregado
  // "dia inteiro" bruto da Open-Meteo (que inclui a madrugada 00h-05h já
  // encerrada). Misturar as duas janelas gerava alarmes de "chuva intensa"
  // baseados em picos de madrugada que já haviam passado na hora da consulta.
  const maximoOuNulo = (valores) => valores.length ? Math.max(...valores) : null;
  const velocidadeMaxKmh = maximoOuNulo(listaPeriodos.map((p) => p.velocidadeMaxKmh).filter(Number.isFinite));
  const valoresUvDia = valoresDia("uv_index");
  const uvMax = Number.isFinite(dia.uv_index_max?.[indiceDiaAtual]) ? dia.uv_index_max[indiceDiaAtual] : maximoOuNulo(valoresUvDia);
  const indiceUvPico = uvMax === null ? -1 : indicesDia.find((i) => horas.uv_index?.[i] === uvMax);
  const proximoDia = new Date(`${dataReferencia}T12:00:00Z`);
  proximoDia.setUTCDate(proximoDia.getUTCDate() + 1);
  const chuvaHoraria = Array.from({ length: Math.max(0, fimHora - inicioHora) }, (_, n) => {
    const horaInicio = inicioHora + n;
    const horaFim = horaInicio + 1;
    const rotuloFim = horaFim === 24 ? `${proximoDia.toISOString().slice(0, 10)}T00:00`
      : `${dataReferencia}T${String(horaFim).padStart(2, "0")}:00`;
    const primeiro = horas.time.indexOf(rotuloFim);
    const indice = primeiro >= 0 && horas.time.lastIndexOf(rotuloFim) === primeiro ? primeiro : -1;
    const valor = indice < 0 ? null : horas.precipitation?.[indice];
    const probabilidade = indice < 0 ? null : horas.precipitation_probability?.[indice];
    return {
      horario: `${String(horaInicio).padStart(2, "0")}:00`,
      intervalo: `${hh(horaInicio)}–${hh(horaFim)}`,
      precipitacaoMm: Number.isFinite(valor) && valor >= 0 ? Math.round(valor * 10) / 10 : null,
      probabilidade: Number.isFinite(probabilidade) && probabilidade >= 0 && probabilidade <= 100
        ? Math.round(probabilidade) : null,
    };
  });
  const coberturaHorariaCompleta = chuvaHoraria.length === fimHora - inicioHora && chuvaHoraria.length > 0;
  const valoresChuvaJanela = chuvaHoraria.map((item) => item.precipitacaoMm);
  const valoresProbabilidadeJanela = chuvaHoraria.map((item) => item.probabilidade);
  const precipitacaoTotalMm = coberturaHorariaCompleta && valoresChuvaJanela.every(Number.isFinite)
    ? Math.round(valoresChuvaJanela.reduce((soma, valor) => soma + valor, 0) * 10) / 10 : null;
  const precipitacaoHorariaMaxMm = coberturaHorariaCompleta && valoresChuvaJanela.every(Number.isFinite)
    ? Math.max(...valoresChuvaJanela) : null;
  const probabilidadeChuvaMax = coberturaHorariaCompleta && valoresProbabilidadeJanela.every(Number.isFinite)
    ? Math.max(...valoresProbabilidadeJanela) : null;
  const chuvaAcumuladaEstimada = acumularPrecipitacaoDecorrida(horas, { now: now || new Date(), agoraLocal, fuso });

  return {
    fonte: "Open-Meteo",
    modelo,
    modelosIndicadores,
    diagnosticosIndicadores: diagnósticosIndicadores,
    cache,
    consultadoEm: (now || new Date()).toISOString(),
    url: url ? new URL(url).origin + new URL(url).pathname : null,
    dataReferencia,
    fuso,
    janelaHoje: { inicioHora, fimHora, rotulo: `${hh(inicioHora)}–${hh(fimHora)}` },
    condicaoGeral: !agregarJanela
      ? descreverCodigo(dia.weather_code?.[indiceDiaAtual])
      : descreverCodigo(horas.weather_code?.[indicesJanela[0]]),
    atual: json.current ? {
      temperaturaC: Number.isFinite(json.current.temperature_2m) ? json.current.temperature_2m : null,
      umidadePct: Number.isFinite(json.current.relative_humidity_2m) ? json.current.relative_humidity_2m : null,
      codigo: json.current.weather_code ?? null,
      condicao: descreverCodigo(json.current.weather_code),
      dia: json.current.is_day === 1,
      horario: horaAtualModeloIso,
      horarioLocal: json.current.time,
      fonte: "Open-Meteo — estimativa modelada",
      // Apesar do nome "current", a fonte calcula este bloco com dados de
      // modelos meteorológicos; não se trata de observação de estação.
      previsao: true,
    } : null,
    tempMin: !agregarJanela ? (Number.isFinite(dia.temperature_2m_min?.[indiceDiaAtual]) ? Math.round(dia.temperature_2m_min[indiceDiaAtual]) : null) : minimoJanela("temperature_2m"),
    tempMax: !agregarJanela ? (Number.isFinite(dia.temperature_2m_max?.[indiceDiaAtual]) ? Math.round(dia.temperature_2m_max[indiceDiaAtual]) : null) : maximoJanela("temperature_2m"),
    umidadeMin: !agregarJanela ? (umidades.length ? Math.round(Math.min(...umidades)) : null) : minimoJanela("relative_humidity_2m"),
    umidadeMax: !agregarJanela ? (umidades.length ? Math.round(Math.max(...umidades)) : null) : maximoJanela("relative_humidity_2m"),
    precipitacaoTotalMm,
    precipitacaoAcumuladaEstimadaMm: chuvaAcumuladaEstimada.valorMm,
    precipitacaoAcumuladaEstimadaStatus: chuvaAcumuladaEstimada.disponivel ? "operacional" : "indisponivel",
    precipitacaoAcumuladaEstimadaJanela: chuvaAcumuladaEstimada.janela,
    precipitacaoAcumuladaEstimadaCobertura: chuvaAcumuladaEstimada.cobertura,
    precipitacaoAcumuladaEstimadaMotivo: chuvaAcumuladaEstimada.motivo,
    estimativaChuva,
    precipitacaoPrevistaDiaMm: (() => {
      const indice = dia.time.indexOf(dataReferencia);
      const valor = indice >= 0 ? dia.precipitation_sum?.[indice] : null;
      return Number.isFinite(valor) ? Math.round(valor * 10) / 10 : null;
    })(),
    precipitacaoDiariaMm: Number.isFinite(dia.precipitation_sum?.[indiceDiaAtual]) ? Math.round(dia.precipitation_sum[indiceDiaAtual] * 10) / 10 : null,
    probabilidadeChuvaDiariaPct: Number.isFinite(dia.precipitation_probability_max?.[indiceDiaAtual])
      ? Math.round(dia.precipitation_probability_max[indiceDiaAtual]) : null,
    precipitacaoHorariaMaxMm,
    probabilidadeChuvaMax,
    rajadaMaxKmh: picoRajada?.rajadaMaxKmh ?? null,
    rajadaPrevistaEm: picoRajada?.rajadaPrevistaEm || null,
    rajadaPeriodo: picoRajada?.janela || null,
    rajadaRestanteMaxKmh: rajadaRestante?.valor ?? null,
    rajadaRestantePrevistaEm: rajadaRestante?.em || null,
    rajadaRestantePeriodo: rajadaRestante?.janela || null,
    velocidadeMaxKmh,
    uvAtual: Number.isFinite(json.current?.uv_index) && json.current.uv_index >= 0 && json.current.uv_index <= 30
      ? Math.round(json.current.uv_index * 10) / 10 : null,
    uvAtualReferenciaEm: horaAtualModeloIso || null,
    uvMax: uvMax == null ? null : Math.round(uvMax * 10) / 10,
    uvClassificacao: classificarIndiceUv(uvMax),
    horaPicoUv: indiceUvPico >= 0 ? horas.time[indiceUvPico] : null,
    temTempestadeHoje,
    periodos,
    periodosDiaCompleto,
    chuvaHoraria,
    previsaoDias: dia.time.map((data, i) => ({ data, i })).filter(({ data }) => data >= dataReferencia).map(({ data, i }) => {
      const indices = horas.time.map((instante, indice) => ({ instante, indice }))
        .filter((item) => String(item.instante).slice(0, 10) === data)
        .map((item) => item.indice);
      const umidadeDia = indices.map((indice) => horas.relative_humidity_2m?.[indice]).filter(Number.isFinite);
      return ({
      data,
      condicao: descreverCodigo(dia.weather_code?.[i]),
      tempMin: Number.isFinite(dia.temperature_2m_min?.[i]) ? dia.temperature_2m_min[i] : null,
      tempMax: Number.isFinite(dia.temperature_2m_max?.[i]) ? dia.temperature_2m_max[i] : null,
      umidadeMin: umidadeDia.length ? Math.round(Math.min(...umidadeDia)) : null,
      umidadeMax: umidadeDia.length ? Math.round(Math.max(...umidadeDia)) : null,
      // Agregado diário da fonte no dia civil local (00h–24h).
      janela: "00h–24h",
      chuvaMm: Number.isFinite(dia.precipitation_sum?.[i]) ? Math.round(dia.precipitation_sum[i] * 10) / 10 : null,
      probabilidadeChuvaPct: Number.isFinite(dia.precipitation_probability_max?.[i]) ? Math.round(dia.precipitation_probability_max[i]) : null,
      uvMax: Number.isFinite(dia.uv_index_max?.[i]) ? Math.round(dia.uv_index_max[i] * 10) / 10 : null,
      rajadaKmh: Number.isFinite(dia.wind_gusts_10m_max?.[i]) ? Math.round(dia.wind_gusts_10m_max[i] * 10) / 10 : null,
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
  normalizarRespostaOpenMeteo,
  resumirPeriodo,
  criarUrlPublicaOpenMeteo,
  acumularPrecipitacaoDecorrida,
};
