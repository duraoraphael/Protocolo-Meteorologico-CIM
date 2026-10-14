const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { registrarOperacionalTeste } = require("./helpers/provenance");

test("envios geral e COR-RIO usam listas isoladas e sem duplicação", { concurrency: false }, async (t) => {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), "cim-cor-rio-dest-"));
  const arquivo = path.join(pasta, "responsaveis.json");
  fs.writeFileSync(arquivo, JSON.stringify({
    versao: 2,
    responsaveis: [
      { nome: "Somente COR", email: "cor@exemplo.com", bases: ["cor_rio"] },
      { nome: "Somente Rio", email: "rio@exemplo.com", bases: ["rio_de_janeiro"] },
      { nome: "Ambos", email: "ambos@exemplo.com", bases: ["rio_de_janeiro", "cor_rio"] },
    ],
  }));

  const anteriorArquivo = process.env.RESPONSAVEIS_ARQUIVO;
  const anteriorFallback = process.env.REPORT_RECIPIENTS;
  process.env.RESPONSAVEIS_ARQUIVO = arquivo;
  process.env.REPORT_RECIPIENTS = "fallback@exemplo.com,FALLBACK@exemplo.com";

  const caminhoRecipients = require.resolve("../src/config/recipients");
  const caminhoTransport = require.resolve("../src/email/transport");
  const caminhoEnvio = require.resolve("../src/email/sendReport");
  delete require.cache[caminhoRecipients];
  delete require.cache[caminhoEnvio];
  const transport = require(caminhoTransport);
  const criarAnterior = transport.criarTransportador;
  const remetenteAnterior = transport.enderecoRemetente;
  const mensagens = [];

  transport.criarTransportador = () => ({
    sendMail: async (mensagem) => {
      mensagens.push(mensagem);
      return { messageId: `m-${mensagens.length}`, response: "250 OK", accepted: mensagem.to.split(", "), rejected: [] };
    },
  });
  transport.enderecoRemetente = () => ({ formatado: "CIM <cim@exemplo.com>" });
  delete require.cache[caminhoEnvio];

  t.after(() => {
    transport.criarTransportador = criarAnterior;
    transport.enderecoRemetente = remetenteAnterior;
    delete require.cache[caminhoEnvio];
    delete require.cache[caminhoRecipients];
    if (anteriorArquivo === undefined) delete process.env.RESPONSAVEIS_ARQUIVO;
    else process.env.RESPONSAVEIS_ARQUIVO = anteriorArquivo;
    if (anteriorFallback === undefined) delete process.env.REPORT_RECIPIENTS;
    else process.env.REPORT_RECIPIENTS = anteriorFallback;
    fs.rmSync(pasta, { recursive: true, force: true });
  });

  const { enviarRelatorioPorEmail, enviarAvisoCorRioPorEmail, listaDestinatarios } = require(caminhoEnvio);
  const report = {
    cidade: { chave: "rio_de_janeiro", nome: "Rio de Janeiro", uf: "RJ" },
    nomeArquivoBase: "Informativo_Rio",
    dataFormatadaLonga: "terça-feira, 13 de outubro de 2026",
    dataFormatadaCurta: "13/10/2026",
    horaConsulta: "15:00",
    geradoEmISO: "2026-10-13T18:00:00.000Z",
    tabelaTemperaturaUmidade: [], ventoPorPeriodo: [], chuvaPorPeriodo: [],
    qualidadeAr: null, mar: null, severidade: { grau: "NORMAL", eventos: [] },
    avisosInmet: [], fontesPorCampo: {}, fontesAutomatizadas: [],
    corRio: {
      fonte: "COR-Rio", abrangencia: "Município do Rio de Janeiro",
      estagio: { status: "operacional", dados: { nivel: 2, mensagens: [] }, consultadoEm: "2026-10-13T17:55:00.000Z" },
      calor: { status: "operacional", dados: { nivel: 1 }, consultadoEm: "2026-10-13T17:55:00.000Z" },
      comunicados: { status: "operacional", itens: [], janelaHoras: 24, consultadoEm: "2026-10-13T17:55:00.000Z" },
    },
  };
  registrarOperacionalTeste(report);

  await enviarRelatorioPorEmail(report, Buffer.from("pdf-geral"));
  await enviarAvisoCorRioPorEmail(report);

  assert.deepEqual(mensagens[0].to.split(", "), ["rio@exemplo.com", "ambos@exemplo.com"]);
  assert.doesNotMatch(mensagens[0].html, /Comunicado oficial COR-Rio/);
  assert.equal(mensagens[0].attachments.filter((item) => item.contentType === "application/pdf").length, 1);

  assert.deepEqual(mensagens[1].to.split(", "), ["cor@exemplo.com", "ambos@exemplo.com"]);
  assert.match(mensagens[1].html, /AVISO COR-RIO/);
  assert.match(mensagens[1].html, /Comunicado oficial COR-Rio/);
  assert.equal(mensagens[1].attachments.filter((item) => item.contentType === "application/pdf").length, 0);
  assert.deepEqual(listaDestinatarios("macae"), ["fallback@exemplo.com"]);
});

test("aviso COR-RIO sem vínculo não usa destinatário geral de fallback", { concurrency: false }, () => {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), "cim-cor-rio-sem-dest-"));
  const arquivo = path.join(pasta, "responsaveis.json");
  fs.writeFileSync(arquivo, JSON.stringify({ versao: 2, responsaveis: [] }));
  const anteriorArquivo = process.env.RESPONSAVEIS_ARQUIVO;
  const anteriorFallback = process.env.REPORT_RECIPIENTS;
  process.env.RESPONSAVEIS_ARQUIVO = arquivo;
  process.env.REPORT_RECIPIENTS = "geral@exemplo.com";
  const caminhoRecipients = require.resolve("../src/config/recipients");
  const caminhoEnvio = require.resolve("../src/email/sendReport");
  delete require.cache[caminhoRecipients];
  delete require.cache[caminhoEnvio];
  const { listaDestinatarios } = require(caminhoEnvio);
  assert.deepEqual(listaDestinatarios("cor_rio", { permitirFallback: false }), []);
  delete require.cache[caminhoEnvio];
  delete require.cache[caminhoRecipients];
  if (anteriorArquivo === undefined) delete process.env.RESPONSAVEIS_ARQUIVO;
  else process.env.RESPONSAVEIS_ARQUIVO = anteriorArquivo;
  if (anteriorFallback === undefined) delete process.env.REPORT_RECIPIENTS;
  else process.env.REPORT_RECIPIENTS = anteriorFallback;
  fs.rmSync(pasta, { recursive: true, force: true });
});
