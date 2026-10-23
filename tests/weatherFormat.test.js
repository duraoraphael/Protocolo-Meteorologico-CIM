const test = require("node:test");
const assert = require("node:assert/strict");

const { formatarRajadaNumero, formatarRajadaPrevista } = require("../public/weather-format");

test("rajada prevista é arredondada apenas na apresentação", () => {
  assert.equal(formatarRajadaPrevista("30,20"), "30 km/h");
  assert.equal(formatarRajadaPrevista(42.75), "43 km/h");
  assert.equal(formatarRajadaPrevista(18.9), "19 km/h");
  assert.equal(formatarRajadaPrevista(55.4), "55 km/h");
  assert.equal(formatarRajadaPrevista(105.8), "106 km/h");
  assert.equal(formatarRajadaNumero(51.856), "52");
});

test("rajada inválida não é apresentada como zero", () => {
  for (const valor of [null, undefined, "", "abc", -1, Infinity]) {
    assert.equal(formatarRajadaPrevista(valor), "Indisponível");
  }
});
