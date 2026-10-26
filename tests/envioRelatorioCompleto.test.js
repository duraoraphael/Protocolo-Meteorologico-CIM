const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { renderEmailHtml } = require("../src/render/emailTemplate");
const { registrarOperacionalTeste } = require("./helpers/provenance");

function relatorioBase(sobrescritas = {}) {
  return {
    cidade: { chave: "rio_de_janeiro", nome: "Rio de Janeiro", uf: "RJ" },
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
    precipitacaoDiariaMm: 12.4,
    previsaoDias: [{ chuvaMm: 12.4 }],
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

test("informativo do e-mail mostra chuva prevista/dia e onda em cards distintos", () => {
  const html = renderEmailHtml(relatorioBase());

  assert.match(html, /Chuva prevista\/dia/i);
  assert.match(html, /12\.4 mm/);
  assert.doesNotMatch(html, /Mar — onda máx\./i);
  assert.match(html, /MAR — ALTURA MÁX\. DE ONDA/);
  assert.match(html, />1\.1 m</);
});

test("zero milímetro diário é exibido como dado válido", () => {
  const html = renderEmailHtml(relatorioBase({
    precipitacaoDiariaMm: 8.3,
    previsaoDias: [{ chuvaMm: 0 }],
  }));
  assert.match(html, /0 mm/);
  assert.doesNotMatch(html, /8\.3 mm/);
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
    const resultado = await enviarRelatorioPorEmail(registrarOperacionalTeste(relatorioBase()), pdfCompleto);

    assert.equal(resultado.messageId, "teste-message-id");
    const pdfs = mensagem.attachments.filter((anexo) => anexo.contentType === "application/pdf");
    assert.equal(pdfs.length, 1);
    assert.equal(pdfs[0].filename, "Informativo_Meteorologico_TESTE.pdf");
    assert.strictEqual(pdfs[0].content, pdfCompleto);
    // O cabeçalho é 100% HTML e não exige imagens inline por Content-ID.
    const logos = mensagem.attachments.filter((anexo) => anexo.cid);
    assert.deepEqual(logos, []);
    assert.doesNotMatch(mensagem.html, /logo-petrobras|data-email-header-petrobras/i);
    assert.match(mensagem.html, /Relatório técnico completo com tabelas/);
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

test("destinatário avulso exige autorização explícita e não marca o e-mail como teste", { concurrency: false }, async () => {
  const caminhoTransport = require.resolve("../src/email/transport");
  const caminhoEnvio = require.resolve("../src/email/sendReport");
  const transport = require(caminhoTransport);
  const criarTransportadorAnterior = transport.criarTransportador;
  const enderecoRemetenteAnterior = transport.enderecoRemetente;
  const destinatariosAnteriores = process.env.REPORT_RECIPIENTS;
  let mensagem;

  try {
    process.env.REPORT_RECIPIENTS = "ponto.focal@exemplo.com";
    transport.criarTransportador = () => ({
      sendMail: async (opcoes) => {
        mensagem = opcoes;
        return { messageId: "avulso-message-id", accepted: [opcoes.to], rejected: [] };
      },
    });
    transport.enderecoRemetente = () => ({
      email: "remetente@exemplo.com",
      formatado: '"Protocolo Meteorológico CIM" <remetente@exemplo.com>',
    });
    delete require.cache[caminhoEnvio];

    const { enviarRelatorioPorEmail } = require(caminhoEnvio);
    const report = registrarOperacionalTeste(relatorioBase({ envioTeste: false }));
    const pdf = Buffer.from("PDF-AVULSO");
    await assert.rejects(
      enviarRelatorioPorEmail(report, pdf, { destinatariosOverride: ["usuario@exemplo.com"] }),
      /autorizado explicitamente/,
    );
    const resultado = await enviarRelatorioPorEmail(report, pdf, {
      destinatariosOverride: ["usuario@exemplo.com"],
      permitirOverrideDestinatarios: true,
    });
    assert.deepEqual(resultado.destinatarios, ["usuario@exemplo.com"]);
    assert.match(mensagem.subject, /^Informativo Meteorológico/);
    assert.doesNotMatch(mensagem.subject, /\[TESTE/);
    assert.equal(mensagem.to, "usuario@exemplo.com");
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
  assert.doesNotMatch(html, /logo-petrobras|Petrobras_horizontal_logo/, "a marca Petrobras deve existir somente no PDF");
  assert.doesNotMatch(js, /api\/logos|carregarLogos/);
});
