const test = require("node:test");
const assert = require("node:assert/strict");
const { classificarDadosRelatorio, validarDadosRelatorio } = require("../src/logic/meteorologicalValidity");

test("zero observado é distinto de falha e previsão", () => {
  const report = {
    precipitacaoDiariaMm: 0, precipitacaoHoraMm: null, precipitacaoUltimas24hMm: 0,
    precipitacaoTotalMm: 5, chuvaPrevistaDiaMm: 7, rajadaMaxKmh: 31, qualidadeAr: { iqar: 53, referenciaEm: "2026-10-23T14:00" },
    inmetObservacao: { status: "operacional", observacao: { medidoEm: "2026-10-23T17:00:00Z" } },
    fontesPorCampo: { precipitacaoDiariaMm: "INMET (A765)", precipitacaoUltimas24hMm: "INMET (A765)", precipitacaoTotalMm: "Open-Meteo", chuvaPrevistaDiaMm: "Open-Meteo", rajadaMaxKmh: "Open-Meteo", "ar.iqar": "Open-Meteo Air Quality" },
    ventoPorPeriodo: [],
  };
  report.classificacaoDados = classificarDadosRelatorio(report);
  assert.equal(report.classificacaoDados.chuvaObservadaDia.estado, "observada");
  assert.equal(report.classificacaoDados.chuvaObservadaDia.valor, 0);
  assert.equal(report.classificacaoDados.chuvaObservadaHora.estado, "indisponivel");
  assert.equal(report.classificacaoDados.chuvaPrevistaDia.estado, "prevista");
  assert.equal(report.classificacaoDados.qualidadeAr.estado, "estimada");
  assert.equal(validarDadosRelatorio(report), true);
});

test("bloqueia medição antiga e valor sem fonte antes da geração", () => {
  const report = {
    inmetObservacao: { status: "degradado", observacao: { desatualizado: true } },
    precipitacaoDiariaMm: 2, fontesPorCampo: { precipitacaoDiariaMm: "INMET" }, ventoPorPeriodo: [],
  };
  report.classificacaoDados = classificarDadosRelatorio(report);
  assert.throws(() => validarDadosRelatorio(report), /Medição INMET antiga/);
  report.precipitacaoDiariaMm = null;
  report.classificacaoDados = classificarDadosRelatorio(report);
  assert.equal(report.classificacaoDados.chuvaObservadaDia.estado, "desatualizada");
  assert.equal(validarDadosRelatorio(report), true);
  report.rajadaMaxKmh = 20;
  report.classificacaoDados.rajadaPrevista = { valor: 20, estado: "prevista", fonte: "Indisponível" };
  assert.throws(() => validarDadosRelatorio(report), /sem procedência/);
});
