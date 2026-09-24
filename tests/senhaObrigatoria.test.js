// V-02: sem senha forte o servidor não inicia; comparação em tempo constante.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { problemaSenhaConfigurada, criarComparadorSenha } = require("../src/security/senha");

const SERVER = path.join(__dirname, "..", "server.js");

test("rejeita senha ausente, curta ou igual ao valor padrão antigo", () => {
  for (const v of [undefined, null, "", "curta", "12345678901", "Marciana", "MARCIANA", "marciana"]) {
    assert.ok(problemaSenhaConfigurada(v), `deveria rejeitar ${v}`);
  }
  assert.equal(problemaSenhaConfigurada("senha-de-teste-forte-123"), null);
});

test("comparador aceita só a senha exata (string), sem confusão de tipo", () => {
  const confere = criarComparadorSenha("senha-de-teste-forte-123");
  assert.equal(confere("senha-de-teste-forte-123"), true);
  for (const v of ["senha-de-teste-forte-12", "senha-de-teste-forte-1234", "", null, undefined, 123,
    ["senha-de-teste-forte-123"], { toString: () => "senha-de-teste-forte-123" }, "x".repeat(5000)]) {
    assert.equal(confere(v), false);
  }
  assert.throws(() => criarComparadorSenha("Marciana"));
});

test("criarApp recusa senha fraca", () => {
  const { criarApp } = require("../server.js");
  assert.throws(() => criarApp({ senhaPainel: undefined }));
  assert.throws(() => criarApp({ senhaPainel: "Marciana" }));
  assert.equal(typeof criarApp({ senhaPainel: "senha-de-teste-forte-123" }), "function");
});

test("node server.js encerra com código 1 sem DASHBOARD_PASSWORD válida", () => {
  // cwd temporário e vazio: o dotenv não encontra nenhum .env (nem o real).
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "cim-senha-"));
  for (const senha of [undefined, "Marciana", "curta123"]) {
    const env = { PATH: process.env.PATH, PORTA: "0", ENVIO_AUTOMATICO_DIARIO: "false", MONITOR_ALERTAS: "false" };
    if (senha !== undefined) env.DASHBOARD_PASSWORD = senha;
    const r = spawnSync(process.execPath, [SERVER], { cwd, env, encoding: "utf-8", timeout: 20000 });
    assert.equal(r.status, 1, `senha=${senha} stdout=${r.stdout} stderr=${r.stderr}`);
    assert.match(r.stderr, /DASHBOARD_PASSWORD/);
  }
});
