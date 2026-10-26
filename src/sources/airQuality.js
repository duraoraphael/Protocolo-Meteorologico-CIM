const { buscarJsonComRetentativa } = require("./httpJsonClient");
const { aplicarConfiguracaoOpenMeteo, removerCredenciaisOpenMeteo, apiPublicaPermitida } = require("./openMeteoConfig");

const SOURCE = "Open-Meteo Air Quality / CAMS";
const CURRENT_VARIABLES = Object.freeze(["uv_index", "us_aqi", "pm2_5", "pm10"]);
const AQI_MAX_AGE_MS = 4 * 60 * 60 * 1000;
const AQI_GRID_MAX_DISTANCE_KM = 100;
const CACHE_TTL_MS = 15 * 60 * 1000;
const cache = new Map();

function numeroValido(valor) {
  if (typeof valor === "number") return Number.isFinite(valor) ? valor : null;
  if (typeof valor !== "string" || !valor.trim()) return null;
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
}

function classificarUsAqi(valor) {
  if (!Number.isFinite(valor) || valor < 0 || valor > 500) return null;
  if (valor <= 50) return { nivel: "NORMAL", exibicao: "NORMAL", cor: "#00843D" };
  if (valor <= 100) return { nivel: "MODERADO", exibicao: "MODERADO", cor: "#F2C500" };
  return { nivel: "RUIM", exibicao: "RUIM", cor: "#D92828" };
}

function classificarIndiceUv(valor) {
  if (!Number.isFinite(valor) || valor < 0 || valor > 30) return null;
  if (valor < 3) return { nivel: "BAIXO" };
  if (valor < 6) return { nivel: "MODERADO" };
  if (valor < 8) return { nivel: "ALTO" };
  if (valor < 11) return { nivel: "MUITO ALTO" };
  return { nivel: "EXTREMO" };
}

function instanteEmUtc(time, offsetSegundos = 0) {
  if (typeof time !== "string" || !time.trim()) return null;
  const comFusoExplicito = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(time);
  const parsed = Date.parse(comFusoExplicito ? time : `${time}Z`);
  if (!Number.isFinite(parsed)) return null;
  return new Date(comFusoExplicito ? parsed : parsed - offsetSegundos * 1000);
}

function distanciaKm(lat1, lon1, lat2, lon2) {
  const rad = (valor) => valor * Math.PI / 180;
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function validarAtual(json, { now = new Date(), cidade } = {}) {
  const atual = json?.current;
  if (json?.timezone !== (cidade.fusoHorario || "America/Sao_Paulo")
      || !Number.isFinite(json?.utc_offset_seconds)) {
    const erro = new Error("Open-Meteo Air Quality retornou fuso ou deslocamento UTC ausente ou divergente.");
    erro.name = "ParserError";
    erro.code = "OPEN_METEO_AQI_TIMEZONE_MISMATCH";
    throw erro;
  }
  for (const [campo, unidade] of [["uv_index", ""], ["us_aqi", "USAQI"], ["pm2_5", "μg/m³"], ["pm10", "μg/m³"]]) {
    const recebida = json?.current_units?.[campo];
    if (recebida != null && recebida !== unidade) {
      const erro = new Error(`Open-Meteo Air Quality retornou unidade inesperada para ${campo}: ${recebida}.`);
      erro.name = "ParserError";
      erro.code = "OPEN_METEO_AQI_INVALID_UNIT";
      throw erro;
    }
  }
  const indice = numeroValido(atual?.us_aqi);
  const classificacao = classificarUsAqi(indice);
  const uvAtual = numeroValido(atual?.uv_index);
  const uvClassificacao = classificarIndiceUv(uvAtual);
  const referencia = instanteEmUtc(atual?.time, numeroValido(json?.utc_offset_seconds) || 0);
  if (!atual || (!classificacao && !uvClassificacao) || !referencia) {
    const erro = new Error("Open-Meteo Air Quality não retornou UV ou AQI atual numérico, válido e com horário.");
    erro.name = "ParserError";
    erro.code = "OPEN_METEO_AQI_INVALID";
    throw erro;
  }
  const idadeMs = now.getTime() - referencia.getTime();
  if (idadeMs < -30 * 60 * 1000 || idadeMs > AQI_MAX_AGE_MS) {
    const erro = new Error("Open-Meteo Air Quality retornou AQI fora da janela de atualização aceita.");
    erro.name = "ParserError";
    erro.code = "OPEN_METEO_AQI_STALE";
    throw erro;
  }
  const latitude = numeroValido(json.latitude);
  const longitude = numeroValido(json.longitude);
  if (latitude === null || longitude === null) {
    const erro = new Error("Open-Meteo Air Quality não informou as coordenadas da grade consultada.");
    erro.name = "ParserError";
    erro.code = "OPEN_METEO_AQI_LOCATION_INVALID";
    throw erro;
  }
  const distanciaGradeKm = distanciaKm(cidade.latitude, cidade.longitude, latitude, longitude);
  if (distanciaGradeKm > AQI_GRID_MAX_DISTANCE_KM) {
    const erro = new Error(`Open-Meteo Air Quality retornou célula de grade a ${Math.round(distanciaGradeKm)} km das coordenadas solicitadas.`);
    erro.name = "ParserError";
    erro.code = "OPEN_METEO_AQI_LOCATION_MISMATCH";
    throw erro;
  }
  const pm25 = numeroValido(atual.pm2_5);
  const pm10 = numeroValido(atual.pm10);
  for (const [name, value] of [["pm2_5", pm25], ["pm10", pm10]]) {
    if (value !== null && value < 0) {
      const erro = new Error(`Open-Meteo Air Quality retornou valor negativo para ${name}.`);
      erro.name = "ParserError";
      erro.code = "OPEN_METEO_AQI_INVALID_POLLUTANT";
      throw erro;
    }
  }
  return {
    usAqi: classificacao ? indice : null,
    aqiUsMax: classificacao ? indice : null,
    classificacao,
    uvAtual: uvClassificacao ? uvAtual : null,
    uvClassificacao,
    fonteUv: "Open-Meteo Air Quality — UV atual modelado",
    fonte: "Open-Meteo — estimativa modelada de qualidade do ar",
    fonteTipo: "estimativa_modelada",
    referenciaEm: referencia.toISOString(),
    consultadoEm: now.toISOString(),
    latitudeSolicitada: cidade.latitude,
    longitudeSolicitada: cidade.longitude,
    coordenadaGrade: { latitude, longitude },
    distanciaGradeKm: Math.round(distanciaGradeKm * 10) / 10,
    pm25Medio: pm25,
    pm10Medio: pm10,
    cacheHit: false,
  };
}

function criarUrl(cidade) {
  const url = new URL("https://air-quality-api.open-meteo.com/v1/air-quality");
  url.searchParams.set("latitude", cidade.latitude);
  url.searchParams.set("longitude", cidade.longitude);
  url.searchParams.set("current", CURRENT_VARIABLES.join(","));
  url.searchParams.set("timezone", cidade.fusoHorario || "America/Sao_Paulo");
  url.searchParams.set("domains", "cams_global");
  return url.toString();
}

function chaveCache(cidade) {
  return `${cidade.chave || ""}:${cidade.latitude}:${cidade.longitude}`;
}

async function buscarQualidadeAr(cidade, {
  fetchImpl = fetch,
  now = new Date(),
  env = process.env,
  usarCache = true,
  cacheInstance = cache,
} = {}) {
  const apiKey = String(env.OPEN_METEO_API_KEY || "").trim();
  if (!apiKey && !apiPublicaPermitida(env)) {
    const error = new Error("Licença comercial da Open-Meteo não configurada (OPEN_METEO_API_KEY ausente).");
    error.code = "OPEN_METEO_COMMERCIAL_LICENSE_REQUIRED";
    throw error;
  }
  const key = chaveCache(cidade);
  const anterior = usarCache ? cacheInstance.get(key) : null;
  const idadeCache = anterior ? now.getTime() - anterior.guardadoEm : Infinity;
  const idadeDado = anterior ? now.getTime() - Date.parse(anterior.dados.referenciaEm) : Infinity;
  if (anterior && idadeCache >= 0 && idadeCache < CACHE_TTL_MS
      && idadeDado >= -30 * 60 * 1000 && idadeDado <= AQI_MAX_AGE_MS) {
    return { ...anterior.dados, consultadoEm: now.toISOString(), cacheHit: true };
  }

  const url = aplicarConfiguracaoOpenMeteo(criarUrl(cidade), env);
  const json = await buscarJsonComRetentativa(url, { nomeFonte: SOURCE, fetchImpl });
  const dados = validarAtual(json, { now, cidade });
  dados.url = removerCredenciaisOpenMeteo(url);
  if (usarCache) cacheInstance.set(key, { guardadoEm: now.getTime(), dados });
  return dados;
}

module.exports = {
  SOURCE,
  CURRENT_VARIABLES,
  AQI_MAX_AGE_MS,
  AQI_GRID_MAX_DISTANCE_KM,
  CACHE_TTL_MS,
  classificarUsAqi,
  classificarIndiceUv,
  validarAtual,
  criarUrlPublicaQualidadeAr: criarUrl,
  buscarQualidadeAr,
};
