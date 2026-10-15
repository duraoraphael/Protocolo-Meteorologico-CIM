// Fonte: Open-Meteo Air Quality (https://open-meteo.com/en/docs/air-quality-api)
// A produção usa o endpoint comercial customer-* com chave. Fornece material particulado (PM2.5/PM10)
// e poeira, além do índice UV previsto pelo CAMS/Open-Meteo.
//
// Relevante para o protocolo do CIM por qualidade do ar respirável, especialmente em bases próximas a
//   polos industriais/refinarias e em períodos de queimadas.

const {
  API_TIMEOUT_MS,
  API_TENTATIVAS,
  buscarJsonComRetentativa,
} = require("./httpJsonClient");
const { aplicarConfiguracaoOpenMeteo, removerCredenciaisOpenMeteo } = require("./openMeteoConfig");

const OPEN_METEO_AIR_TIMEOUT_MS = API_TIMEOUT_MS;
const OPEN_METEO_AIR_TENTATIVAS = API_TENTATIVAS;

function classificarUv(uv) {
  if (uv === null || uv === undefined) return { nivel: "Sem dado", categoria: null };
  if (uv < 3) return { nivel: "Baixo", categoria: "baixo" };
  if (uv < 6) return { nivel: "Moderado", categoria: "moderado" };
  if (uv < 8) return { nivel: "Alto", categoria: "alto" };
  if (uv < 11) return { nivel: "Muito alto", categoria: "muito_alto" };
  return { nivel: "Extremo", categoria: "extremo" };
}

// European Air Quality Index publicado pela Open-Meteo a partir dos dados
// CAMS. Os limites são os do índice europeu documentado pela própria API.
function classificarAqiEuropeu(aqi) {
  if (!Number.isFinite(aqi)) return { nivel: "Sem dado", categoria: null };
  if (aqi <= 20) return { nivel: "Boa", categoria: "boa" };
  if (aqi <= 40) return { nivel: "Razoável", categoria: "razoavel" };
  if (aqi <= 60) return { nivel: "Moderada", categoria: "moderada" };
  if (aqi <= 80) return { nivel: "Ruim", categoria: "ruim" };
  if (aqi <= 100) return { nivel: "Muito ruim", categoria: "muito_ruim" };
  return { nivel: "Extremamente ruim", categoria: "extremamente_ruim" };
}

function maximo(valores) {
  const validos = (valores || []).filter(Number.isFinite);
  return validos.length ? Math.max(...validos) : null;
}

function media(valores) {
  const validos = (valores || []).filter(Number.isFinite);
  if (!validos.length) return null;
  return validos.reduce((a, b) => a + b, 0) / validos.length;
}

function arredondar(valor, casas = 1) {
  if (valor === null) return null;
  const f = Math.pow(10, casas);
  return Math.round(valor * f) / f;
}

async function buscarQualidadeAr(latitude, longitude, {
  fuso = "America/Sao_Paulo",
  fetchImpl = fetch,
  timeoutMs = OPEN_METEO_AIR_TIMEOUT_MS,
  esperarFn,
  logger,
} = {}) {
  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    hourly: "pm10,pm2_5,dust,carbon_monoxide,european_aqi_pm2_5,uv_index",
    timezone: fuso,
    forecast_days: "1",
  });

  const url = aplicarConfiguracaoOpenMeteo(`https://air-quality-api.open-meteo.com/v1/air-quality?${params.toString()}`);

  const json = await buscarJsonComRetentativa(url, {
    nomeFonte: "Open-Meteo Air Quality",
    fetchImpl,
    timeoutMs,
    tentativas: OPEN_METEO_AIR_TENTATIVAS,
    esperarFn,
    logger: logger === undefined && fetchImpl === globalThis.fetch ? console : logger,
    prefixoLog: "OPEN-METEO-AIR",
  });
  if (json.timezone && json.timezone !== fuso) {
    const erro = new Error(`Open-Meteo Air Quality retornou fuso divergente (${json.timezone}).`);
    erro.name = "ParserError";
    throw erro;
  }
  const horas = json.hourly || {};
  if (!Array.isArray(horas.time) || !horas.time.length) {
    const erro = new Error("Open-Meteo Air Quality retornou payload sem série horária.");
    erro.name = "ParserError";
    throw erro;
  }

  const pm25Medio = media(horas.pm2_5);
  const aqiPm25 = maximo(horas.european_aqi_pm2_5);
  const pm10Medio = media(horas.pm10);
  const poeiraMax = maximo(horas.dust);
  const uvMax = maximo(horas.uv_index);
  const indicePicoUv = Array.isArray(horas.uv_index) && Number.isFinite(uvMax)
    ? horas.uv_index.findIndex((valor) => valor === uvMax)
    : -1;

  return {
    fonte: "Open-Meteo Air Quality / CAMS",
    url: removerCredenciaisOpenMeteo(url),
    pm25Medio: arredondar(pm25Medio),
    aqiPm25: arredondar(aqiPm25),
    pm25Classificacao: classificarAqiEuropeu(aqiPm25),
    pm10Medio: arredondar(pm10Medio),
    poeiraMax: arredondar(poeiraMax),
    uvMax: arredondar(uvMax),
    horaPicoUv: indicePicoUv >= 0 ? String(horas.time[indicePicoUv]).slice(11, 16) : null,
    uvClassificacao: classificarUv(uvMax),
  };
}

module.exports = {
  buscarQualidadeAr,
  classificarUv,
  classificarAqiEuropeu,
  OPEN_METEO_AIR_TIMEOUT_MS,
  OPEN_METEO_AIR_TENTATIVAS,
};
