const test = require("node:test");
const assert = require("node:assert/strict");
const { subirApp, SENHA_TESTE } = require("./helpers/servidor");

async function postar(base, senha = SENHA_TESTE) {
  const resposta = await fetch(`${base}/api/gerar-relatorio`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ senha, cidade: "rio_de_janeiro" }),
  });
  return { resposta, corpo: await resposta.json() };
}

function resultadoPipeline() {
  return {
    report: {
      cidade: { chave: "rio_de_janeiro" },
      geradoEmISO: "2026-09-28T14:00:00.000Z",
      avisosColeta: [],
    },
    arquivoPdf: "Informativo_Teste.pdf",
    envio: { destinatarios: ["destinatario@example.com"] },
  };
}

test("senha inválida retorna 401 e não executa o pipeline", async (t) => {
  let chamadas = 0;
  const srv = await subirApp({
    executarPipelineRelatorio: async () => {
      chamadas += 1;
      return resultadoPipeline();
    },
  });
  t.after(srv.fechar);

  const { resposta, corpo } = await postar(srv.base, "senha-incorreta");
  assert.equal(resposta.status, 401);
  assert.equal(corpo.stage, "authorization");
  assert.equal(corpo.message, "Senha incorreta.");
  assert.equal(chamadas, 0);
});

test("sucesso retorna HTTP 200 e mensagem segura", async (t) => {
  const srv = await subirApp({ executarPipelineRelatorio: async () => resultadoPipeline() });
  t.after(srv.fechar);

  const { resposta, corpo } = await postar(srv.base);
  assert.equal(resposta.status, 200);
  assert.equal(corpo.ok, true);
  assert.equal(corpo.message, "Relatório gerado e enviado com sucesso.");
});

for (const caso of [
  { stage: "pdf", status: 500, message: "Não foi possível gerar o PDF." },
  { stage: "email", status: 502, message: "O PDF foi gerado, mas o envio do e-mail falhou." },
]) {
  test(`falha na etapa ${caso.stage} retorna resposta específica sem stack`, async (t) => {
    const erro = new Error("detalhe técnico restrito ao servidor");
    erro.etapa = caso.stage;
    erro.mensagemPublica = caso.message;
    const srv = await subirApp({ executarPipelineRelatorio: async () => { throw erro; } });
    t.after(srv.fechar);

    const { resposta, corpo } = await postar(srv.base);
    assert.equal(resposta.status, caso.status);
    assert.deepEqual(corpo, {
      ok: false,
      stage: caso.stage,
      message: caso.message,
      erro: caso.message,
    });
    assert.doesNotMatch(JSON.stringify(corpo), /detalhe técnico|stack|src[\\/]/i);
  });
}
