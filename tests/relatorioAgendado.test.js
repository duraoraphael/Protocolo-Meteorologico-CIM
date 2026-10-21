const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buscarOpenMeteo,
  OPEN_METEO_TIMEOUT_MS,
  OPEN_METEO_TENTATIVAS,
} = require("../src/sources/openMeteo");
const { renderPdfHtml } = require("../src/render/pdfTemplate");
const { renderEmailHtml } = require("../src/render/emailTemplate");
const { montarVentoPorPeriodo, probabilidadeChuvaDaEdicao } = require("../src/logic/reportBuilder");
const { mapearFontesDoRelatorio } = require("../src/logic/sourceProvenance");

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

test("probabilidade da edição usa o máximo entre seu horário e 00h", () => {
  const chuvaHoraria = Array.from({ length: 19 }, (_, indice) => {
    const hora = indice + 5;
    return { horario: `${String(hora).padStart(2, "0")}:00`, probabilidade: hora === 14 ? 85 : hora === 20 ? 92 : 20 };
  });
  const openMeteo = { chuvaHoraria };

  assert.deepEqual(probabilidadeChuvaDaEdicao({ horarioAgendado: "08:00", openMeteo }), {
    valor: 92,
    fonte: "Open-Meteo — previsão complementar",
    janela: "08h–00h",
    regra: "probabilidade máxima prevista no período",
  });
  assert.deepEqual(probabilidadeChuvaDaEdicao({ horarioAgendado: "15:00", openMeteo }), {
    valor: 92,
    fonte: "Open-Meteo — previsão complementar",
    janela: "15h–00h",
    regra: "probabilidade máxima prevista no período",
  });
  assert.deepEqual(probabilidadeChuvaDaEdicao({
    horarioAgendado: "08:00",
    inmetPrevisao: { periodos: { tarde: { probabilidadeChuva: 95 } } },
    openMeteo,
  }), {
    valor: 95,
    fonte: "INMET — previsão oficial",
    janela: "08h–00h",
    regra: "probabilidade máxima prevista no período",
  });
});

test("edições usam janelas efetivas 08h–00h e 15h–00h", { concurrency: false }, async () => {
  const anterior = global.fetch;
  const urls = [];
  global.fetch = async (url) => {
    urls.push(url);
    return { ok: true, json: async () => dadosOpenMeteo() };
  };
  try {
    const manha = await buscarOpenMeteo(-22.9, -43.2, { inicioHora: 8, fimHora: 24, agregarJanela: true });
    const tarde = await buscarOpenMeteo(-22.9, -43.2, { inicioHora: 15, fimHora: 24, agregarJanela: true });
    const painel = await buscarOpenMeteo(-22.9, -43.2);
    assert.equal(manha.precipitacaoTotalMm, 10);
    assert.equal(tarde.precipitacaoTotalMm, 5);
    assert.equal(manha.periodos.manha.precipitacaoMm, 1);
    assert.equal(manha.periodos.noite.disponivel, true);
    assert.equal(tarde.periodos.manha.disponivel, false);
    assert.equal(manha.periodosDiaCompleto.noite.disponivel, true);
    assert.equal(tarde.periodosDiaCompleto.manha.precipitacaoMm, 8);
    assert.equal(manha.tempMin, 20);
    assert.equal(manha.previsaoDias.length, 4, "a fixture traz 4 dias; o relatório usa só o primeiro");
    assert.equal(manha.janelaHoje.rotulo, "08h–00h");
    assert.equal(tarde.janelaHoje.rotulo, "15h–00h");
    assert.deepEqual(
      { fonte: manha.atual.fonte, previsao: manha.atual.previsao },
      { fonte: "Open-Meteo", previsao: true },
      "o bloco current da Open-Meteo deve permanecer identificado como saída de modelo"
    );
    assert.match(urls[0], /forecast_days=1/);
    assert.match(urls[0], /timezone=America%2FSao_Paulo/);
    assert.equal(painel.precipitacaoTotalMm, 17);
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

test("vento por período cobre 05h–00h nas edições das 08h e 15h", () => {
  const periodo = (periodo, janela, rajadaMaxKmh) => ({
    periodo, janela, direcao: "SE", intensidadeVento: "Moderado (até 20 km/h)",
    velocidadeMaxKmh: 20, rajadaMaxKmh, disponivel: true,
  });
  const periodosDiaCompleto = {
    manha: periodo("Manhã", "05h–12h", 31),
    tarde: periodo("Tarde", "12h–18h", 37),
    noite: periodo("Noite", "18h–00h", 42),
  };
  const inmetPrevisao = { periodos: {
    manha: { direcaoVento: "E", intensidadeVento: "Fracos" },
    tarde: { direcaoVento: "SE", intensidadeVento: "Moderados" },
    noite: { direcaoVento: "S", intensidadeVento: "Fracos" },
  } };

  for (const periodosDaEdicao of [
    { manha: periodosDiaCompleto.manha, tarde: periodo("Tarde", "12h–15h", 34), noite: { disponivel: false } },
    { manha: { disponivel: false }, tarde: periodo("Tarde", "15h–18h", 37), noite: periodosDiaCompleto.noite },
  ]) {
    const vento = montarVentoPorPeriodo({
      base: { periodos: periodosDiaCompleto },
      inmetObservacao: { observacao: { estacao: { nome: "Estação teste", codigo: "A000", distanciaKm: 10 } } },
    });
    assert.deepEqual(vento.map(({ periodo, janela }) => [periodo, janela]), [
      ["Manhã", "05h–12h"], ["Tarde", "12h–18h"], ["Noite", "18h–00h"],
    ]);
    assert.deepEqual(vento.map(({ rajadaMaxKmh }) => rajadaMaxKmh), [31, 37, 42]);
    assert.deepEqual(vento.map(({ direcao }) => direcao), ["SE", "SE", "SE"]);
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

test("Open-Meteo não transforma séries ausentes em zero ou infinito", async () => {
  const dados = dadosOpenMeteo();
  dados.hourly.precipitation[5] = null;
  dados.hourly.wind_gusts_10m = [];
  dados.hourly.relative_humidity_2m = dados.hourly.relative_humidity_2m.map(() => null);
  dados.daily.temperature_2m_min[0] = null;
  const resultado = await buscarOpenMeteo(-22.9, -43.2, {
    fetchImpl: async () => ({ ok: true, json: async () => dados }),
  });
  assert.equal(resultado.periodos.manha.precipitacaoMm, null);
  assert.equal(resultado.precipitacaoTotalMm, null);
  assert.equal(resultado.rajadaMaxKmh, null);
  assert.equal(resultado.umidadeMin, null);
  assert.equal(resultado.tempMin, null);
});

test("Open-Meteo rejeita unidade e fuso divergentes", async () => {
  for (const alterar of [
    (dados) => { dados.timezone = "UTC"; },
    (dados) => { dados.hourly_units = { wind_speed_10m: "m/s" }; },
  ]) {
    const dados = dadosOpenMeteo();
    alterar(dados);
    await assert.rejects(
      buscarOpenMeteo(-22.9, -43.2, {
        fetchImpl: async () => ({ ok: true, json: async () => dados }),
      }),
      /fuso divergente|unidade inesperada/
    );
  }
});

test("rastreabilidade preserva os valores normalizados da Open-Meteo", () => {
  const base = {
    tempMin: 20, tempMax: 30, rajadaMaxKmh: 40, precipitacaoTotalMm: 3,
    periodos: {
      manha: { periodo: "Manhã", janela: "05h–12h", direcao: "E", intensidadeVento: "Moderado (até 22 km/h)", rajadaMaxKmh: 30, precipitacaoMm: 1, probabilidadeChuva: 20 },
      tarde: { periodo: "Tarde", janela: "12h–18h", direcao: "SE", intensidadeVento: "Moderado (até 25 km/h)", rajadaMaxKmh: 40, precipitacaoMm: 2, probabilidadeChuva: 40 },
      noite: { periodo: "Noite", janela: "18h–00h", direcao: "E", intensidadeVento: "Fraco (até 12 km/h)", rajadaMaxKmh: 20, precipitacaoMm: 0, probabilidadeChuva: 10 },
    },
  };
  const rastreado = mapearFontesDoRelatorio(base, null, null, "Open-Meteo");
  assert.equal(rastreado.base.tempMax, 30);
  assert.equal(rastreado.base.rajadaMaxKmh, 40);
  assert.equal(rastreado.base.precipitacaoTotalMm, 3);
  assert.equal(rastreado.base.periodos.tarde.rajadaMaxKmh, 40);
  assert.equal(rastreado.base.periodos.tarde.intensidadeVento, "Moderado (até 25 km/h)");
  assert.equal(rastreado.fontesPorCampo["periodos.tarde.rajadaMaxKmh"], "Open-Meteo");
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

test("PDF e e-mail exibem a referência da edição sem perder a comparação", () => {
  const report = {
    cidade: { nome: "Rio de Janeiro", uf: "RJ" },
    dataFormatadaCurta: "28/09/2026", dataFormatadaLonga: "segunda-feira, 28 de setembro de 2026", horaConsulta: "15:00",
    horarioAgendado: "15:00", previsaoAte: "00h", periodoCoberto: "hoje, das 15h até 00h do dia seguinte",
    previsaoDias: [
      { periodo: "Hoje (15h–00h)", data: "2026-09-28", condicao: "Chuva", tempMin: 20, tempMax: 28, chuvaMm: 12, rajadaKmh: null },
    ],
    mudancasDia: ["Grau geral: ATENÇÃO → ALERTA.", "Rajada prevista: 35 km/h → 48 km/h."],
    condicaoGeral: "Chuva", tabelaTemperaturaUmidade: [], ventoPorPeriodo: [], chuvaPorPeriodo: [],
    fontesPorCampo: { tempMin: "INMET — previsão oficial", tempMax: "INMET — previsão oficial", rajadaMaxKmh: "INMET — previsão oficial" },
    severidade: { grau: "NORMAL", eventos: [] }, avisosInmet: [], divergencias: [], avisosColeta: [],
    fontesAutomatizadas: [], fontesManuais: [], deslocamento: { pedestres: [], transporte: [], condutores: [] }, edificacao: [],
  };
  const pdf = renderPdfHtml(report);
  const email = renderEmailHtml(report);
  assert.doesNotMatch(pdf, /Previsão por dia/);
  assert.match(pdf, /Hora da consulta:<\/strong> 15h \(Horário de Brasília\).*Previsão até 00h/);
  assert.match(pdf, /<th>Chuva prevista\/dia<\/th>/);
  assert.match(pdf, /12,0 mm/);
  assert.match(pdf, /<th>Calor<\/th>/);
  assert.match(pdf, /O INMET é prioritário e qualquer complemento permanece identificado por campo/);
  assert.match(pdf, /class="calor-nd">Indisponível</);
  assert.doesNotMatch(pdf, /Amanhã|Dia \+\d|dias seguintes usam/);
  assert.doesNotMatch(email, /Previsão para os próximos dias/);
  assert.match(email, /Previsão até 00h/);
  assert.ok(email.indexOf("Previsão até 00h") < email.indexOf("RAJADA PREVISTA"));
  assert.doesNotMatch(email, /\| Previsão até/);
  assert.doesNotMatch(email, /Amanhã|Nublado/);
  assert.match(pdf, /ATENÇÃO → ALERTA/);
  assert.match(pdf, /35 km\/h → 48 km\/h/);
  assert.doesNotMatch(email, /ATENÇÃO → ALERTA/);
  assert.doesNotMatch(email, /35 km\/h → 48 km\/h/);
  assert.doesNotMatch(email, /ATUALIZAÇÃO DE PREVISÃO/);
});
