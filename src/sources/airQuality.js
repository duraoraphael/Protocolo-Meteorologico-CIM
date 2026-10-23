const { buscarJsonComRetentativa } = require("./httpJsonClient");
const { aplicarConfiguracaoOpenMeteo, removerCredenciaisOpenMeteo } = require("./openMeteoConfig");

const SOURCE = "Open-Meteo Air Quality / CAMS";
const VARS = ["us_aqi", "pm2_5", "pm10"];
const FUSO = "America/Sao_Paulo";

function classificarIQAr(indice) {
  if (!Number.isFinite(indice) || indice < 0) return null;
  const gravidadeOriginal = indice <= 50 ? "Boa"
    : indice <= 100 ? "Moderada"
    : indice <= 150 ? "Insalubre para grupos sensíveis"
    : indice <= 200 ? "Insalubre"
    : indice <= 300 ? "Muito insalubre" : "Perigosa";
  if (indice <= 50) return { nivel: "Normal", exibicao: "NORMAL", cor: "#00843D", gravidadeOriginal };
  if (indice <= 100) return { nivel: "Moderado", exibicao: "MODERADO", cor: "#F2C500", gravidadeOriginal };
  return { nivel: "Ruim", exibicao: "RUIM", cor: "#D92828", gravidadeOriginal };
}

function calcularIQAr(json, { now = new Date(), fuso = FUSO } = {}) {
  const h = json?.hourly;
  if (json?.timezone !== fuso || (!Array.isArray(h?.time) && !json?.current)) {
    throw new Error("Open-Meteo Air Quality sem série horária ou fuso esperado.");
  }
  const validarUnidades = (unidades) => {
    if (unidades.us_aqi !== "USAQI") throw new Error("Unidade inesperada para us_aqi.");
    for (const campo of ["pm2_5", "pm10"]) {
      if (!/^[µμ]g\/m³$/.test(unidades[campo] || "")) throw new Error(`Unidade ausente ou incompatível para ${campo}.`);
    }
  };
  const horaLocal = new Intl.DateTimeFormat("sv-SE", {
    timeZone: fuso, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23",
  }).format(now).replace(" ", "T");
  const offset = Number(json.utc_offset_seconds);
  if (!Number.isFinite(offset)) throw new Error("Open-Meteo Air Quality sem deslocamento UTC válido.");
  const recente = (tempo) => {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(tempo || "")) return false;
    const utc = Date.parse(`${tempo}:00Z`) - offset * 1000;
    const atraso = now.getTime() - utc;
    return Number.isFinite(utc) && atraso >= -15 * 60_000 && atraso <= 3 * 3_600_000;
  };
  let dados = null;
  let currentUnidadesValidas = false;
  try { validarUnidades(json.current_units || {}); currentUnidadesValidas = true; } catch {}
  if (json.current && Number.isFinite(json.current.us_aqi) && json.current.us_aqi >= 0
      && ["pm2_5", "pm10"].every((campo) => Number.isFinite(json.current[campo]) && json.current[campo] >= 0)
      && json.current.time <= `${horaLocal}:00` && recente(json.current.time) && currentUnidadesValidas) {
    dados = { ...json.current, referenciaEm: json.current.time };
  }
  if (!dados) {
    if (!Array.isArray(h?.time) || !h.time.length) throw new Error("Open-Meteo Air Quality sem série horária ou fuso esperado.");
    for (const campo of VARS) {
      if (!Array.isArray(h[campo]) || h[campo].length !== h.time.length) throw new Error(`Open-Meteo Air Quality sem série alinhada para ${campo}.`);
    }
    if (h.time.some((t, i) => !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(t)
        || (i > 0 && t <= h.time[i - 1]))) throw new Error("Open-Meteo Air Quality com timestamps inválidos ou duplicados.");
    validarUnidades(json.hourly_units || {});
    const indice = h.time.findLastIndex((t, i) => t.slice(0, 13) <= horaLocal
      && recente(t) && Number.isFinite(h.us_aqi[i]) && h.us_aqi[i] >= 0
      && ["pm2_5", "pm10"].every((campo) => Number.isFinite(h[campo][i]) && h[campo][i] >= 0));
    if (indice < 0) throw new Error("Open-Meteo Air Quality sem estimativa recente ou US AQI válido.");
    dados = { us_aqi: h.us_aqi[indice], pm2_5: h.pm2_5[indice], pm10: h.pm10[indice], referenciaEm: h.time[indice] };
  }
  const iqar = Math.round(dados.us_aqi);
  return {
    iqar, indiceTipo: "US AQI", classificacao: classificarIQAr(iqar),
    pm25: Number.isFinite(dados.pm2_5) && dados.pm2_5 >= 0 ? dados.pm2_5 : null,
    pm10: Number.isFinite(dados.pm10) && dados.pm10 >= 0 ? dados.pm10 : null,
    referenciaEm: dados.referenciaEm, consultadoEm: now.toISOString(),
    coordenadaGrade: { latitude: json.latitude, longitude: json.longitude },
  };
}

function criarUrl(cidade) {
  const url = new URL("https://air-quality-api.open-meteo.com/v1/air-quality");
  url.searchParams.set("latitude", cidade.latitude);
  url.searchParams.set("longitude", cidade.longitude);
  url.searchParams.set("hourly", VARS.join(","));
  url.searchParams.set("current", VARS.join(","));
  url.searchParams.set("timezone", cidade.fusoHorario || FUSO);
  url.searchParams.set("past_hours", "6");
  url.searchParams.set("forecast_hours", "1");
  return url.toString();
}

async function buscarQualidadeAr(cidade, { fetchImpl = fetch, now = new Date(), env = process.env } = {}) {
  const url = aplicarConfiguracaoOpenMeteo(criarUrl(cidade), env);
  const json = await buscarJsonComRetentativa(url, { nomeFonte: SOURCE, fetchImpl });
  return {
    ...calcularIQAr(json, { now, fuso: cidade.fusoHorario || FUSO }),
    fonte: "Qualidade do ar estimada — Open-Meteo/CAMS",
    fonteTipo: "estimativa_modelada",
    modoLicenca: String(env.OPEN_METEO_API_KEY || "").trim() ? "comercial" : "avaliacao_local",
    fuso: cidade.fusoHorario || FUSO,
    latitudeSolicitada: cidade.latitude,
    longitudeSolicitada: cidade.longitude,
    url: removerCredenciaisOpenMeteo(url),
  };
}

module.exports = { SOURCE, VARS, classificarIQAr, calcularIQAr, buscarQualidadeAr };
