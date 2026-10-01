const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("formulário de responsáveis identifica nome da pessoa e e-mail", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "public", "dashboard.html"), "utf8");
  assert.match(html, /<label[^>]+for="resp-input-nome"[\s\S]*Nome da pessoa/);
  assert.match(html, /id="resp-input-nome"[^>]+autocomplete="name"[^>]+required/);
  assert.match(html, /<label[^>]+for="resp-input-email"[\s\S]*E-mail/);
  assert.match(html, /id="resp-input-email"[^>]+type="email"[^>]+autocomplete="email"[^>]+required/);
  assert.match(html, /id="resp-botao-cadastrar"[^>]*>Cadastrar responsável</);
});
