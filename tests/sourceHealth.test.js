const test = require("node:test");
const assert = require("node:assert/strict");

const {
  operacional,
  indisponivel,
  degradado,
  naoConfigurada,
  paraMonitoramento,
  formatarDataBrasilia,
} = require("../src/sources/sourceHealth");

test("health check usa estrutura padronizada sem expor erro técnico na mensagem", () => {
  const erro = Object.assign(new Error("segredo interno ECONNRESET"), {
    code: "ECONNRESET",
    tipo: "connection_reset",
  });
  const health = indisponivel("Fonte", erro);
  assert.deepEqual(Object.keys(health), [
    "source", "status", "checkedAt", "lastSuccessAt", "httpStatus", "message", "errorCode",
  ]);
  assert.equal(health.status, "indisponivel");
  assert.equal(health.errorCode, "ECONNRESET");
  assert.equal(health.message, "Não foi possível atualizar esta fonte.");
  assert.doesNotMatch(health.message, /ECONNRESET|segredo/);
});

test("health check diferencia operacional, degradado e não configurado", () => {
  const instante = "2026-10-01T09:00:00.000Z";
  assert.equal(operacional("Fonte", "Dados recebidos", { checkedAt: instante }).status, "operacional");
  const fallback = degradado("Fonte", Object.assign(new Error("timeout"), { code: "ETIMEDOUT" }), instante);
  assert.equal(fallback.status, "degradado");
  assert.match(fallback.message, /01\/10\/2026 06:00/);
  assert.equal(naoConfigurada("Fonte", "Sem vínculo").status, "nao_configurada");
  const monitor = paraMonitoramento("fonte", "Fonte", fallback);
  assert.equal(monitor.detalhe, fallback.message);
});

test("timestamp é exibido no horário de Brasília sem ISO cru", () => {
  const formatado = formatarDataBrasilia("2026-09-29T17:13:19.243Z");
  assert.equal(formatado, "29/09/2026 14:13");
  assert.doesNotMatch(formatado, /T|Z/);
});
