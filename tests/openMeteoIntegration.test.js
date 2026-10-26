const test = require("node:test");
const assert = require("node:assert/strict");
const { buscarOpenMeteo, classificarIndiceUv, acumularPrecipitacaoDecorrida, validarResposta } = require("../src/sources/openMeteo");
const { buscarMar, buscarMarComFallback } = require("../src/sources/marine");
const { CIDADES } = require("../src/config/cities");

const resposta = (objeto) => new Response(JSON.stringify(objeto), {
  status: 200, headers: { "content-type": "application/json" },
});

test("Open-Meteo entrega UV, chuva, vento médio e série de rajada separada", async () => {
  let urlConsultada;
  const fetchImpl = async (url) => {
    urlConsultada = new URL(url);
    return resposta({
      latitude: -22.9, longitude: -43.1,
      timezone: "America/Sao_Paulo",
      current: { time: "2026-10-23T10:00", temperature_2m: 26, weather_code: 1, is_day: 1 },
      hourly_units: { temperature_2m: "°C", relative_humidity_2m: "%", precipitation_probability: "%", precipitation: "mm", wind_speed_10m: "km/h", wind_gusts_10m: "km/h", wind_direction_10m: "°", uv_index: "" },
      hourly: {
        time: ["2026-10-23T05:00", "2026-10-23T06:00", "2026-10-23T12:00", "2026-10-23T18:00"],
        temperature_2m: [20, 21, 27, 24], relative_humidity_2m: [90, 88, 55, 70],
        precipitation_probability: [10, 20, 75, 30], precipitation: [0, 0.1, 2, 0.2],
        wind_speed_10m: [8, 10, 18, 12], wind_gusts_10m: [14, 18, 34, 20], wind_direction_10m: [90, 90, 180, 270],
        weather_code: [1, 2, 61, 2], uv_index: [0, 1, 8.4, 0],
      },
      daily: {
        time: ["2026-10-23"], temperature_2m_max: [27], temperature_2m_min: [20],
        precipitation_sum: [2.3], precipitation_probability_max: [75],
        wind_speed_10m_max: [18], wind_gusts_10m_max: [34], weather_code: [61], uv_index_max: [8.4],
      },
    });
  };
  const dados = await buscarOpenMeteo(-22.9, -43.1, { fetchImpl, env: { OPEN_METEO_API_KEY: "fake-test-key" }, tentativas: 1, logger: null });
  assert.equal(urlConsultada.origin, "https://api.open-meteo.com");
  assert.equal(urlConsultada.searchParams.get("models"), "best_match");
  assert.equal(urlConsultada.searchParams.get("wind_speed_unit"), "kmh");
  assert.equal(urlConsultada.searchParams.get("precipitation_unit"), "mm");
  assert.equal(urlConsultada.searchParams.get("past_days"), "1");
  assert.match(urlConsultada.searchParams.get("hourly"), /uv_index/);
  assert.match(urlConsultada.searchParams.get("hourly"), /wind_gusts_10m/);
  assert.equal(dados.uvMax, 8.4);
  assert.equal(dados.uvClassificacao.nivel, "Muito alto");
  assert.equal(dados.probabilidadeChuvaMax, null, "horas faltantes não permitem máximo da janela operacional");
  assert.equal(dados.rajadaMaxKmh, null);
  assert.equal(dados.periodos.tarde.rajadaMaxKmh, null);
  assert.deepEqual(classificarIndiceUv(11), { nivel: "Extremo", faixa: "11+" });
});

test("Open-Meteo busca no GFS uma série diária ausente e preserva o dado preenchido", async () => {
  const respostaIncompleta = {
    latitude: -22.9, longitude: -43.1,
    timezone: "America/Sao_Paulo",
    hourly: {
      time: ["2026-10-23T05:00"], temperature_2m: [0], relative_humidity_2m: [0],
      precipitation_probability: [0], precipitation: [0], wind_speed_10m: [0],
      wind_direction_10m: [0], wind_gusts_10m: [0], weather_code: [0], uv_index: [0],
    },
    daily: {
      time: ["2026-10-23"], temperature_2m_max: [0], temperature_2m_min: [0],
      precipitation_sum: [0], precipitation_probability_max: [], wind_speed_10m_max: [0],
      wind_gusts_10m_max: [0], weather_code: [0], uv_index_max: [0],
    },
  };
  const urls = [];
  const fetchImpl = async (url) => {
    const consultada = new URL(url);
    urls.push(consultada);
    if (consultada.searchParams.get("models") === "ncep_gfs_seamless") {
      return resposta({
        latitude: -22.9, longitude: -43.1, timezone: "America/Sao_Paulo",
        daily: { time: ["2026-10-23"], precipitation_probability_max: [70] },
      });
    }
    return resposta(respostaIncompleta);
  };
  const dados = await buscarOpenMeteo(-22.9, -43.1, {
    fetchImpl, tentativas: 1, logger: null, now: new Date("2026-10-23T10:00:00Z"),
  });
  assert.equal(urls.length, 2);
  assert.equal(urls[0].searchParams.get("models"), "best_match");
  assert.equal(urls[1].searchParams.get("models"), "ncep_gfs_seamless");
  assert.equal(dados.probabilidadeChuvaDiariaPct, 70);
  assert.equal(dados.modelosIndicadores.precipitation_probability_max, "ncep_gfs_seamless");
  assert.equal(dados.diagnosticosIndicadores.find((item) =>
    item.indicador === "Probabilidade máxima diária de chuva" && item.status === "fallback_utilizado")?.statusHttp, 200);
});

test("Open-Meteo rejeita grade meteorológica de outra localidade", () => {
  const hourly = { time: ["2026-10-25T12:00"] };
  for (const campo of ["temperature_2m", "relative_humidity_2m", "precipitation_probability", "precipitation",
    "wind_speed_10m", "wind_direction_10m", "wind_gusts_10m", "weather_code", "uv_index"]) hourly[campo] = [0];
  const daily = { time: ["2026-10-25"] };
  for (const campo of ["temperature_2m_max", "temperature_2m_min", "precipitation_sum",
    "precipitation_probability_max", "wind_speed_10m_max", "wind_gusts_10m_max", "weather_code", "uv_index_max"]) daily[campo] = [0];
  const payload = { timezone: "America/Sao_Paulo", latitude: 0, longitude: 0, hourly, daily };
  assert.throws(() => validarResposta(payload, "America/Sao_Paulo", { latitude: -23, longitude: -46 }),
    (erro) => erro.code === "OPEN_METEO_LOCATION_MISMATCH");
  assert.throws(() => validarResposta({ ...payload, latitude: null }, "America/Sao_Paulo", { latitude: -23, longitude: -46 }),
    (erro) => erro.code === "OPEN_METEO_LOCATION_INVALID");
});

test("Open-Meteo preserva zero quando todas as séries solicitadas estão alinhadas", async () => {
  const hora = "2026-10-23T05:00";
  const fetchImpl = async () => resposta({
    latitude: -22.9, longitude: -43.1,
    timezone: "America/Sao_Paulo",
    current: { time: "2026-10-23T05:00", temperature_2m: 0, weather_code: 0, is_day: 1 },
    hourly: {
      time: [hora], temperature_2m: [0], relative_humidity_2m: [0],
      precipitation_probability: [0], precipitation: [0], wind_speed_10m: [0],
      wind_direction_10m: [0], wind_gusts_10m: [0], weather_code: [0], uv_index: [0],
    },
    daily: {
      time: ["2026-10-23"], temperature_2m_max: [0], temperature_2m_min: [0],
      precipitation_sum: [0], precipitation_probability_max: [0], wind_speed_10m_max: [0],
      wind_gusts_10m_max: [0], weather_code: [0], uv_index_max: [0],
    },
  });
  const dados = await buscarOpenMeteo(-22.9, -43.1, { fetchImpl, env: { OPEN_METEO_API_KEY: "fake-test-key" }, tentativas: 1, logger: null });
  assert.equal(dados.tempMin, 0);
  assert.equal(dados.tempMax, 0);
  assert.equal(dados.probabilidadeChuvaMax, null);
  assert.equal(dados.precipitacaoTotalMm, null);
  assert.equal(dados.chuvaHoraria[0].precipitacaoMm, null, "sem rótulo de fim 06h não há total do intervalo 05h–06h");
  assert.equal(dados.velocidadeMaxKmh, null);
  assert.equal(dados.uvMax, 0);
});

test("Open-Meteo reutiliza somente cache recente após falha dos modelos", async () => {
  const latitude = -8.05;
  const longitude = -34.9;
  const time = Array.from({ length: 25 }, (_, i) =>
    new Date(Date.UTC(2026, 9, 23, i)).toISOString().slice(0, 16));
  const serie = (valor) => time.map(() => valor);
  const payload = {
    latitude, longitude, timezone: "America/Sao_Paulo",
    current: { time: "2026-10-23T10:00", temperature_2m: 25, relative_humidity_2m: 70, weather_code: 2, is_day: 1 },
    hourly: {
      time, temperature_2m: serie(25), relative_humidity_2m: serie(70),
      precipitation_probability: serie(0), precipitation: serie(0), wind_speed_10m: serie(5),
      wind_direction_10m: serie(90), wind_gusts_10m: serie(8), weather_code: serie(2), uv_index: serie(1),
    },
    daily: {
      time: ["2026-10-23"], temperature_2m_max: [26], temperature_2m_min: [20],
      precipitation_sum: [0], precipitation_probability_max: [0], wind_speed_10m_max: [5],
      wind_gusts_10m_max: [8], weather_code: [2], uv_index_max: [1],
    },
  };
  const comum = {
    latitude, longitude, fuso: "America/Sao_Paulo",
    now: new Date("2026-10-23T13:00:00Z"), esperarFn: async () => {}, logger: null,
  };
  const primeira = await buscarOpenMeteo(latitude, longitude, {
    ...comum, fetchImpl: async () => resposta(payload),
  });
  const segunda = await buscarOpenMeteo(latitude, longitude, {
    ...comum,
    fetchImpl: async () => new Response("temporariamente indisponível", {
      status: 503, headers: { "retry-after": "0" },
    }),
  });
  assert.equal(primeira.cache, null);
  assert.equal(segunda.cache.utilizado, true);
  assert.ok(segunda.cache.idadeMs >= 0 && segunda.cache.idadeMs < 60000);
  assert.ok(segunda.diagnosticosIndicadores.some((item) => item.status === "cache"));
  assert.equal(segunda.rajadaMaxKmh, primeira.rajadaMaxKmh);
});

test("rajada modelada usa pico nas janelas locais e a hora final do dia seguinte", async () => {
  const time = Array.from({ length: 25 }, (_, i) => new Date(Date.UTC(2026, 9, 25, i)).toISOString().slice(0, 16));
  const serie = (valor) => time.map(() => valor);
  const gusts = serie(10);
  gusts[9] = 44;
  gusts[15] = 70;
  gusts[24] = 55;
  const fetchImpl = async () => resposta({
    latitude: -23.96, longitude: -46.32, timezone: "America/Sao_Paulo", utc_offset_seconds: -10800,
    current: { time: "2026-10-25T21:00", temperature_2m: 25, relative_humidity_2m: 60, weather_code: 2, is_day: 0 },
    hourly_units: { wind_gusts_10m: "km/h" }, daily_units: { wind_gusts_10m_max: "km/h" },
    hourly: { time, temperature_2m: serie(25), relative_humidity_2m: serie(60),
      precipitation_probability: serie(0), precipitation: serie(0), wind_speed_10m: serie(5),
      wind_direction_10m: serie(90), wind_gusts_10m: gusts, weather_code: serie(2), uv_index: serie(0) },
    daily: { time: ["2026-10-25"], temperature_2m_max: [27], temperature_2m_min: [20],
      precipitation_sum: [0], precipitation_probability_max: [0], wind_speed_10m_max: [5],
      wind_gusts_10m_max: [70], weather_code: [2], uv_index_max: [0] },
  });
  const dados = await buscarOpenMeteo(-23.9609448, -46.3166316, {
    fetchImpl, env: { OPEN_METEO_API_KEY: "fake-test-key" }, fuso: "America/Sao_Paulo",
    now: new Date("2026-10-26T00:30:00Z"), logger: null,
  });
  assert.deepEqual([dados.periodosDiaCompleto.manha.rajadaMaxKmh, dados.periodosDiaCompleto.tarde.rajadaMaxKmh,
    dados.periodosDiaCompleto.noite.rajadaMaxKmh], [44, 70, 55]);
  assert.deepEqual([dados.periodos.manha.rajadaMaxKmh, dados.periodos.tarde.rajadaMaxKmh,
    dados.periodos.noite.rajadaMaxKmh], [null, null, 55]);
  assert.equal(dados.rajadaMaxKmh, 55);
  assert.equal(dados.rajadaPrevistaEm, "2026-10-26T03:00:00.000Z");
  assert.equal(dados.rajadaRestanteMaxKmh, 55);
  assert.equal(dados.rajadaRestantePrevistaEm, "2026-10-26T03:00:00.000Z");
  assert.equal(dados.rajadaRestantePeriodo, "22h–00h");
  assert.equal(dados.atual.horario, "2026-10-26T00:00:00.000Z");
  assert.equal(dados.atual.umidadePct, 60);
});

test("chuva acumulada estimada soma apenas intervalos completos do dia local e preserva zero", () => {
  const hourly = {
    time: ["2026-10-25T00:00", "2026-10-25T01:00", "2026-10-25T02:00", "2026-10-25T03:00", "2026-10-25T04:00"],
    precipitation: [99, 0, 0.5, 2, 50],
  };
  const resultado = acumularPrecipitacaoDecorrida(hourly, {
    agoraLocal: "2026-10-25T03:30", fuso: "America/Sao_Paulo",
  });
  assert.equal(resultado.valorMm, 2.5);
  assert.equal(resultado.cobertura.amostras, 3);
  assert.equal(resultado.cobertura.esperadas, 3);
  assert.equal(resultado.janela, "2026-10-25 00:00–03:00");

  const zero = acumularPrecipitacaoDecorrida({ time: hourly.time.slice(0, 3), precipitation: [12, 0, 0] }, {
    agoraLocal: "2026-10-25T02:30", fuso: "America/Sao_Paulo",
  });
  assert.equal(zero.valorMm, 0);
  assert.equal(zero.disponivel, true);
});

test("chuva acumulada estimada fica indisponível com lacunas e não transforma ausência em zero", () => {
  const resultado = acumularPrecipitacaoDecorrida({
    time: ["2026-10-25T01:00", "2026-10-25T03:00"], precipitation: [0, 0],
  }, { agoraLocal: "2026-10-25T03:30", fuso: "America/Sao_Paulo" });
  assert.equal(resultado.valorMm, null);
  assert.equal(resultado.disponivel, false);
  assert.match(resultado.motivo, /lacunas/);
});

test("Marine usa ondas, onda de vento e swell sem conversão de velocidade", async () => {
  let urlConsultada;
  const fetchImpl = async (url) => {
    urlConsultada = new URL(url);
    return resposta({
      timezone: "America/Sao_Paulo",
      hourly: {
        time: ["2026-10-23T05:00", "2026-10-23T12:00", "2026-10-23T18:00"],
        wave_height: [1, 1.5, 1.2], wave_period: [8, 9, 10], wave_direction: [90, 100, 110],
        wind_wave_height: [0.4, 0.6, 0.5], swell_wave_height: [0.8, 1.1, 0.9],
        swell_wave_direction: [80, 90, 100], swell_wave_period: [10, 11, 12],
        sea_surface_temperature: [24, 24, 24],
      },
    });
  };
  const mar = await buscarMar(-23.1, -43.12, { fetchImpl, env: { OPEN_METEO_API_KEY: "fake-test-key" }, logger: null });
  const variaveis = urlConsultada.searchParams.get("hourly");
  assert.match(variaveis, /wind_wave_height/);
  assert.match(variaveis, /swell_wave_direction/);
  assert.equal(mar.alturaMaxDiaM, 1.5);
  assert.equal(mar.periodos[1].ondaVentoMaxM, 0.6);
  assert.equal(mar.periodos[1].marulhoMaxM, 1.1);
});

test("Marine não publica cache público ou antigo quando a consulta comercial falha", async () => {
  const cidade = CIDADES.santos;
  const agora = () => new Date("2026-10-26T12:00:00Z");
  let chamadas = 0;
  const consultar = async () => { chamadas += 1; throw new Error("sem resposta"); };
  const cache = (url, consultadoEm) => ({
    [cidade.chave]: { consultadoEm, dados: { url, alturaMaxDiaM: 1 } },
  });
  const comum = { consultar, agora, carregarCache: () => cache(
    "https://marine-api.open-meteo.com/v1/marine", "2026-10-26T11:45:00Z") };
  const semLicenca = await buscarMarComFallback(cidade, { ...comum, env: {} });
  assert.equal(semLicenca.dados, null);
  assert.equal(semLicenca.erro.code, "OPEN_METEO_COMMERCIAL_LICENSE_REQUIRED");
  assert.equal(chamadas, 0);
  const publico = await buscarMarComFallback(cidade, { ...comum, env: { OPEN_METEO_API_KEY: "fake-test-key" } });
  assert.equal(publico.dados, null);
  const antigo = await buscarMarComFallback(cidade, { ...comum,
    carregarCache: () => cache("https://customer-marine-api.open-meteo.com/v1/marine", "2026-10-26T10:00:00Z"),
    env: { OPEN_METEO_API_KEY: "fake-test-key" } });
  assert.equal(antigo.dados, null);
  const recente = await buscarMarComFallback(cidade, { ...comum,
    carregarCache: () => cache("https://customer-marine-api.open-meteo.com/v1/marine", "2026-10-26T11:45:00Z"),
    env: { OPEN_METEO_API_KEY: "fake-test-key" } });
  assert.equal(recente.dados.alturaMaxDiaM, 1);
  assert.equal(recente.dados.desatualizado, true);
});
