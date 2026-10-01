// V-10: validação da chave de base (getCidade / validarCidade / rotas).
const test = require("node:test");
const assert = require("node:assert/strict");
const { getCidade, CIDADE_PADRAO } = require("../src/config/cities");
const { validarCidade } = require("../src/config/recipients");
const { subirApp, SENHA_TESTE } = require("./helpers/servidor");

const INVALIDAS = ["constructor", "__proto__", "toString", "hasOwnProperty", "valueOf",
  "RIO_DE_JANEIRO", "rio de janeiro", "rio-de-janeiro", "a", "x".repeat(41), "nao_existe",
  ["rio_de_janeiro"], { chave: "rio_de_janeiro" }, 123, true];

test("getCidade aceita chaves cadastradas e usa o padrão quando vazio", () => {
  assert.equal(getCidade("macae").chave, "macae");
  assert.equal(getCidade(undefined).chave, CIDADE_PADRAO);
  assert.equal(getCidade("").chave, CIDADE_PADRAO);
});

test("getCidade e validarCidade rejeitam protótipo, tipo, formato e tamanho", () => {
  for (const v of INVALIDAS) {
    assert.throws(() => getCidade(v), { status: 400, message: "Base inválida." }, String(v));
    assert.throws(() => validarCidade(v), { status: 400, message: "Base inválida." }, String(v));
  }
  assert.throws(() => validarCidade(undefined), { status: 400 });
});

test("rotas devolvem 'Base inválida.' sem erro interno nem lista de bases", async (t) => {
  const srv = await subirApp();
  t.after(srv.fechar);
  const casos = [
    ["GET", "/api/preview?cidade=constructor"],
    ["GET", "/api/preview?cidade=__proto__"],
    ["GET", "/api/preview?cidade=rio_de_janeiro&cidade=macae"],
    ["GET", "/api/responsaveis?cidade=toString"],
    ["POST", "/api/responsaveis", { senha: SENHA_TESTE, cidade: "__proto__", nome: "Teste", email: "t@x.co" }],
    ["DELETE", "/api/responsaveis", { senha: SENHA_TESTE, cidade: "constructor", email: "t@x.co" }],
    ["POST", "/api/gerar-relatorio", { senha: SENHA_TESTE, cidade: "toString" }],
  ];
  for (const [metodo, url, corpo] of casos) {
    const r = await fetch(srv.base + url, {
      method: metodo,
      headers: corpo ? { "Content-Type": "application/json" } : {},
      body: corpo ? JSON.stringify(corpo) : undefined,
    });
    const texto = await r.text();
    assert.equal(r.status, 400, `${metodo} ${url}: ${texto}`);
    assert.deepEqual(JSON.parse(texto), { ok: false, erro: "Base inválida." }, `${metodo} ${url}`);
    assert.doesNotMatch(texto, /macae|brasilia|is not a function|src\//);
  }
});
