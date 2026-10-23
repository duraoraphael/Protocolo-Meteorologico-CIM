const test = require("node:test");
const assert = require("node:assert/strict");
const { calcularSubindice, calcularIQAr, classificarIQAr, buscarQualidadeAr, VARS } = require("../src/sources/airQuality");
const { CIDADES } = require("../src/config/cities");

const unit = "µg/m³";
function payload({ start = "2026-10-21T12", count = 49, missing = null } = {}) {
  const times = Array.from({ length: count }, (_, i) => new Date(Date.parse(`${start}:00Z`) + i * 3600000).toISOString().slice(0, 16));
  const hourly = { time: times };
  for (const variable of VARS) hourly[variable] = times.map((_, i) => missing === `${variable}:${i}` ? null : variable === "pm2_5" ? 10 : variable === "pm10" ? 30 : variable === "ozone" ? 50 : variable === "nitrogen_dioxide" ? 40 : variable === "sulphur_dioxide" ? 12 : 500);
  return { latitude: -22.9, longitude: -43.2, utc_offset_seconds: 0, hourly, hourly_units: Object.fromEntries(VARS.map((v) => [v, unit])) };
}

test("IQAr brasileiro interpola e arredonda a subfaixa", () => {
  assert.equal(calcularSubindice(0, [[15, 40], [50, 80]]), 0);
  assert.equal(calcularSubindice(15, [[15, 40], [50, 80]]), 40);
  assert.equal(calcularSubindice(32.5, [[15, 40], [50, 80]]), 60);
  assert.equal(calcularSubindice(400, [[15, 40], [50, 80]]), null);
});

test("todas as classes brasileiras e suas cores estão disponíveis", () => {
  const cases = [[0,"Boa"],[40,"Boa"],[41,"Moderada"],[80,"Moderada"],[81,"Ruim"],[120,"Ruim"],[121,"Muito Ruim"],[200,"Muito Ruim"],[201,"Péssima"],[400,"Péssima"]];
  for (const [value, name] of cases) assert.equal(classificarIQAr(value).nivel, name);
  assert.equal(classificarIQAr(401), null);
  assert.equal(new Set(cases.map(([value]) => classificarIQAr(value).cor)).size, 5);
});

test("calcula o maior subíndice somente com médias móveis completas e unidades compatíveis", () => {
  const result = calcularIQAr(payload(), { now: new Date("2026-10-23T12:30:00Z") });
  assert.equal(result.iqar, 27);
  assert.equal(result.classificacao.nivel, "Boa");
  assert.equal(result.subindiceResponsavel, "MP10");
  assert.ok(result.subindices.some((s) => s.periodoHoras === 24));
  assert.ok(result.subindices.some((s) => s.periodoHoras === 8));
  assert.ok(!result.subindices.some((s) => s.poluente === "CO")); // CAMS entrega CO em µg/m³, IQAr exige ppm.
});

test("não calcula 24h usando uma série horária incompleta", () => {
  const data = payload({ missing: "pm2_5:25" });
  const result = calcularIQAr(data, { now: new Date("2026-10-23T12:30:00Z") });
  assert.ok(!result.subindices.some((s) => s.poluente === "MP2,5"));
});

test("bloqueia consulta comercial sem chave autorizada e nunca troca por US/EU AQI", async () => {
  const cidade = { latitude: -22.9, longitude: -43.2 };
  await assert.rejects(buscarQualidadeAr(cidade, { env: {} }), { code: "OPEN_METEO_COMMERCIAL_LICENSE_REQUIRED" });
  const raw = payload();
  raw.hourly.european_aqi = Array(raw.hourly.time.length).fill(4);
  raw.hourly.us_aqi = Array(raw.hourly.time.length).fill(10);
  const result = calcularIQAr(raw, { now: new Date("2026-10-23T12:30:00Z") });
  assert.equal(result.iqar, 27);
});

test("as bases cadastradas permanecem sem números simulados quando falta a licença", async () => {
  const bases = Object.values(CIDADES);
  assert.ok(bases.length > 0);
  for (const cidade of bases) {
    await assert.rejects(buscarQualidadeAr(cidade, { env: {} }), {
      code: "OPEN_METEO_COMMERCIAL_LICENSE_REQUIRED",
    }, cidade.nome);
  }
});
