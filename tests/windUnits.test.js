const test = require("node:test");
const assert = require("node:assert/strict");
const { converterVelocidadeParaKmh, unidadeVelocidadeSuportada } = require("../src/logic/windUnits");

test("conversão central preserva km/h e converte m/s e nós", () => {
  assert.equal(converterVelocidadeParaKmh(18, "km/h"), 18);
  assert.equal(converterVelocidadeParaKmh(5, "m/s"), 18);
  assert.equal(converterVelocidadeParaKmh(10, "m/s"), 36);
  assert.equal(converterVelocidadeParaKmh(15, "m/s"), 54);
  assert.equal(converterVelocidadeParaKmh(20, "knots"), 37.04);
});

test("conversão central rejeita unidade ausente ou desconhecida", () => {
  assert.equal(converterVelocidadeParaKmh(10, "mph"), null);
  assert.equal(converterVelocidadeParaKmh(null, "m/s"), null);
  assert.equal(unidadeVelocidadeSuportada("kt"), true);
  assert.equal(unidadeVelocidadeSuportada("mph"), false);
});
