const test = require("node:test");
const assert = require("node:assert/strict");
const {
  classificarUsAqi,
  classificarIndiceUv,
  validarAtual,
  buscarQualidadeAr,
  CURRENT_VARIABLES,
  CACHE_TTL_MS,
} = require("../src/sources/airQuality");
const { CIDADES } = require("../src/config/cities");

const cidade = CIDADES.santos;
const agora = new Date("2026-10-25T13:10:00.000Z");
const resposta = (indice = 42, time = "2026-10-25T10:00") => ({
  latitude: cidade.latitude,
  longitude: cidade.longitude,
  timezone: "America/Sao_Paulo",
  utc_offset_seconds: -10800,
  current: { time, uv_index: 7.2, us_aqi: indice, pm2_5: 8.2, pm10: 14.5 },
  current_units: { us_aqi: "USAQI", pm2_5: "μg/m³", pm10: "μg/m³" },
});

test("classifica as três faixas US AQI simplificadas e rejeita índice inválido", () => {
  assert.equal(classificarUsAqi(0).nivel, "NORMAL");
  assert.equal(classificarUsAqi(50).nivel, "NORMAL");
  assert.equal(classificarUsAqi(51).nivel, "MODERADO");
  assert.equal(classificarUsAqi(100).nivel, "MODERADO");
  assert.equal(classificarUsAqi(101).nivel, "RUIM");
  assert.equal(classificarUsAqi(500).nivel, "RUIM");
  assert.equal(classificarUsAqi(-1), null);
  assert.equal(classificarUsAqi(501), null);
  assert.equal(classificarUsAqi(null), null);
  assert.deepEqual([0, 2.9, 3, 5.9, 6, 7.9, 8, 10.9, 11].map(v => classificarIndiceUv(v).nivel),
    ["BAIXO", "BAIXO", "MODERADO", "MODERADO", "ALTO", "ALTO", "MUITO ALTO", "MUITO ALTO", "EXTREMO"]);
  assert.equal(classificarIndiceUv(null), null);
});

test("valida AQI atual, horário local com UTC offset, coordenadas e partículas", () => {
  const dados = validarAtual(resposta(50), { now: agora, cidade });
  assert.equal(dados.usAqi, 50);
  assert.equal(dados.classificacao.nivel, "NORMAL");
  assert.equal(dados.uvAtual, 7.2);
  assert.equal(dados.uvClassificacao.nivel, "ALTO");
  assert.equal(dados.referenciaEm, "2026-10-25T13:00:00.000Z");
  assert.equal(dados.pm25Medio, 8.2);
  assert.equal(dados.pm10Medio, 14.5);
  assert.equal(dados.fonteTipo, "estimativa_modelada");
  assert.deepEqual(CURRENT_VARIABLES, ["uv_index", "us_aqi", "pm2_5", "pm10"]);
});

test("não normaliza AQI ausente, fora da faixa ou desatualizado", () => {
  for (const indice of [null, "", -1, 501]) {
    const dados = validarAtual(resposta(indice), { now: agora, cidade });
    assert.equal(dados.usAqi, null);
    assert.equal(dados.uvAtual, 7.2);
  }
  assert.throws(() => validarAtual(resposta(40, "2026-10-25T04:00"), { now: agora, cidade }), {
    code: "OPEN_METEO_AQI_STALE",
  });
  assert.throws(() => validarAtual({ ...resposta(20), current: { us_aqi: 20 } }, { now: agora, cidade }), {
    code: "OPEN_METEO_AQI_INVALID",
  });
  assert.throws(() => validarAtual({ ...resposta(20), latitude: 0, longitude: 0 }, { now: agora, cidade }), {
    code: "OPEN_METEO_AQI_LOCATION_MISMATCH",
  });
  assert.throws(() => validarAtual({ ...resposta(20), timezone: "America/Manaus" }, { now: agora, cidade }), {
    code: "OPEN_METEO_AQI_TIMEZONE_MISMATCH",
  });
  assert.throws(() => validarAtual({ ...resposta(20), utc_offset_seconds: null }, { now: agora, cidade }), {
    code: "OPEN_METEO_AQI_TIMEZONE_MISMATCH",
  });
});

test("UV atual inválido não aparece mesmo quando US AQI é válido", () => {
  const dados = validarAtual({ ...resposta(40), current: { ...resposta(40).current, uv_index: 35 } }, { now: agora, cidade });
  assert.equal(dados.usAqi, 40);
  assert.equal(dados.uvAtual, null);
  assert.throws(() => validarAtual({ ...resposta(40), current_units: { uv_index: "°C" } }, { now: agora, cidade }),
    { code: "OPEN_METEO_AQI_INVALID_UNIT" });
});

test("consulta current US AQI, PM2.5 e PM10, no fuso automático, e reaproveita cache fresco", async () => {
  const env = { OPEN_METEO_API_KEY: "fake-test-key" };
  const urls = [];
  const cache = new Map();
  const fetchImpl = async (input) => {
    urls.push(new URL(input));
    return new Response(JSON.stringify(resposta(101)), { status: 200, headers: { "content-type": "application/json" } });
  };
  const first = await buscarQualidadeAr(cidade, { fetchImpl, now: agora, env, cacheInstance: cache });
  assert.equal(first.classificacao.nivel, "RUIM");
  assert.equal(urls.length, 1);
  assert.equal(urls[0].searchParams.get("current"), "uv_index,us_aqi,pm2_5,pm10");
  assert.equal(urls[0].searchParams.get("timezone"), "America/Sao_Paulo");
  assert.equal(urls[0].searchParams.get("domains"), "cams_global");
  assert.equal(urls[0].searchParams.get("latitude"), String(cidade.latitude));
  assert.equal(urls[0].searchParams.get("longitude"), String(cidade.longitude));
  assert.match(urls[0].hostname, /^customer-air-quality-api\./);
  assert.equal(first.url.includes("fake-test-key"), false);
  const cached = await buscarQualidadeAr(cidade, {
    fetchImpl, now: new Date(agora.getTime() + 5 * 60 * 1000), env, cacheInstance: cache,
  });
  assert.equal(cached.cacheHit, true);
  assert.equal(urls.length, 1);
  assert.equal(CACHE_TTL_MS, 15 * 60 * 1000);
});

test("bloqueia chamada sem credencial comercial e cobre as onze localidades no contrato", async () => {
  await assert.rejects(buscarQualidadeAr(cidade, { env: {}, now: agora }), {
    code: "OPEN_METEO_COMMERCIAL_LICENSE_REQUIRED",
  });
  let chamadas = 0;
  const fetchImpl = async (input) => {
    chamadas += 1;
    const url = new URL(input);
    const base = Object.values(CIDADES).find((item) => String(item.latitude) === url.searchParams.get("latitude") && String(item.longitude) === url.searchParams.get("longitude"));
    assert.ok(base, `coordenadas cadastradas para ${url.searchParams.get("latitude")},${url.searchParams.get("longitude")}`);
    const manaus = base.fusoHorario === "America/Manaus";
    const json = { ...resposta(0, manaus ? "2026-10-25T09:00" : "2026-10-25T10:00"),
      latitude: base.latitude, longitude: base.longitude, timezone: base.fusoHorario || "America/Sao_Paulo",
      utc_offset_seconds: manaus ? -14400 : -10800 };
    return new Response(JSON.stringify(json), { status: 200, headers: { "content-type": "application/json" } });
  };
  const cache = new Map();
  for (const base of Object.values(CIDADES)) {
    const dados = await buscarQualidadeAr(base, { fetchImpl, now: agora, env: { OPEN_METEO_API_KEY: "fake-test-key" }, cacheInstance: cache });
    assert.equal(dados.classificacao.nivel, "NORMAL", base.nome);
    assert.equal(dados.usAqi, 0, base.nome);
  }
  assert.equal(chamadas, Object.keys(CIDADES).length);
});
