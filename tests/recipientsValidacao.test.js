// V-01: validação de nome/e-mail de responsáveis no servidor.
const test = require("node:test");
const assert = require("node:assert/strict");
const { validarNome, validarEmail } = require("../src/config/recipients");

test("nome: aceita nomes comuns e normaliza espaços", () => {
  assert.equal(validarNome("  Maria  da   Silva "), "Maria da Silva");
  assert.equal(validarNome("José Antônio (Operação)"), "José Antônio (Operação)");
});

test("nome: rejeita vazio, tipo errado, > 100 caracteres e < > \" '", () => {
  for (const v of ["", "   ", null, undefined, 42, ["Maria"], "a".repeat(101)]) {
    assert.throws(() => validarNome(v), { status: 400 });
  }
  for (const v of ["<img src=x onerror=alert(1)>", 'Ana "x"', "D'Ávila", "a>b", "nulo\u0000x", "del\u007fx"]) {
    assert.throws(() => validarNome(v), { status: 400 });
  }
  assert.equal(validarNome("a".repeat(100)).length, 100);
});

test("e-mail: aceita endereços válidos e normaliza caixa", () => {
  assert.equal(validarEmail(" Fulano.Tal@Petrobras.com.br "), "fulano.tal@petrobras.com.br");
  assert.equal(validarEmail("ops+cim@sub.exemplo.com"), "ops+cim@sub.exemplo.com");
});

test("e-mail: rejeita < > \" ' , espaços, formato inválido e > 254 caracteres", () => {
  const invalidos = [
    '"><svg/onload=alert(1)>@x.co',
    "a<b@x.co",
    "a'b@x.co",
    'a"b@x.co',
    "a,b@x.co",
    "a b@x.co",
    "a@b",
    "@x.co",
    "a@@x.co",
    "a..b@x.co",
    "a@-x.co",
    `${"a".repeat(65)}@x.co`,
    `a@${"b".repeat(60)}.${"c".repeat(60)}.${"d".repeat(60)}.${"e".repeat(60)}.${"f".repeat(10)}.com`,
    null,
    ["a@x.co"],
  ];
  for (const v of invalidos) assert.throws(() => validarEmail(v), { status: 400 }, String(v));
});
