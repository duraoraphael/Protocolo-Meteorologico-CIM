const test = require("node:test");
const assert = require("node:assert/strict");

const {
  API_TIMEOUT_MS,
  API_TENTATIVAS,
  buscarJsonComRetentativa,
  erroNormalizado,
} = require("../src/sources/httpJsonClient");

test("cliente comum usa a política padrão e se recupera de rede e timeout", async () => {
  const esperas = [];
  let chamadas = 0;
  const resultado = await buscarJsonComRetentativa("https://exemplo.test/dados", {
    nomeFonte: "Fonte de teste",
    fetchImpl: async () => {
      chamadas += 1;
      if (chamadas === 1) throw Object.assign(new Error("rede"), { name: "TypeError" });
      if (chamadas === 2) throw Object.assign(new Error("timeout"), { name: "TimeoutError" });
      return { ok: true, json: async () => ({ ok: true }) };
    },
    esperarFn: async (ms) => { esperas.push(ms); },
  });

  assert.equal(API_TIMEOUT_MS, 15000);
  assert.equal(API_TENTATIVAS, 3);
  assert.equal(chamadas, 3);
  assert.deepEqual(esperas, [2000, 4000]);
  assert.deepEqual(resultado, { ok: true });
});

test("cliente comum repete limites, erros do servidor e JSON interrompido", async () => {
  const respostas = [
    { ok: false, status: 429 },
    { ok: false, status: 503 },
    { ok: true, text: async () => "{incompleto" },
    { ok: true, text: async () => '{"valor":42}' },
  ];
  let chamadas = 0;
  const resultado = await buscarJsonComRetentativa("https://exemplo.test/dados", {
    nomeFonte: "Fonte de teste",
    tentativas: 4,
    fetchImpl: async () => respostas[chamadas++],
    esperarFn: async () => {},
  });

  assert.equal(chamadas, 4);
  assert.deepEqual(resultado, { valor: 42 });
});

test("cliente comum não repete erro HTTP permanente", async () => {
  let chamadas = 0;
  await assert.rejects(
    buscarJsonComRetentativa("https://exemplo.test/dados", {
      nomeFonte: "Fonte de teste",
      fetchImpl: async () => {
        chamadas += 1;
        return { ok: false, status: 400 };
      },
      esperarFn: async () => {},
    }),
    /Fonte de teste respondeu HTTP 400/
  );
  assert.equal(chamadas, 1);
});

test("cliente comum encerra timeout com mensagem padronizada", async () => {
  let chamadas = 0;
  await assert.rejects(
    buscarJsonComRetentativa("https://exemplo.test/dados", {
      nomeFonte: "Fonte de teste",
      timeoutMs: 25,
      fetchImpl: async () => {
        chamadas += 1;
        throw Object.assign(new Error("timeout"), { name: "TimeoutError" });
      },
      esperarFn: async () => {},
    }),
    /Fonte de teste: tempo de resposta esgotado \(0\.025s\) após 3 tentativas/
  );
  assert.equal(chamadas, 3);
});

test("diagnóstico preserva DNS, conexão recusada, reset e TLS", () => {
  const casos = [
    ["ENOTFOUND", "dns"],
    ["ECONNREFUSED", "connection_refused"],
    ["ECONNRESET", "connection_reset"],
    ["UNABLE_TO_VERIFY_LEAF_SIGNATURE", "tls"],
  ];
  for (const [code, tipo] of casos) {
    const original = Object.assign(new TypeError("fetch failed"), { cause: { code } });
    const erro = erroNormalizado(original, "Fonte", 15000);
    assert.equal(erro.code, code);
    assert.equal(erro.tipo, tipo);
    assert.equal(erro.cause, original);
  }
});

test("HTTP 401, 403 e 404 falham na primeira tentativa", async () => {
  for (const status of [401, 403, 404]) {
    let chamadas = 0;
    await assert.rejects(
      buscarJsonComRetentativa("https://exemplo.test/dados", {
        nomeFonte: "Fonte",
        fetchImpl: async () => { chamadas += 1; return { ok: false, status }; },
        esperarFn: async () => assert.fail("não deve aguardar"),
      }),
      (erro) => erro.httpStatus === status && erro.code === `HTTP_${status}`
    );
    assert.equal(chamadas, 1);
  }
});

test("resposta vazia recebe código próprio", async () => {
  await assert.rejects(
    buscarJsonComRetentativa("https://exemplo.test/dados", {
      nomeFonte: "Fonte",
      tentativas: 1,
      fetchImpl: async () => ({ ok: true, status: 200, text: async () => "  " }),
    }),
    (erro) => erro.tipo === "empty_response" && erro.code === "EMPTY_RESPONSE"
  );
});
