const test = require("node:test");
const assert = require("node:assert/strict");
const { buscarOpenMeteo } = require("../src/sources/openMeteo");
const { renderPdfHtml } = require("../src/render/pdfTemplate");
const { renderEmailHtml } = require("../src/render/emailTemplate");

function dadosOpenMeteo() {
  const time = [];
  for (let dia = 28; dia <= 31; dia++) {
    for (let hora = 0; hora < 24; hora++) time.push(`2026-09-${dia}T${String(hora).padStart(2, "0")}:00`);
  }
  const chuva = time.map((instante) => ({ 5: 7, 10: 1, 14: 4, 15: 2, 23: 3 })[Number(instante.slice(11, 13))] || 0);
  return {
    current: { temperature_2m: 25, weather_code: 2, is_day: 1, time: "2026-09-28T15:00" },
    hourly: {
      time,
      temperature_2m: time.map((instante) => Number(instante.slice(11, 13)) < 15 ? 20 : 25),
      relative_humidity_2m: time.map(() => 70),
      precipitation_probability: time.map(() => 40),
      precipitation: chuva,
      wind_speed_10m: time.map(() => 20),
      wind_gusts_10m: time.map((instante) => Number(instante.slice(11, 13)) >= 15 ? 48 : 35),
      wind_direction_10m: time.map(() => 90),
      weather_code: time.map(() => 2),
    },
    daily: {
      time: ["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01"],
      weather_code: [2, 3, 61, 2],
      temperature_2m_min: [20, 21, 19, 18],
      temperature_2m_max: [28, 27, 26, 25],
      precipitation_sum: [17, 12, 8, 0],
      wind_gusts_10m_max: [48, 42, 35, 30],
    },
  };
}

test("previsão das 05h cobre 05:00–00:00 e quatro dias; 15h começa às 15:00", { concurrency: false }, async () => {
  const anterior = global.fetch;
  const urls = [];
  global.fetch = async (url) => {
    urls.push(url);
    return { ok: true, json: async () => dadosOpenMeteo() };
  };
  try {
    const manha = await buscarOpenMeteo(-22.9, -43.2, { inicioHora: 5, diasPrevisao: 4 });
    const tarde = await buscarOpenMeteo(-22.9, -43.2, { inicioHora: 15, diasPrevisao: 2 });
    assert.equal(manha.precipitacaoTotalMm, 17);
    assert.equal(tarde.precipitacaoTotalMm, 5);
    assert.equal(manha.periodos.manha.precipitacaoMm, 8);
    assert.equal(tarde.periodos.manha.precipitacaoMm, 0);
    assert.equal(manha.tempMin, 20);
    assert.equal(tarde.tempMin, 25);
    assert.equal(manha.previsaoDias.length, 4);
    assert.match(urls[0], /forecast_days=4/);
    assert.match(urls[1], /forecast_days=2/);
  } finally {
    global.fetch = anterior;
  }
});

test("PDF e e-mail das 15h mostram janela, dias e comparação", () => {
  const report = {
    cidade: { nome: "Rio de Janeiro", uf: "RJ" },
    dataFormatadaCurta: "28/09/2026", dataFormatadaLonga: "segunda-feira, 28 de setembro de 2026", horaConsulta: "15:00",
    periodoCoberto: "Hoje, das 15:00 até 00:00, mais o dia seguinte",
    previsaoDias: [
      { periodo: "Hoje (15:00–00:00)", data: "2026-09-28", condicao: "Chuva", tempMin: 20, tempMax: 28, chuvaMm: 5, rajadaKmh: 48 },
      { periodo: "Amanhã", data: "2026-09-29", condicao: "Nublado", tempMin: 21, tempMax: 27, chuvaMm: 12, rajadaKmh: 42 },
    ],
    mudancasDia: ["Grau geral: ATENÇÃO → ALERTA.", "Rajada máxima prevista: 35 km/h → 48 km/h."],
    condicaoGeral: "Chuva", tabelaTemperaturaUmidade: [], ventoPorPeriodo: [], chuvaPorPeriodo: [],
    severidade: { grau: "NORMAL", eventos: [] }, avisosInmet: [], divergencias: [], avisosColeta: [],
    fontesAutomatizadas: [], fontesManuais: [], deslocamento: { pedestres: [], transporte: [], condutores: [] }, edificacao: [],
  };
  const pdf = renderPdfHtml(report);
  const email = renderEmailHtml(report);
  for (const saida of [pdf, email]) {
    assert.match(saida, /Hoje, das 15:00 até 00:00/);
    assert.match(saida, /Amanhã/);
    assert.match(saida, /ATENÇÃO → ALERTA/);
    assert.match(saida, /35 km\/h → 48 km\/h/);
  }
});
