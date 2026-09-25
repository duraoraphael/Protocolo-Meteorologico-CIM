// V-05: atraso progressivo por IP, sem bloquear a senha correta.
const test = require("node:test");
const assert = require("node:assert/strict");
const { criarControleTentativas, valorTrustProxy } = require("../src/security/tentativas");
const { subirApp, SENHA_TESTE } = require("./helpers/servidor");

function controleFalso(opcoes = {}) {
  const esperas = [];
  let agora = 0;
  const c = criarControleTentativas({
    agora: () => agora,
    dormir: async (ms) => { esperas.push(ms); agora += ms; },
    ...opcoes,
  });
  return { c, esperas, avancar: (ms) => { agora += ms; } };
}

test("atraso progressivo a partir da 3ª falha, com teto", () => {
  const { c } = controleFalso();
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 20].map((f) => c.atrasoPara(f)), [0, 0, 0, 500, 1000, 2000, 4000, 30000]);
});

test("senha correta entra depois de 7 falhas de outra pessoa no mesmo IP", async () => {
  const { c, esperas } = controleFalso();
  for (let i = 0; i < 7; i++) {
    const r = await c.verificar("10.0.0.1", () => false);
    assert.equal(r.status, 401);
  }
  const r = await c.verificar("10.0.0.1", () => true);
  assert.equal(r.ok, true);
  assert.equal(r.atrasoMs, 8000);
  assert.deepEqual(esperas, [500, 1000, 2000, 4000, 8000]);
  assert.equal(c.falhasDe("10.0.0.1"), 0, "sucesso zera o contador");
  const outroIp = await c.verificar("10.0.0.2", () => true);
  assert.equal(outroIp.atrasoMs, 0);
});

test("contador é esquecido após 15 min sem falhas", async () => {
  const { c, avancar } = controleFalso();
  for (let i = 0; i < 5; i++) await c.verificar("ip", () => false);
  avancar(15 * 60 * 1000 + 1);
  assert.equal(c.falhasDe("ip"), 0);
});

test("mapa de tentativas tem tamanho máximo", async () => {
  const { c } = controleFalso({ maxIps: 100 });
  for (let i = 0; i < 1000; i++) await c.verificar(`10.1.${i >> 8}.${i & 255}`, () => false);
  assert.ok(c.tamanho <= 100, String(c.tamanho));
});

test("excesso de respostas em espera → 503 sem avaliar a senha", async () => {
  const pendentes = [];
  const c = criarControleTentativas({ maxEmEsperaTotal: 2, dormir: () => new Promise((r) => pendentes.push(r)) });
  for (let i = 0; i < 3; i++) await c.verificar("ip", () => false);
  let avaliou = false;
  const p1 = c.verificar("ip", () => false);
  const p2 = c.verificar("ip", () => false);
  const r3 = await c.verificar("ip", () => { avaliou = true; return true; });
  assert.equal(r3.status, 503);
  assert.equal(avaliou, false);
  pendentes.forEach((r) => r());
  await Promise.all([p1, p2]);
});

test("TRUST_PROXY: padrão desligado; aceita true, número e lista", () => {
  for (const v of [undefined, null, "", "false", "0", "off"]) assert.equal(valorTrustProxy(v), false, String(v));
  assert.equal(valorTrustProxy("true"), 1);
  assert.equal(valorTrustProxy("2"), 2);
  assert.deepEqual(valorTrustProxy("127.0.0.1, 10.0.0.0/8"), ["127.0.0.1", "10.0.0.0/8"]);
});

async function tentar(base, senha, xff) {
  const r = await fetch(base + "/api/verificar-senha", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(xff ? { "X-Forwarded-For": xff } : {}) },
    body: JSON.stringify({ senha }),
  });
  await r.arrayBuffer();
  return r.status;
}

test("HTTP: 7 erros e depois a senha correta → 200 (sem 429)", async (t) => {
  const srv = await subirApp({ opcoesTentativas: { atrasoBaseMs: 5, atrasoMaxMs: 20 } });
  t.after(srv.fechar);
  for (let i = 0; i < 7; i++) assert.equal(await tentar(srv.base, "senha-errada-000"), 401);
  assert.equal(await tentar(srv.base, SENHA_TESTE), 200);
});

test("HTTP: sem TRUST_PROXY, X-Forwarded-For não separa contadores", async (t) => {
  const srv = await subirApp({ trustProxy: undefined, opcoesTentativas: { atrasoBaseMs: 1, atrasoMaxMs: 2 } });
  t.after(srv.fechar);
  for (let i = 0; i < 4; i++) await tentar(srv.base, "senha-errada-000", `203.0.113.${i}`);
  assert.equal(srv.app.locals.controleTentativas.falhasDe("127.0.0.1"), 4);
});

test("HTTP: com TRUST_PROXY=1, o IP do cliente vem do X-Forwarded-For", async (t) => {
  const srv = await subirApp({ trustProxy: "1", opcoesTentativas: { atrasoBaseMs: 1, atrasoMaxMs: 2 } });
  t.after(srv.fechar);
  await tentar(srv.base, "senha-errada-000", "203.0.113.7");
  assert.equal(srv.app.locals.controleTentativas.falhasDe("203.0.113.7"), 1);
  assert.equal(srv.app.locals.controleTentativas.falhasDe("127.0.0.1"), 0);
});
