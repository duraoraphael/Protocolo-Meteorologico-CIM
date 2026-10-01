const test = require("node:test");
const assert = require("node:assert/strict");
const { Agent, getGlobalDispatcher } = require("undici");

const { TIMEOUT_CONEXAO_HTTP_MS } = require("../src/security/certificados");

test("APIs aceitam handshake corporativo superior ao limite padrão de 10 segundos", () => {
  assert.equal(TIMEOUT_CONEXAO_HTTP_MS, 30000);
  assert.ok(getGlobalDispatcher() instanceof Agent);
});
