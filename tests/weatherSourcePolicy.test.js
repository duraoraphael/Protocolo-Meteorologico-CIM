const test = require("node:test");
const assert = require("node:assert/strict");
const { aplicarPoliticaFontes, FONTE_OPEN_METEO, INDISPONIVEL } = require("../src/logic/weatherSourcePolicy");

function executar(openMeteo = null, inmetOperacional = true) {
  const base = { atual: {}, periodos: { manha: {}, tarde: {}, noite: {} } };
  const fontesPorCampo = {};
  const avisos = [];
  const resultado = aplicarPoliticaFontes({
    base,
    cidade: { uf: "RJ" },
    openMeteo,
    inmetObservacao: inmetOperacional ? {
      status: "operacional",
      observacao: { medidoEm: "2026-10-22T12:00:00Z", estacao: { codigo: "A636", uf: "RJ", distanciaKm: 23.8 } },
      agregado: {
        rajadaMaxKmh: 30, precipitacaoTotalMm: 2, periodos: {}, chuvaPorHora: [],
        temperaturaMinC: 21, temperaturaMaxC: 27, temperaturaAtualC: 25.5,
        umidadeMinPct: 55, umidadeMaxPct: 82, umidadeAtualPct: 70,
        coberturaTemperatura: { amostras: 6, horasEsperadas: 10, parcial: true },
        coberturaUmidade: { amostras: 6, horasEsperadas: 10, parcial: true },
      },
    } : { status: "indisponivel", observacao: null },
    fontesPorCampo,
    logger: { warn: (mensagem) => avisos.push(mensagem) },
  });
  return { base, fontesPorCampo, avisos, diagnosticos: resultado.diagnosticos };
}

test("INMET fornece temperatura e umidade observadas; Open-Meteo permanece na chuva prevista", () => {
  const periodo = { direcao: "S", intensidadeVento: "Fraco", velocidadeMediaKmh: 12, velocidadeMaxKmh: 18, rajadaMaxKmh: 99, precipitacaoMm: 2, precipitacaoHorariaMaxMm: 1, probabilidadeChuva: 40 };
  const previsao = {
    tempMin: 20, tempMax: 30, umidadeMin: 50, umidadeMax: 90,
    precipitacaoTotalMm: 6, precipitacaoHorariaMaxMm: 1, probabilidadeChuvaMax: 40, rajadaMaxKmh: 99,
    condicaoGeral: "Nublado", temTempestadeHoje: false,
    atual: { temperaturaC: 25, condicao: "Nublado", fonte: "Open-Meteo" },
    periodos: { manha: periodo, tarde: periodo, noite: periodo },
  };
  const { base, fontesPorCampo } = executar(previsao);
  assert.deepEqual([base.tempMin, base.tempMax, base.umidadeMin, base.umidadeMax], [21, 27, 55, 82]);
  assert.equal(base.rajadaMaxKmh, 99);
  assert.equal(base.periodos.manha.rajadaMaxKmh, 99);
  assert.equal(base.precipitacaoTotalMm, 6);
  assert.equal(base.atual.temperaturaC, 25.5);
  assert.deepEqual([base.temperaturaObservadaMinC, base.temperaturaObservadaMaxC], [21, 27]);
  assert.match(fontesPorCampo.tempMax, /INMET — estação automática/);
  assert.match(fontesPorCampo["atual.temperaturaC"], /INMET — estação automática/);
  assert.equal(fontesPorCampo.rajadaMaxKmh, FONTE_OPEN_METEO);
});

test("campos não publicados ficam indisponíveis e geram diagnóstico", () => {
  const { base, fontesPorCampo, avisos, diagnosticos } = executar(null, false);
  assert.equal(base.tempMax, null);
  assert.equal(base.rajadaMaxKmh, null);
  assert.equal(base.precipitacaoTotalMm, null);
  assert.equal(fontesPorCampo.tempMax, INDISPONIVEL);
  assert.equal(fontesPorCampo.rajadaMaxKmh, INDISPONIVEL);
  assert.ok(diagnosticos.some((d) => d.indicador === "tempMax" && d.fonteUtilizada === INDISPONIVEL));
  assert.ok(avisos.some((mensagem) => /INFORMAÇÃO INDISPONÍVEL/.test(mensagem)));
});

test("estação de outra UF e a mais de 50 km não fornece temperatura ou umidade", () => {
  const base = { periodos: { manha: {}, tarde: {}, noite: {} } };
  const fontesPorCampo = {};
  aplicarPoliticaFontes({ base, cidade: { uf: "SE" }, fontesPorCampo, logger: null,
    openMeteo: { tempMin: 23, tempMax: 33, umidadeMin: 40, umidadeMax: 90 },
    inmetObservacao: { status: "operacional", observacao: { estacao: { codigo: "A472", uf: "BA", distanciaKm: 131.2 } },
      agregado: { temperaturaMinC: 30, temperaturaMaxC: 33, umidadeMinPct: 50, umidadeMaxPct: 60, precipitacaoTotalMm: 2 } },
  });
  assert.deepEqual([base.tempMin, base.tempMax, base.umidadeMin, base.umidadeMax], [null, null, null, null]);
  assert.equal(base.precipitacaoDiariaMm, 2);
  assert.equal(fontesPorCampo.tempMin, INDISPONIVEL);
});

test("medição antiga em cache não ocupa campos de chuva observada", () => {
  const base = { periodos: { manha: {}, tarde: {}, noite: {} } };
  const fontesPorCampo = {};
  aplicarPoliticaFontes({ base, openMeteo: null, fontesPorCampo, logger: null, inmetObservacao: {
    status: "degradado", observacao: { desatualizado: true, estacao: { codigo: "A765" } },
    agregado: { precipitacaoTotalMm: 0, precipitacaoUltimas24hMm: 4, chuvaPorHora: [{ precipitacaoMm: 1, medidoEm: "2026-10-23T12:00:00Z" }] },
  } });
  assert.equal(base.precipitacaoDiariaMm, null);
  assert.equal(base.precipitacaoHoraMm, null);
  assert.equal(base.precipitacaoUltimas24hMm, null);
  assert.equal(fontesPorCampo.precipitacaoDiariaMm, INDISPONIVEL);
});

test("estimativas históricas continuam disponíveis quando a chuva INMET é nula", () => {
  const base = { periodos: { manha: {}, tarde: {}, noite: {} } };
  const fontesPorCampo = {};
  aplicarPoliticaFontes({ base, fontesPorCampo, logger: null,
    openMeteo: { estimativaChuva: { diaMm: 5.4, ultimaHoraMm: 0.6, ultimas24hMm: 5.9,
      referenciaEm: "2026-10-23T14:00", ultimaHoraReferencia: "2026-10-23T14:00",
      coberturaDia: { amostras: 14, horasEsperadas: 14, parcial: false },
      cobertura24h: { amostras: 24, horasEsperadas: 24, parcial: false } } },
    inmetObservacao: { status: "operacional", observacao: { estacao: { codigo: "A765" } },
      agregado: { precipitacaoTotalMm: null, precipitacaoUltimas24hMm: null, chuvaPorHora: [] } },
  });
  assert.deepEqual([base.chuvaEstimadaDiaMm, base.chuvaEstimadaHoraMm, base.chuvaEstimada24hMm], [5.4, 0.6, 5.9]);
  assert.deepEqual([base.precipitacaoDiariaMm, base.precipitacaoHoraMm, base.precipitacaoUltimas24hMm], [null, null, null]);
  assert.match(fontesPorCampo.chuvaEstimadaDiaMm, /estimativa de modelo/);
  assert.equal(fontesPorCampo.precipitacaoDiariaMm, INDISPONIVEL);
});
