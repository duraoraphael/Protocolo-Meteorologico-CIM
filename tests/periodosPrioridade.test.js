const test = require("node:test");
const assert = require("node:assert/strict");
const { buscarPrevisaoInmet } = require("../src/sources/inmet");
const { aplicarPoliticaFontes, FONTE_INMET_PREVISAO, FONTE_OPEN_METEO, INDISPONIVEL } = require("../src/logic/weatherSourcePolicy");
const { resumirPeriodo } = require("../src/sources/openMeteo");
const { montarVentoPorPeriodo } = require("../src/logic/reportBuilder");
const { chuvaPrevistaAcumulada, probabilidadeChuvaPrevista } = require("../src/render/emailTemplate");

test("INMET interpreta velocidade com unidade, converte m/s e preserva zero de chuva", async () => {
  const payload = { "3304557": { "25/10/2026": {
    manha: { entidade: "Rio de Janeiro", uf: "RJ", resumo: "Chuva fraca", vento_velocidade_media: "5 m/s", rajada_max: "0 km/h", precipitacao_mm: "0 mm", probabilidade_chuva: "0%" },
    tarde: { vento_velocidade_media: 5, rajada_max: "55 mm", precipitacao_mm: "Pancadas de chuva", probabilidade_chuva: "110%" },
    noite: { vento_velocidade_media: "12 km/h", rajada_max: "40 km/h", precipitacao_mm: "2,5 mm", probabilidade_chuva: "40%" },
  } } };
  const dados = await buscarPrevisaoInmet("3304557", {
    agora: new Date("2026-10-25T15:00:00Z"), logger: null,
    fetchImpl: async () => new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } }),
  });
  assert.equal(dados.periodos.manha.velocidadeMediaKmh, 18);
  assert.equal(dados.periodos.manha.precipitacaoMm, 0);
  assert.equal(dados.periodos.manha.probabilidadeChuva, 0);
  assert.equal(dados.periodos.manha.rajadaMaxKmh, 0);
  assert.equal(dados.periodos.tarde.velocidadeMediaKmh, null);
  assert.equal(dados.periodos.tarde.precipitacaoMm, null);
  assert.equal(dados.periodos.tarde.probabilidadeChuva, null);
  assert.equal(dados.periodos.tarde.rajadaMaxKmh, null);
  assert.equal(dados.periodos.noite.precipitacaoMm, 2.5);
  assert.equal(dados.dias[0].rajadaMaxKmh, 40);
  await assert.rejects(buscarPrevisaoInmet("3304557", {
    agora: new Date("2026-10-25T15:00:00Z"), municipio: "Santos", uf: "SP", logger: null,
    fetchImpl: async () => new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } }),
  }), (erro) => erro.code === "INMET_LOCATION_MISMATCH");
});

test("política usa Open-Meteo exclusivamente para rajada e chuva prevista por período", () => {
  const base = { atual: {}, periodos: { manha: {}, tarde: {}, noite: {} } };
  const fontes = {};
  const modelo = (vento, chuva, prob) => ({ velocidadeMediaKmh: vento, velocidadeMaxKmh: vento,
    precipitacaoMm: chuva, probabilidadeChuva: prob, rajadaMaxKmh: vento + 10,
    direcao: "S", janela: "05h–12h" });
  aplicarPoliticaFontes({ base, fontesPorCampo: fontes, logger: null,
    inmetPrevisao: { periodos: {
      manha: { velocidadeMediaKmh: 0, rajadaMaxKmh: 0, precipitacaoMm: 0, probabilidadeChuva: null },
      tarde: { velocidadeMediaKmh: null, precipitacaoMm: null, probabilidadeChuva: null },
      noite: { velocidadeMediaKmh: 12, rajadaMaxKmh: 40, precipitacaoMm: null, probabilidadeChuva: 40 },
    } },
    openMeteo: { rajadaMaxKmh: 45, precipitacaoPrevistaDiaMm: 6,
      periodosDiaCompleto: { manha: modelo(7, 1, 20), tarde: modelo(8, 2, 30), noite: modelo(9, 3, 50) } },
  });
  assert.equal(base.periodos.manha.velocidadeMediaKmh, 0);
  assert.equal(base.periodos.manha.precipitacaoMm, 1);
  assert.equal(base.periodos.manha.probabilidadeChuva, 20);
  assert.equal(base.periodos.tarde.velocidadeMediaKmh, 8);
  assert.equal(base.periodos.noite.velocidadeMediaKmh, 12);
  assert.equal(base.periodos.noite.precipitacaoMm, 3);
  assert.equal(base.precipitacaoTotalMm, 6);
  assert.equal(base.periodos.manha.rajadaMaxKmh, 17);
  assert.equal(base.rajadaMaxKmh, 45);
  assert.equal(fontes["periodos.manha.velocidadeMediaKmh"], FONTE_INMET_PREVISAO);
  assert.equal(fontes["periodos.manha.precipitacaoMm"], FONTE_OPEN_METEO);
  assert.equal(fontes["periodos.manha.probabilidadeChuva"], FONTE_OPEN_METEO);
  assert.equal(fontes["periodos.tarde.velocidadeMediaKmh"], FONTE_OPEN_METEO);
  assert.equal(fontes["periodos.manha.rajadaMaxKmh"], FONTE_OPEN_METEO);
});

test("série horária incompleta mantém chuva e vento do período indisponíveis", () => {
  const serie = { time: Array.from({ length: 6 }, (_, i) => `2026-10-25T${String(i + 5).padStart(2, "0")}:00`),
    wind_speed_10m: Array(6).fill(0), wind_direction_10m: Array(6).fill(90),
    precipitation: Array(6).fill(0), precipitation_probability: Array(6).fill(0),
    wind_gusts_10m: Array(6).fill(0), weather_code: Array(6).fill(0) };
  const periodo = resumirPeriodo(serie, "manha", { dataReferencia: "2026-10-25" });
  assert.deepEqual(periodo.cobertura, { amostras: 6, esperadas: 7, completa: false });
  assert.equal(periodo.velocidadeMediaKmh, null);
  assert.equal(periodo.precipitacaoMm, null);
  assert.equal(periodo.probabilidadeChuva, null);
  serie.time.push("2026-10-25T10:00");
  for (const campo of ["wind_speed_10m", "wind_direction_10m", "precipitation", "precipitation_probability", "wind_gusts_10m", "weather_code"]) serie[campo].push(0);
  assert.equal(resumirPeriodo(serie, "manha", { dataReferencia: "2026-10-25" }).precipitacaoMm, null, "hora duplicada não completa a janela");
});

test("chuva 05h–12h soma intervalos terminados de 06h a 12h", () => {
  const time = Array.from({ length: 9 }, (_, i) => `2026-10-25T${String(i + 5).padStart(2, "0")}:00`);
  const serie = { time, wind_speed_10m: Array(9).fill(10), wind_direction_10m: Array(9).fill(90),
    precipitation: [99, 1, 1, 1, 1, 1, 1, 1, 99],
    precipitation_probability: [99, 10, 10, 10, 10, 10, 10, 60, 99],
    wind_gusts_10m: Array(9).fill(20), weather_code: Array(9).fill(0) };
  const periodo = resumirPeriodo(serie, "manha", { dataReferencia: "2026-10-25" });
  assert.equal(periodo.precipitacaoMm, 7);
  assert.equal(periodo.probabilidadeChuva, 60);
  assert.equal(periodo.velocidadeMediaKmh, 10);
  assert.equal(periodo.coberturaChuva.completa, true);
});

test("janela modelada restante exclui chuva e vento de horas já decorridas", () => {
  const time = Array.from({ length: 8 }, (_, i) => `2026-10-25T${String(i + 5).padStart(2, "0")}:00`);
  const serie = { time,
    wind_speed_10m: [90, 90, 90, 10, 10, 10, 10, 10],
    wind_direction_10m: Array(8).fill(90),
    precipitation: [90, 90, 90, 90, 1, 1, 1, 1],
    precipitation_probability: [100, 100, 100, 100, 20, 20, 20, 20],
    wind_gusts_10m: Array(8).fill(20), weather_code: Array(8).fill(0) };
  const restante = resumirPeriodo(serie, "manha", { dataReferencia: "2026-10-25", inicioHora: 8 });
  assert.equal(restante.janela, "08h–12h");
  assert.equal(restante.precipitacaoMm, 4);
  assert.equal(restante.probabilidadeChuva, 20);
  assert.equal(restante.velocidadeMediaKmh, 10);
  assert.equal(resumirPeriodo(serie, "manha", { dataReferencia: "2026-10-25", inicioHora: 12 }).precipitacaoMm, null);
});

test("tabela mantém os três períodos mesmo quando o modelo não cobre um deles", () => {
  const linhas = montarVentoPorPeriodo({ base: { periodos: {
    manha: { periodo: "Manhã", disponivel: false, velocidadeMediaKmh: 12, fonteVento: "INMET — previsão oficial" },
    tarde: { periodo: "Tarde", disponivel: false },
    noite: { periodo: "Noite", disponivel: false },
  } } });
  assert.equal(linhas.length, 3);
  assert.equal(linhas[0].velocidadeMediaKmh, 12);
  assert.equal(linhas[1].velocidadeMediaKmh, null);
});

test("resumo de chuva diária usa o agregado Open-Meteo separado da janela horária", () => {
  const report = {
    previsaoDias: [{ chuvaMm: 99 }],
    precipitacaoPrevistaDiaMm: 99,
    chuvaPorPeriodo: [
      { periodo: "Manhã", janela: "05h–12h", precipitacaoMm: 0, probabilidade: 0 },
      { periodo: "Tarde", janela: "12h–18h", precipitacaoMm: 2, probabilidade: 30 },
      { periodo: "Noite", janela: "18h–00h", precipitacaoMm: 3, probabilidade: 70 },
    ],
  };
  assert.equal(chuvaPrevistaAcumulada(report), 99);
  assert.equal(probabilidadeChuvaPrevista(report), 70);
  report.chuvaPorPeriodo[1].precipitacaoMm = null;
  report.chuvaPorPeriodo[1].probabilidade = null;
  assert.equal(chuvaPrevistaAcumulada(report), 99);
  assert.equal(probabilidadeChuvaPrevista(report), null);
});
