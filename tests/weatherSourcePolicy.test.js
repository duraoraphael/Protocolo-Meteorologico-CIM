const test = require("node:test");
const assert = require("node:assert/strict");
const { aplicarPoliticaFontes } = require("../src/logic/weatherSourcePolicy");

function periodo(periodo) {
  return { periodo, rajadaMaxKmh: 99, precipitacaoMm: 99, probabilidadeChuva: 99 };
}

function cenario({ climaSaude, inmetPrevisao, inmetObservacao, openMeteo: openMeteoRecebido } = {}) {
  const openMeteo = openMeteoRecebido === undefined ? {
    tempMin: 21, tempMax: 31, umidadeMin: 48, umidadeMax: 87,
    precipitacaoDiariaMm: 12.5,
    periodos: { manha: periodo("Manhã"), tarde: periodo("Tarde"), noite: periodo("Noite") },
  } : openMeteoRecebido;
  const base = { ...(openMeteo || {}), periodos: {
    manha: periodo("Manhã"), tarde: periodo("Tarde"), noite: periodo("Noite"),
  } };
  const fontesPorCampo = {};
  const logs = [];
  const previsaoPadrao = {
    data: "09/10/2026",
    dias: [{ data: "2026-10-09", dataBr: "09/10/2026", tempMin: 21, tempMax: 33, umidadeMin: 50, umidadeMax: 100 }],
    periodos: {
      manha: { tempMin: 21, tempMax: 33, umidadeMin: 50, umidadeMax: 100 },
      tarde: { tempMin: 21, tempMax: 33, umidadeMin: 50, umidadeMax: 100 },
      noite: { tempMin: 21, tempMax: 33, umidadeMin: 50, umidadeMax: 100 },
    },
  };
  const resultado = aplicarPoliticaFontes({
    base,
    openMeteo,
    inmetPrevisao: inmetPrevisao === undefined ? previsaoPadrao : inmetPrevisao,
    inmetObservacao: inmetObservacao || {
      status: "operacional",
      observacao: { desatualizado: false, temperaturaAtualC: 29, umidadeAtualPct: 70 },
      agregado: {
        temperaturaMinC: 23.4,
        temperaturaMaxC: 32.8,
        umidadeMinPct: 45,
        umidadeMaxPct: 82,
        coberturaTemperatura: { amostras: 8, horasEsperadas: 15, parcial: true },
        coberturaUmidade: { amostras: 7, horasEsperadas: 15, parcial: true },
        periodos: {
          manha: { tempMin: 23.4, tempMax: 27.1, velocidadeMaxKmh: 18, rajadaMaxKmh: 30, direcao: "E", precipitacaoMm: 2, precipitacaoHorariaMaxMm: 2, medidoEm: "2026-10-09T12:00:00Z" },
          tarde: { tempMin: 27.5, tempMax: 32.8, velocidadeMaxKmh: 24, rajadaMaxKmh: 44, direcao: "SE", precipitacaoMm: 5, precipitacaoHorariaMaxMm: 3, medidoEm: "2026-10-09T18:00:00Z" },
        },
        precipitacaoTotalMm: 7,
        precipitacaoHorariaMaxMm: 3,
        chuvaPorHora: [
          { intervalo: "10:00–11:00", precipitacaoMm: 2, medidoEm: "2026-10-09T14:00:00Z" },
          { intervalo: "14:00–15:00", precipitacaoMm: 3, medidoEm: "2026-10-09T18:00:00Z" },
        ],
        rajadaMaxKmh: 44,
        cobertura: { amostras: 8, parcial: true },
      },
    },
    climaSaude: climaSaude || { status: "operacional", dados: {
      dataConsulta: "2026-10-09", temperatura: { minima: 22, maxima: 30 },
      umidade: { minima: null, maxima: null },
    } },
    fontesPorCampo,
    agora: new Date("2026-10-09T12:00:00-03:00"),
    logger: { log: (mensagem) => logs.push(mensagem) },
  });
  return { base, fontesPorCampo, logs, diagnosticos: resultado.diagnosticos };
}

test("extremos diários vêm da previsão INMET e extremos horários observados ficam separados", () => {
  const { base, fontesPorCampo, diagnosticos } = cenario();
  assert.deepEqual([base.tempMin, base.tempMax], [21, 33]);
  assert.deepEqual([base.umidadeMin, base.umidadeMax], [50, 100]);
  assert.deepEqual([base.temperaturaObservadaMinC, base.temperaturaObservadaMaxC], [23.4, 32.8]);
  assert.deepEqual([base.umidadeObservadaMinPct, base.umidadeObservadaMaxPct], [45, 82]);
  assert.equal(base.coberturaTemperaturaObservada.amostras, 8);
  assert.equal(fontesPorCampo.tempMin, "INMET — previsão oficial");
  assert.equal(fontesPorCampo["periodos.manha.tempMin"], "INMET — previsão oficial");
  assert.equal(fontesPorCampo.temperaturaObservadaMinC, "INMET — estação automática — observado");
  assert.ok(diagnosticos.some((d) =>
    d.indicador === "rajada prevista (manha)" &&
    d.fontePrioritaria === "INMET — previsão oficial" &&
    d.fonteUtilizada === "Open-Meteo — previsão complementar"));
});

test("Clima e Saúde não substitui temperatura ou umidade do INMET", () => {
  const { base, fontesPorCampo } = cenario({ climaSaude: { status: "operacional", dados: {
    dataConsulta: "2026-10-09",
    temperatura: { minima: 22, maxima: 30 },
    umidade: { minima: 45, maxima: 82 },
  } } });
  assert.deepEqual([base.umidadeMin, base.umidadeMax], [50, 100]);
  assert.equal(fontesPorCampo.umidadeMax, "INMET — previsão oficial");
});

test("previsão de vento e chuva prioriza INMET e usa Open-Meteo apenas nos campos ausentes", () => {
  const { base, fontesPorCampo } = cenario({ inmetPrevisao: { periodos: {
    noite: {
      direcaoVento: "S", intensidadeVento: "Fracos", velocidadeMediaKmh: 25,
      rajadaMaxKmh: 80, precipitacaoMm: 50, precipitacaoHorariaMaxMm: 12,
      probabilidadeChuva: 90, resumo: "Pancadas de chuva e trovoadas",
    },
  } } });
  assert.equal(base.periodos.manha.rajadaMaxKmh, 99);
  assert.equal(base.periodos.manha.rajadaObservadaMaxKmh, 30);
  assert.equal(base.periodos.tarde.precipitacaoMm, 99);
  assert.equal(base.periodos.noite.rajadaMaxKmh, 80);
  assert.equal(base.periodos.noite.precipitacaoMm, 50);
  assert.equal(base.periodos.noite.velocidadeMediaKmh, 25);
  assert.equal(base.periodos.noite.precipitacaoHorariaMaxMm, 12);
  assert.equal(base.periodos.noite.probabilidadeChuva, 90);
  assert.equal(base.periodos.noite.tempestade, true);
  assert.equal(base.periodos.noite.direcao, "S");
  assert.equal(base.periodos.noite.intensidadeVento, "Fracos");
  assert.equal(base.periodos.noite.tipoDado, "previsto");
  assert.equal(base.precipitacaoTotalMm, 248);
  assert.equal(base.precipitacaoDiariaMm, 7);
  assert.equal(base.precipitacaoHoraMm, 3);
  assert.equal(base.precipitacaoHoraReferencia, "14:00–15:00");
  assert.equal(fontesPorCampo.precipitacaoHoraMm, "INMET — estação automática — observado");
  assert.equal(base.rajadaMaxKmh, 99);
  assert.equal(base.precipitacaoHorariaMaxMm, 12);
  assert.equal(base.probabilidadeChuvaMax, 99);
  assert.equal(base.temTempestadeHoje, true);
  assert.equal(base.rajadaObservadaMaxKmh, 44);
  assert.equal(fontesPorCampo["periodos.tarde.rajadaMaxKmh"], "Open-Meteo — previsão complementar");
  assert.equal(fontesPorCampo["periodos.noite.rajadaMaxKmh"], "INMET — previsão oficial");
  assert.equal(fontesPorCampo["periodos.noite.velocidadeMediaKmh"], "INMET — previsão oficial");
  assert.equal(fontesPorCampo["periodos.noite.precipitacaoHorariaMaxMm"], "INMET — previsão oficial");
  assert.equal(fontesPorCampo["periodos.noite.probabilidadeChuva"], "INMET — previsão oficial");
});

test("falha numérica do INMET permite complemento identificado de temperatura, vento e chuva", () => {
  const { base, fontesPorCampo, diagnosticos } = cenario({
    climaSaude: { status: "indisponivel", dados: null },
    inmetPrevisao: { dias: [], periodos: {} },
    inmetObservacao: { status: "indisponivel", observacao: null, agregado: { periodos: {}, temperaturaMinC: null, temperaturaMaxC: null } },
  });
  assert.deepEqual([base.tempMin, base.tempMax, base.umidadeMin, base.umidadeMax], [21, 31, 48, 87]);
  assert.deepEqual([base.rajadaMaxKmh, base.precipitacaoTotalMm, base.precipitacaoDiariaMm], [99, 297, null]);
  assert.equal(fontesPorCampo.tempMax, "Open-Meteo — previsão complementar");
  assert.equal(fontesPorCampo.rajadaMaxKmh, "Open-Meteo — previsão complementar");
  assert.equal(fontesPorCampo.precipitacaoTotalMm, "Open-Meteo — previsão complementar");
  assert.ok(diagnosticos.some((d) => /utilizado o valor válido da previsão complementar/i.test(d.motivo)));
  assert.ok(diagnosticos.some((d) => d.indicador === "rajada prevista (manha)" && d.fonteUtilizada === "Open-Meteo — previsão complementar"));
});

test("falha simultânea das previsões mantém campos indisponíveis sem fabricar zero", () => {
  const { base, fontesPorCampo, diagnosticos } = cenario({
    openMeteo: null,
    inmetPrevisao: { dias: [], periodos: {} },
    inmetObservacao: { status: "indisponivel", observacao: null, agregado: { periodos: {} } },
  });
  assert.deepEqual([base.tempMin, base.tempMax, base.umidadeMin, base.umidadeMax], [null, null, null, null]);
  assert.deepEqual([base.rajadaMaxKmh, base.precipitacaoTotalMm], [null, null]);
  assert.equal(fontesPorCampo.tempMax, "Indisponível");
  assert.ok(diagnosticos.some((d) => /nem a previsão municipal do INMET nem a previsão complementar/i.test(d.motivo)));
});
