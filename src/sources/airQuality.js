const { buscarJsonComRetentativa } = require("./httpJsonClient");
const { aplicarConfiguracaoOpenMeteo, removerCredenciaisOpenMeteo } = require("./openMeteoConfig");

const SOURCE = "Open-Meteo Air Quality / CAMS";
const VARS = ["pm2_5", "pm10", "ozone", "nitrogen_dioxide", "sulphur_dioxide", "carbon_monoxide"];
const POLUENTES = Object.freeze({
  pm10: { nome: "MP10", unidade: "µg/m³", horas: 24, faixas: [[45,40],[100,80],[150,120],[250,200],[600,400]] },
  pm2_5: { nome: "MP2,5", unidade: "µg/m³", horas: 24, faixas: [[15,40],[50,80],[75,120],[125,200],[300,400]] },
  ozone: { nome: "O₃", unidade: "µg/m³", horas: 8, faixas: [[100,40],[130,80],[160,120],[200,200],[800,400]] },
  nitrogen_dioxide: { nome: "NO₂", unidade: "µg/m³", horas: 1, faixas: [[200,40],[240,80],[320,120],[1130,200],[3750,400]] },
  sulphur_dioxide: { nome: "SO₂", unidade: "µg/m³", horas: 24, faixas: [[40,40],[50,80],[125,120],[800,200],[2620,400]] },
});

function calcularSubindice(concentracao, faixas) {
  if (!Number.isFinite(concentracao) || concentracao < 0 || concentracao > faixas.at(-1)[0]) return null;
  let limiteConcentracao = 0;
  let limiteIndice = 0;
  for (const [cHigh, iHigh] of faixas) {
    if (concentracao <= cHigh) {
      const calculado = limiteIndice + ((iHigh - limiteIndice) / (cHigh - limiteConcentracao)) * (concentracao - limiteConcentracao);
      return Math.round(calculado);
    }
    limiteConcentracao = cHigh;
    limiteIndice = iHigh;
  }
  return null;
}

function mediaNoFimDaJanela(times, values, fim, horas) {
  const inicio = Date.parse(`${fim}:00Z`);
  const alvo = Array.from({ length: horas }, (_, i) => new Date(inicio - (horas - 1 - i) * 3600000).toISOString().slice(0, 16));
  const indices = new Map(times.map((t, i) => [t.slice(0, 16), i]));
  const selecionados = alvo.map((ts) => indices.get(ts));
  if (selecionados.some((i) => i === undefined)) return null;
  const dados = selecionados.map((i) => values[i]);
  if (dados.some((n) => !Number.isFinite(n) || n < 0)) return null;
  return dados.reduce((a, b) => a + b, 0) / dados.length;
}

function calcularIQAr(json, { now = new Date() } = {}) {
  const h = json?.hourly;
  if (!Array.isArray(h?.time) || !h.time.length) throw new Error("CAMS sem série horária de tempo.");
  for (const v of VARS) {
    if (!Array.isArray(h[v]) || h[v].length !== h.time.length) throw new Error(`CAMS sem série alinhada para ${v}.`);
  }
  const unidades = json.hourly_units || {};
  for (const v of Object.keys(POLUENTES)) if (!/µg\/m³|μg\/m³/i.test(unidades[v] || "")) throw new Error(`Unidade ausente ou incompatível para ${v}.`);
  const offset = Number(json.utc_offset_seconds || 0);
  const horaLocal = new Date(now.getTime() + offset * 1000).toISOString().slice(0, 13);
  const disponiveis = h.time.filter((t) => t.slice(0, 13) <= horaLocal);
  if (!disponiveis.length) throw new Error("CAMS não retornou observação estimada até a hora atual.");
  const fim = disponiveis.at(-1);
  if (Date.parse(`${fim}:00Z`) < Date.parse(`${horaLocal}:00Z`) - 3 * 3600000) throw new Error("CAMS sem estimativa recente (defasagem acima de 3 horas).");
  const subindices = [];
  for (const [chave, meta] of Object.entries(POLUENTES)) {
    const media = mediaNoFimDaJanela(h.time, h[chave], fim, meta.horas);
    const indice = media === null ? null : calcularSubindice(media, meta.faixas);
    if (indice !== null) subindices.push({ poluente: meta.nome, concentracao: media, unidade: meta.unidade, periodoHoras: meta.horas, indice });
  }
  if (!subindices.length) throw new Error("CAMS não forneceu janelas completas para calcular IQAr brasileiro.");
  const pior = subindices.reduce((a, b) => b.indice > a.indice ? b : a);
  return {
    iqar: pior.indice,
    classificacao: classificarIQAr(pior.indice),
    subindiceResponsavel: pior.poluente,
    subindices,
    referenciaEm: fim,
    consultadoEm: now.toISOString(),
    coordenadaGrade: { latitude: json.latitude, longitude: json.longitude },
  };
}

function classificarIQAr(indice) {
  if (!Number.isFinite(indice)) return null;
  if (indice <= 40) return { nivel: "Boa", exibicao: "Boa (Normal)", cor: "#00843D" };
  if (indice <= 80) return { nivel: "Moderada", exibicao: "Moderada", cor: "#F2C500" };
  if (indice <= 120) return { nivel: "Ruim", exibicao: "Ruim", cor: "#E87500" };
  if (indice <= 200) return { nivel: "Muito Ruim", exibicao: "Muito Ruim", cor: "#D92828" };
  if (indice <= 400) return { nivel: "Péssima", exibicao: "Péssima", cor: "#7826A8" };
  return null;
}

function criarUrl(cidade) {
  const url = new URL("https://air-quality-api.open-meteo.com/v1/air-quality");
  url.searchParams.set("latitude", cidade.latitude);
  url.searchParams.set("longitude", cidade.longitude);
  url.searchParams.set("hourly", VARS.join(","));
  url.searchParams.set("timezone", cidade.fusoHorario || "America/Sao_Paulo");
  url.searchParams.set("past_hours", "48");
  url.searchParams.set("forecast_hours", "1");
  return url.toString();
}

async function buscarQualidadeAr(cidade, { fetchImpl = fetch, now = new Date(), env = process.env } = {}) {
  const apiKey = String(env.OPEN_METEO_API_KEY || "").trim();
  if (!apiKey) {
    const error = new Error("Licença comercial da Open-Meteo/CAMS não configurada (OPEN_METEO_API_KEY ausente).");
    error.code = "OPEN_METEO_COMMERCIAL_LICENSE_REQUIRED";
    throw error;
  }
  const url = aplicarConfiguracaoOpenMeteo(criarUrl(cidade), env);
  const json = await buscarJsonComRetentativa(url, { nomeFonte: SOURCE, fetchImpl });
  const dados = calcularIQAr(json, { now });
  return {
    ...dados,
    fonte: "Qualidade do ar estimada — Open-Meteo/CAMS",
    fonteTipo: "estimativa_modelada",
    latitudeSolicitada: cidade.latitude,
    longitudeSolicitada: cidade.longitude,
    url: removerCredenciaisOpenMeteo(url),
  };
}

module.exports = { SOURCE, VARS, POLUENTES, calcularSubindice, calcularIQAr, classificarIQAr, buscarQualidadeAr };
