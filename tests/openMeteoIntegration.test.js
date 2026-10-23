const test = require("node:test");
const assert = require("node:assert/strict");
const { buscarOpenMeteo, classificarIndiceUv } = require("../src/sources/openMeteo");
const { buscarMar } = require("../src/sources/marine");

const resposta = (objeto) => new Response(JSON.stringify(objeto), {
  status: 200, headers: { "content-type": "application/json" },
});

test("Open-Meteo entrega UV, chuva e vento médio sem solicitar rajada", async () => {
  let urlConsultada;
  const fetchImpl = async (url) => {
    urlConsultada = new URL(url);
    return resposta({
      timezone: "America/Sao_Paulo",
      current: { time: "2026-10-23T10:00", temperature_2m: 26, weather_code: 1, is_day: 1 },
      hourly_units: { temperature_2m: "°C", relative_humidity_2m: "%", precipitation_probability: "%", precipitation: "mm", wind_speed_10m: "km/h", wind_direction_10m: "°", uv_index: "" },
      hourly: {
        time: ["2026-10-23T05:00", "2026-10-23T06:00", "2026-10-23T12:00", "2026-10-23T18:00"],
        temperature_2m: [20, 21, 27, 24], relative_humidity_2m: [90, 88, 55, 70],
        precipitation_probability: [10, 20, 75, 30], precipitation: [0, 0.1, 2, 0.2],
        wind_speed_10m: [8, 10, 18, 12], wind_direction_10m: [90, 90, 180, 270],
        weather_code: [1, 2, 61, 2], uv_index: [0, 1, 8.4, 0],
      },
      daily: {
        time: ["2026-10-23"], temperature_2m_max: [27], temperature_2m_min: [20],
        precipitation_sum: [2.3], precipitation_probability_max: [75],
        wind_speed_10m_max: [18], weather_code: [61], uv_index_max: [8.4],
      },
    });
  };
  const dados = await buscarOpenMeteo(-22.9, -43.1, { fetchImpl, tentativas: 1, logger: null });
  assert.equal(urlConsultada.searchParams.get("wind_speed_unit"), "kmh");
  assert.match(urlConsultada.searchParams.get("hourly"), /uv_index/);
  assert.doesNotMatch(urlConsultada.searchParams.get("hourly"), /gust/);
  assert.equal(dados.uvMax, 8.4);
  assert.equal(dados.uvClassificacao.nivel, "Muito alto");
  assert.equal(dados.probabilidadeChuvaMax, 75);
  assert.equal(dados.rajadaMaxKmh, null);
  assert.equal(dados.periodos.tarde.rajadaMaxKmh, null);
  assert.deepEqual(classificarIndiceUv(11), { nivel: "Extremo", faixa: "11+" });
});

test("Open-Meteo rejeita resposta 200 com série solicitada ausente ou desalinhada", async () => {
  const respostaIncompleta = {
    timezone: "America/Sao_Paulo",
    hourly: {
      time: ["2026-10-23T05:00"], temperature_2m: [0], relative_humidity_2m: [0],
      precipitation_probability: [0], precipitation: [0], wind_speed_10m: [0],
      wind_direction_10m: [0], weather_code: [0], uv_index: [0],
    },
    daily: {
      time: ["2026-10-23"], temperature_2m_max: [0], temperature_2m_min: [0],
      precipitation_sum: [0], precipitation_probability_max: [], wind_speed_10m_max: [0],
      weather_code: [0], uv_index_max: [0],
    },
  };
  await assert.rejects(
    buscarOpenMeteo(-22.9, -43.1, {
      fetchImpl: async () => resposta(respostaIncompleta), tentativas: 1, logger: null,
    }),
    (erro) => erro.name === "ParserError" && erro.code === "OPEN_METEO_INVALID_SERIES"
      && /daily\.precipitation_probability_max/.test(erro.message),
  );
});

test("Open-Meteo preserva zero quando todas as séries solicitadas estão alinhadas", async () => {
  const hora = "2026-10-23T05:00";
  const fetchImpl = async () => resposta({
    timezone: "America/Sao_Paulo",
    hourly: {
      time: [hora], temperature_2m: [0], relative_humidity_2m: [0],
      precipitation_probability: [0], precipitation: [0], wind_speed_10m: [0],
      wind_direction_10m: [0], weather_code: [0], uv_index: [0],
    },
    daily: {
      time: ["2026-10-23"], temperature_2m_max: [0], temperature_2m_min: [0],
      precipitation_sum: [0], precipitation_probability_max: [0], wind_speed_10m_max: [0],
      weather_code: [0], uv_index_max: [0],
    },
  });
  const dados = await buscarOpenMeteo(-22.9, -43.1, { fetchImpl, tentativas: 1, logger: null });
  assert.equal(dados.tempMin, 0);
  assert.equal(dados.tempMax, 0);
  assert.equal(dados.probabilidadeChuvaMax, 0);
  assert.equal(dados.precipitacaoTotalMm, 0);
  assert.equal(dados.velocidadeMaxKmh, 0);
  assert.equal(dados.uvMax, 0);
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
  const mar = await buscarMar(-23.1, -43.12, { fetchImpl, logger: null });
  const variaveis = urlConsultada.searchParams.get("hourly");
  assert.match(variaveis, /wind_wave_height/);
  assert.match(variaveis, /swell_wave_direction/);
  assert.equal(mar.alturaMaxDiaM, 1.5);
  assert.equal(mar.periodos[1].ondaVentoMaxM, 0.6);
  assert.equal(mar.periodos[1].marulhoMaxM, 1.1);
});
