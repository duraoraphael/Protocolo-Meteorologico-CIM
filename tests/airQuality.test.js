const test = require("node:test");
const assert = require("node:assert/strict");
const { calcularIQAr, classificarIQAr, buscarQualidadeAr, VARS } = require("../src/sources/airQuality");
const { CIDADES } = require("../src/config/cities");

function payload(aqi = 75) {
  return {
    latitude: -23.95, longitude: -46.3, timezone: "America/Sao_Paulo", utc_offset_seconds: -10800,
    hourly_units: { us_aqi: "USAQI", pm2_5: "µg/m³", pm10: "µg/m³" },
    hourly: { time: ["2026-10-23T09:00", "2026-10-23T10:00"], us_aqi: [aqi, aqi], pm2_5: [10, 11], pm10: [20, 21] },
  };
}

test("US AQI usa as três faixas do card e preserva gravidade original", () => {
  for (const [valor, nivel] of [[0,"Normal"],[50,"Normal"],[51,"Moderado"],[100,"Moderado"],[101,"Ruim"],[150,"Ruim"],[151,"Ruim"],[301,"Ruim"]]) {
    assert.equal(classificarIQAr(valor).nivel, nivel);
  }
  assert.equal(classificarIQAr(101).gravidadeOriginal, "Insalubre para grupos sensíveis");
  assert.equal(classificarIQAr(301).gravidadeOriginal, "Perigosa");
  assert.equal(classificarIQAr(null), null);
});

test("seleciona índice e partículas da mesma hora modelada", () => {
  const dados = calcularIQAr(payload(), { now: new Date("2026-10-23T13:30:00Z") });
  assert.equal(dados.iqar, 75);
  assert.equal(dados.indiceTipo, "US AQI");
  assert.equal(dados.pm25, 11);
  assert.equal(dados.pm10, 21);
  assert.equal(dados.referenciaEm, "2026-10-23T10:00");
});

test("prioriza current válido e recorre ao hourly quando current está antigo", () => {
  const json = payload(75);
  json.current_units = { ...json.hourly_units };
  json.current = { time: "2026-10-23T10:00", interval: 3600, us_aqi: 101, pm2_5: 25, pm10: 40 };
  const agora = new Date("2026-10-23T13:30:00Z");
  assert.equal(calcularIQAr(json, { now: agora }).iqar, 101);
  assert.equal(calcularIQAr(json, { now: agora }).pm25, 25);
  json.current.time = "2026-10-22T10:00";
  assert.equal(calcularIQAr(json, { now: agora }).iqar, 75);
  json.current.time = "2026-10-23T10:00";
  json.current_units.pm10 = "ppm";
  assert.equal(calcularIQAr(json, { now: agora }).iqar, 75);
});

test("resposta vazia, série desalinhada e estimativa antiga não produzem índice", () => {
  assert.throws(() => calcularIQAr({ ...payload(), hourly: {} }), /série horária/);
  const desalinhada = payload(); desalinhada.hourly.pm10 = [20];
  assert.throws(() => calcularIQAr(desalinhada), /série alinhada/);
  assert.throws(() => calcularIQAr(payload(), { now: new Date("2026-10-23T20:00:00Z") }), /estimativa recente/);
});

test("consulta local de avaliação e endpoint comercial usam coordenadas da base", async () => {
  const cidade = CIDADES.santos;
  await assert.rejects(buscarQualidadeAr(cidade, { env: { NODE_ENV: "production" } }), { code: "OPEN_METEO_COMMERCIAL_LICENSE_REQUIRED" });
  let urlAvaliacao;
  const avaliacao = await buscarQualidadeAr(cidade, {
    env: { NODE_ENV: "development" }, now: new Date("2026-10-23T13:30:00Z"),
    fetchImpl: async (url) => { urlAvaliacao = new URL(url); return new Response(JSON.stringify(payload()), { status: 200 }); },
  });
  assert.equal(urlAvaliacao.hostname, "air-quality-api.open-meteo.com");
  assert.equal(avaliacao.modoLicenca, "avaliacao_local");
  let consultada;
  const dados = await buscarQualidadeAr(cidade, {
    env: { OPEN_METEO_API_KEY: "teste" }, now: new Date("2026-10-23T13:30:00Z"),
    fetchImpl: async (url) => { consultada = new URL(url); return new Response(JSON.stringify(payload()), { status: 200 }); },
  });
  assert.deepEqual(consultada.searchParams.get("hourly").split(","), VARS);
  assert.deepEqual(consultada.searchParams.get("current").split(","), VARS);
  assert.equal(Number(consultada.searchParams.get("latitude")), cidade.latitude);
  assert.equal(Number(consultada.searchParams.get("longitude")), cidade.longitude);
  assert.equal(consultada.hostname, "customer-air-quality-api.open-meteo.com");
  assert.equal(dados.modoLicenca, "comercial");
  assert.equal(dados.url.includes("teste"), false);
});

test("respeita o fuso da base ao ler a qualidade do ar", async () => {
  const cidade = CIDADES.manaus;
  const agora = new Date("2026-10-23T13:30:00Z"); // 09h30 em Manaus.
  const json = { ...payload(42), timezone: "America/Manaus", utc_offset_seconds: -14400,
    current_units: { us_aqi: "USAQI", pm2_5: "µg/m³", pm10: "µg/m³" },
    current: { time: "2026-10-23T09:00", us_aqi: 42, pm2_5: 9, pm10: 15 } };
  const dados = await buscarQualidadeAr(cidade, { env: {}, now: agora,
    fetchImpl: async () => new Response(JSON.stringify(json), { status: 200 }) });
  assert.equal(dados.iqar, 42);
  assert.equal(dados.referenciaEm, "2026-10-23T09:00");
  json.current.time = "2026-10-22T09:00";
  json.hourly = { time: ["2026-10-23T08:00", "2026-10-23T09:00"],
    us_aqi: [40, 43], pm2_5: [8, 9], pm10: [14, 15] };
  const reserva = calcularIQAr(json, { now: agora, fuso: "America/Manaus" });
  assert.equal(reserva.iqar, 43);
  assert.equal(reserva.referenciaEm, "2026-10-23T09:00");
});
