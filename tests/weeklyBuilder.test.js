const test = require("node:test");
const assert = require("node:assert/strict");
const { avaliarDia, SEVERIDADE } = require("../src/logic/weeklyBuilder");

test("dia semanal sem indicadores não é classificado como Normal", () => {
  const resultado = avaliarDia({
    codigoTempo: null,
    temMuitaChuva: false,
    precipitacaoMm: null,
    probabilidadeChuva: null,
    rajadaMaxKmh: null,
    uvMax: null,
  }, null);
  assert.equal(resultado.severidade, SEVERIDADE.INDISPONIVEL);
  assert.equal(resultado.dadosIncompletos, true);
  assert.deepEqual(resultado.riscos, []);
});

test("risco confirmado prevalece mesmo quando outro indicador está ausente", () => {
  const resultado = avaliarDia({
    codigoTempo: 2,
    temMuitaChuva: false,
    precipitacaoMm: 60,
    probabilidadeChuva: 90,
    rajadaMaxKmh: 70,
    uvMax: null,
  }, null);
  assert.equal(resultado.severidade, SEVERIDADE.CRITICO);
  assert.equal(resultado.dadosIncompletos, true);
  assert.ok(resultado.riscos.length >= 2);
});

test("Normal exige todos os indicadores de risco do dia", () => {
  const resultado = avaliarDia({
    codigoTempo: 2,
    temMuitaChuva: false,
    precipitacaoMm: 0,
    probabilidadeChuva: 10,
    rajadaMaxKmh: 20,
    uvMax: 4,
  }, null);
  assert.equal(resultado.severidade, SEVERIDADE.NORMAL);
  assert.equal(resultado.dadosIncompletos, false);
});
