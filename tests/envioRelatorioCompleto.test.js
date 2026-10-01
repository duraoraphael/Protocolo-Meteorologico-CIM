const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { renderEmailHtml } = require("../src/render/emailTemplate");

function relatorioBase(sobrescritas = {}) {
  return {
    cidade: { chave: null, nome: "Rio de Janeiro", uf: "RJ" },
    nomeArquivoBase: "Informativo_Meteorologico_TESTE",
    dataFormatadaLonga: "segunda-feira, 28 de setembro de 2026",
    dataFormatadaCurta: "28/09/2026",
    horaConsulta: "10:00",
    condicaoGeral: "Parcialmente nublado",
    tempMin: 20,
    tempMax: 28,
    umidadeMin: 50,
    umidadeMax: 90,
    precipitacaoTotalMm: 12.4,
    ventoPorPeriodo: [],
    qualidadeAr: null,
    mar: { alturaMaxDiaM: 1.1 },
    severidade: { grau: "NORMAL", eventos: [] },
    eventoMaisRelevante: null,
    avisosInmet: [],
    deslocamento: { pedestres: [], condutores: [] },
    edificacao: [],
    ...sobrescritas,
  };
}

test("informativo do e-mail mostra chuva acumulada e onda em cards distintos", () => {
  const html = renderEmailHtml(relatorioBase());

  assert.match(html, /Chuva acumulada/i);
  assert.match(html, /12\.4 mm/);
  assert.doesNotMatch(html, /Mar — onda máx\./i);
  assert.match(html, /MAR — ALTURA MÁX\. DE ONDA/);
  assert.match(html, />1\.1 m</);
});

test("zero milímetro é exibido como dado válido", () => {
  const html = renderEmailHtml(relatorioBase({ precipitacaoTotalMm: 0 }));
  assert.match(html, /0 mm/);
});

test("envio reutiliza o PDF completo em memória como anexo SMTP", { concurrency: false }, async () => {
  const caminhoTransport = require.resolve("../src/email/transport");
  const caminhoEnvio = require.resolve("../src/email/sendReport");
  const transport = require(caminhoTransport);
  const criarTransportadorAnterior = transport.criarTransportador;
  const enderecoRemetenteAnterior = transport.enderecoRemetente;
  const destinatariosAnteriores = process.env.REPORT_RECIPIENTS;
  let mensagem;

  try {
    process.env.REPORT_RECIPIENTS = "destino.teste@petrobras.com.br";
    transport.criarTransportador = () => ({
      sendMail: async (opcoes) => {
        mensagem = opcoes;
        return {
          messageId: "teste-message-id",
          response: "250 2.0.0 OK",
          accepted: ["destino.teste@petrobras.com.br"],
          rejected: [],
        };
      },
    });
    transport.enderecoRemetente = () => ({
      email: "remetente.teste@petrobras.com.br",
      formatado: '"Protocolo Meteorológico CIM" <remetente.teste@petrobras.com.br>',
    });
    delete require.cache[caminhoEnvio];

    const { enviarRelatorioPorEmail } = require(caminhoEnvio);
    const pdfCompleto = Buffer.from("PDF-COMPLETO-VALIDACAO");
    const resultado = await enviarRelatorioPorEmail(relatorioBase(), pdfCompleto);

    assert.equal(resultado.messageId, "teste-message-id");
    const pdfs = mensagem.attachments.filter((anexo) => anexo.contentType === "application/pdf");
    assert.equal(pdfs.length, 1);
    assert.equal(pdfs[0].filename, "Informativo_Meteorologico_TESTE.pdf");
    assert.strictEqual(pdfs[0].content, pdfCompleto);
    // Logos do cabeçalho seguem inline por Content-ID, referenciadas no HTML.
    const logos = mensagem.attachments.filter((anexo) => anexo.cid);
    assert.deepEqual(logos.map((anexo) => anexo.cid), ["logo-petrobras-header@cim"]);
    assert.equal(logos[0].contentDisposition, "inline");
    assert.ok(fs.existsSync(logos[0].path));
    assert.match(mensagem.html, /src="cid:logo-petrobras-header@cim"/);
    assert.match(mensagem.html, /Relatório completo com todas as tabelas/);
    assert.equal(resultado.respostaSmtp, "250 2.0.0 OK");
    assert.equal(resultado.aceitos, 1);
    assert.equal(resultado.rejeitados, 0);
  } finally {
    transport.criarTransportador = criarTransportadorAnterior;
    transport.enderecoRemetente = enderecoRemetenteAnterior;
    delete require.cache[caminhoEnvio];
    if (destinatariosAnteriores === undefined) delete process.env.REPORT_RECIPIENTS;
    else process.env.REPORT_RECIPIENTS = destinatariosAnteriores;
  }
});

test("botão informa progresso, evita clique duplo e confirma o envio", () => {
  const js = fs.readFileSync(path.join(__dirname, "..", "public", "dashboard.js"), "utf8");
  const html = fs.readFileSync(path.join(__dirname, "..", "public", "dashboard.html"), "utf8");

  assert.match(js, /botaoConfirmar\.disabled = true/);
  assert.match(js, /Gerando relatório…/);
  assert.match(js, /Gerando PDF…/);
  assert.match(js, /Enviando relatório…/);
  assert.match(js, /Relatório gerado e enviado com sucesso/);
  assert.match(js, /botaoConfirmar\.disabled = false/);
  assert.match(html, /id="modal-mensagem"[^>]+aria-live="polite"/);
});
