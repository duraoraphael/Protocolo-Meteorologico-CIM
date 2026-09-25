// V-09: erros devolvem JSON genérico, sem stack trace nem caminhos.
const test = require("node:test");
const assert = require("node:assert/strict");
const { subirApp, SENHA_TESTE } = require("./helpers/servidor");

const VAZAMENTO = /at \w|node_modules|\/sessions\/|[A-Z]:\\|SyntaxError|PayloadTooLarge|body-parser|stack|<html|<pre/i;

async function silenciarConsole(t) {
  const original = console.error;
  console.error = () => {};
  t.after(() => { console.error = original; });
}

test("JSON malformado → 400 genérico", async (t) => {
  await silenciarConsole(t);
  const srv = await subirApp();
  t.after(srv.fechar);
  const r = await fetch(srv.base + "/api/verificar-senha", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: `{"senha":"${SENHA_TESTE}",`,
  });
  const texto = await r.text();
  assert.equal(r.status, 400);
  assert.match(r.headers.get("content-type"), /application\/json/);
  assert.deepEqual(JSON.parse(texto), { ok: false, erro: "Requisição inválida." });
  assert.doesNotMatch(texto, VAZAMENTO);
  assert.ok(!texto.includes(SENHA_TESTE));
});

test("corpo > 100 KB → 413 genérico", async (t) => {
  await silenciarConsole(t);
  const srv = await subirApp();
  t.after(srv.fechar);
  const r = await fetch(srv.base + "/api/responsaveis", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ senha: "x", nome: "a".repeat(200 * 1024) }),
  });
  const texto = await r.text();
  assert.equal(r.status, 413);
  assert.deepEqual(JSON.parse(texto), { ok: false, erro: "Requisição muito grande." });
  assert.doesNotMatch(texto, VAZAMENTO);
});

test("rota inexistente → 404 JSON; URL malformada não vaza stack", async (t) => {
  await silenciarConsole(t);
  const srv = await subirApp();
  t.after(srv.fechar);
  let r = await fetch(srv.base + "/api/nao-existe");
  assert.equal(r.status, 404);
  assert.deepEqual(await r.json(), { ok: false, erro: "Não encontrado." });
  r = await fetch(srv.base + "/%E0%A4%A");
  const texto = await r.text();
  assert.ok(r.status >= 400 && r.status < 500, String(r.status));
  assert.doesNotMatch(texto, VAZAMENTO);
});

test("erro inesperado numa rota → 500 genérico e detalhe só no console", async (t) => {
  const registros = [];
  const original = console.error;
  console.error = (...a) => registros.push(a.map(String).join(" "));
  t.after(() => { console.error = original; });
  const { tratadorDeErros } = require("../src/security/erros");
  let status, corpo;
  const res = { headersSent: false, status(s) { status = s; return this; }, json(c) { corpo = c; } };
  tratadorDeErros(new Error("detalhe interno /caminho/secreto"), { method: "GET", path: "/x" }, res, () => {});
  assert.equal(status, 500);
  assert.deepEqual(corpo, { ok: false, erro: "Erro interno." });
  assert.ok(registros.some((l) => l.includes("detalhe interno")));
});
