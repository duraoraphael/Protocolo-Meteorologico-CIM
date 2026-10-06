const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buscarOpenMeteo,
  OPEN_METEO_TIMEOUT_MS,
  OPEN_METEO_TENTATIVAS,
} = require("../src/sources/openMeteo");
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

test("agendados (05h e 15h) cobrem hoje 05h–00h; painel usa as mesmas janelas", { concurrency: false }, async () => {
  const anterior = global.fetch;
  const urls = [];
  global.fetch = async (url) => {
    urls.push(url);
    return { ok: true, json: async () => dadosOpenMeteo() };
  };
  try {
    const agendado = await buscarOpenMeteo(-22.9, -43.2, { agregarJanela: true });
    const painel = await buscarOpenMeteo(-22.9, -43.2);
    assert.equal(agendado.precipitacaoTotalMm, 17);
    assert.equal(agendado.periodos.manha.precipitacaoMm, 8);
    assert.equal(agendado.tempMin, 20);
    assert.equal(agendado.previsaoDias.length, 4, "a fixture traz 4 dias; o relatório usa só o primeiro");
    assert.equal(agendado.janelaHoje.rotulo, "05h–00h");
    assert.match(urls[0], /forecast_days=1/);
    assert.match(urls[0], /timezone=America%2FSao_Paulo/);
    // Mesmo período, mesma janela e mesmo cálculo no painel e no PDF.
    for (const k of ["manha", "tarde", "noite"]) assert.deepEqual(painel.periodos[k], agendado.periodos[k]);
    assert.deepEqual(
      ["manha", "tarde", "noite"].map((k) => agendado.periodos[k].janela),
      ["05h–12h", "12h–18h", "18h–00h"]
    );
  } finally {
    global.fetch = anterior;
  }
});

test("vento e rajada são grandezas distintas: intensidade vem da velocidade média, não da rajada", { concurrency: false }, async () => {
  const anterior = global.fetch;
  global.fetch = async () => ({ ok: true, json: async () => dadosOpenMeteo() });
  try {
    const r = await buscarOpenMeteo(-22.9, -43.2, { diasPrevisao: 4, agregarJanela: true });
    // Vento horário 20 km/h; rajadas 35 (até 14h) e 48 km/h (a partir das 15h).
    assert.equal(r.periodos.tarde.velocidadeMaxKmh, 20);
    assert.equal(r.periodos.tarde.rajadaMaxKmh, 48);
    assert.equal(r.periodos.tarde.intensidadeVento, "Moderado (até 20 km/h)");
    assert.equal(r.periodos.manha.rajadaMaxKmh, 35);
    assert.equal(r.rajadaMaxKmh, 48);
  } finally {
    global.fetch = anterior;
  }
});

test("Open-Meteo pede o fuso da base e calcula a janela pelo horário local da resposta", { concurrency: false }, async () => {
  const anterior = global.fetch;
  const urls = [];
  global.fetch = async (url) => { urls.push(url); return { ok: true, json: async () => dadosOpenMeteo() }; };
  try {
    await buscarOpenMeteo(-3.1, -60.0, { fuso: "America/Manaus" });
    assert.match(urls[0], /timezone=America%2FManaus/);
  } finally {
    global.fetch = anterior;
  }
});

test("Windy não substitui vento, rajada e chuva por período quando a Open-Meteo responde", () => {
  const { integrarWindy } = require("../src/logic/windyMerge");
  const base = {
    tempMin: 20, tempMax: 30, rajadaMaxKmh: 40, precipitacaoTotalMm: 3,
    periodos: {
      manha: { periodo: "Manhã", janela: "05h–12h", direcao: "E", intensidadeVento: "Moderado (até 22 km/h)", rajadaMaxKmh: 30, precipitacaoMm: 1, probabilidadeChuva: 20 },
      tarde: { periodo: "Tarde", janela: "12h–18h", direcao: "SE", intensidadeVento: "Moderado (até 25 km/h)", rajadaMaxKmh: 40, precipitacaoMm: 2, probabilidadeChuva: 40 },
      noite: { periodo: "Noite", janela: "18h–00h", direcao: "E", intensidadeVento: "Fraco (até 12 km/h)", rajadaMaxKmh: 20, precipitacaoMm: 0, probabilidadeChuva: 10 },
    },
  };
  const periodoWindy = { direcao: "N", intensidadeVento: "até 50 km/h", rajadaMaxKmh: 70, precipitacaoMm: 9 };
  const weather = { fonte: "Windy (gfs)", tempMax: 31, rajadaMaxKmh: 70, precipitacaoTotalMm: 27, periodos: { manha: periodoWindy, tarde: periodoWindy, noite: periodoWindy } };
  const comOpenMeteo = integrarWindy(base, null, null, { weather }, "Open-Meteo");
  assert.equal(comOpenMeteo.base.rajadaMaxKmh, 40);
  assert.equal(comOpenMeteo.base.precipitacaoTotalMm, 3);
  assert.equal(comOpenMeteo.base.periodos.tarde.rajadaMaxKmh, 40);
  assert.equal(comOpenMeteo.base.periodos.tarde.intensidadeVento, "Moderado (até 25 km/h)");
  assert.equal(comOpenMeteo.fontesPorCampo["periodos.tarde.rajadaMaxKmh"], "Open-Meteo");
  assert.equal(comOpenMeteo.base.tempMax, 31, "Windy continua valendo para os demais campos");
  // Sem Open-Meteo, o Windy segue como alternativa.
  const semOpenMeteo = integrarWindy(base, null, null, { weather }, "INMET");
  assert.equal(semOpenMeteo.base.periodos.tarde.rajadaMaxKmh, 70);
  assert.equal(semOpenMeteo.fontesPorCampo["periodos.tarde.rajadaMaxKmh"], "Windy (gfs)");
});

test("Open-Meteo usa 15 segundos e repete falhas transitórias de rede", async () => {
  const chamadas = [];
  const esperas = [];
  const fetchImpl = async (url, opcoes) => {
    chamadas.push({ url, opcoes });
    if (chamadas.length < OPEN_METEO_TENTATIVAS) {
      const nome = chamadas.length === 1 ? "TypeError" : "TimeoutError";
      throw Object.assign(new Error("falha transitória de teste"), { name: nome });
    }
    return { ok: true, json: async () => dadosOpenMeteo() };
  };

  const resultado = await buscarOpenMeteo(-22.9, -43.2, {
    fetchImpl,
    esperarFn: async (ms) => { esperas.push(ms); },
  });

  assert.equal(OPEN_METEO_TIMEOUT_MS, 15000);
  assert.equal(chamadas.length, 3);
  assert.deepEqual(esperas, [2000, 4000]);
  assert.equal(resultado.fonte, "Open-Meteo");
  assert.ok(chamadas.every(({ opcoes }) => opcoes.signal instanceof AbortSignal));
});

test("Open-Meteo informa esgotamento depois de três timeouts", async () => {
  let chamadas = 0;
  await assert.rejects(
    buscarOpenMeteo(-22.9, -43.2, {
      timeoutMs: 25,
      fetchImpl: async () => {
        chamadas += 1;
        throw Object.assign(new Error("timeout de teste"), { name: "TimeoutError" });
      },
      esperarFn: async () => {},
    }),
    /tempo de resposta esgotado \(0\.025s\) após 3 tentativas/
  );
  assert.equal(chamadas, OPEN_METEO_TENTATIVAS);
});

test("PDF mantém a previsão futura e e-mail a omite sem perder a comparação", () => {
  const report = {
    cidade: { nome: "Rio de Janeiro", uf: "RJ" },
    dataFormatadaCurta: "28/09/2026", dataFormatadaLonga: "segunda-feira, 28 de setembro de 2026", horaConsulta: "15:00",
    periodoCoberto: "hoje, das 05h até 00h",
    previsaoDias: [
      { periodo: "Hoje (05h–00h)", data: "2026-09-28", condicao: "Chuva", tempMin: 20, tempMax: 28, chuvaMm: 12, rajadaKmh: 48 },
    ],
    mudancasDia: ["Grau geral: ATENÇÃO → ALERTA.", "Rajada máxima prevista: 35 km/h → 48 km/h."],
    condicaoGeral: "Chuva", tabelaTemperaturaUmidade: [], ventoPorPeriodo: [], chuvaPorPeriodo: [],
    severidade: { grau: "NORMAL", eventos: [] }, avisosInmet: [], divergencias: [], avisosColeta: [],
    fontesAutomatizadas: [], fontesManuais: [], deslocamento: { pedestres: [], transporte: [], condutores: [] }, edificacao: [],
  };
  const pdf = renderPdfHtml(report);
  const email = renderEmailHtml(report);
  assert.doesNotMatch(pdf, /Previsão por dia/);
  assert.match(pdf, /<strong>Período coberto:<\/strong> hoje, das 05h até 00h\.<\/p>/);
  assert.match(pdf, /<th>Chuva\/dia<\/th>/);
  assert.match(pdf, /12,0 mm/);
  assert.match(pdf, /<th>Calor<\/th>/);
  assert.match(pdf, /<p class="fonte-tabela">Fonte de dados: Open-Meteo \(condição, temperatura, chuva e rajada\)\. Para hoje, chuva e rajada consideram a janela indicada\. Calor: Clima e Saúde — Ministério da Saúde: indisponível nesta emissão — classificação EHF/);
  assert.match(pdf, /class="calor-nd">Indisponível</);
  assert.doesNotMatch(pdf, /Amanhã|Dia \+\d|dias seguintes usam/);
  assert.doesNotMatch(email, /Previsão para os próximos dias/);
  assert.doesNotMatch(email, /hoje, das 05h até 00h|Amanhã|Nublado/);
  for (const saida of [pdf, email]) {
    assert.match(saida, /ATENÇÃO → ALERTA/);
    assert.match(saida, /35 km\/h → 48 km\/h/);
  }
});
