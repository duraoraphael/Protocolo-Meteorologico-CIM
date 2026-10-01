const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

test("PDF estático aguarda o carregamento sem depender de networkidle", { concurrency: false }, async () => {
  let opcoesSetContent;
  const pagina = {
    setContent: async (_html, opcoes) => { opcoesSetContent = opcoes; },
    pdf: async () => Buffer.from("pdf"),
    close: async () => {},
  };
  const navegador = {
    newPage: async () => pagina,
    close: async () => {},
  };

  const carregarOriginal = Module._load;
  Module._load = function carregarComMocks(request, parent, isMain) {
    if (request === "puppeteer") return { launch: async () => navegador };
    if (parent?.filename.endsWith("pdfGenerator.js") && request === "./pdfTemplate") {
      return {
        renderPdfHtml: () => "<html><body>Relatório</body></html>",
        headerTemplateVazio: () => "<div></div>",
        footerTemplate: () => "<div></div>",
      };
    }
    if (parent?.filename.endsWith("pdfGenerator.js") && request === "./chromiumSeguro") {
      return { argsChromium: () => [], prepararPaginaIsolada: async () => {} };
    }
    return carregarOriginal.call(this, request, parent, isMain);
  };

  const caminhoGerador = require.resolve("../src/render/pdfGenerator");
  delete require.cache[caminhoGerador];
  let gerador;
  try {
    gerador = require(caminhoGerador);
  } finally {
    Module._load = carregarOriginal;
  }

  try {
    const pdf = await gerador.gerarPdfBuffer({});
    assert.deepEqual(pdf, Buffer.from("pdf"));
    assert.deepEqual(opcoesSetContent, { waitUntil: "load", timeout: 60000 });
  } finally {
    await gerador.fecharNavegador();
    delete require.cache[caminhoGerador];
  }
});

test("repete a inicialização do Chromium uma vez após Target closed", { concurrency: false }, async () => {
  let inicializacoes = 0;
  const pagina = {
    setContent: async () => {},
    pdf: async () => Buffer.from("pdf recuperado"),
    close: async () => {},
  };
  const navegador = {
    newPage: async () => pagina,
    close: async () => {},
  };

  const carregarOriginal = Module._load;
  Module._load = function carregarComMocks(request, parent, isMain) {
    if (request === "puppeteer") {
      return {
        launch: async () => {
          inicializacoes += 1;
          if (inicializacoes === 1) throw new Error("Protocol error (Target.setAutoAttach): Target closed");
          return navegador;
        },
      };
    }
    if (parent?.filename.endsWith("pdfGenerator.js") && request === "./pdfTemplate") {
      return {
        renderPdfHtml: () => "<html><body>Relatório</body></html>",
        headerTemplateVazio: () => "<div></div>",
        footerTemplate: () => "<div></div>",
      };
    }
    if (parent?.filename.endsWith("pdfGenerator.js") && request === "./chromiumSeguro") {
      return { argsChromium: () => [], prepararPaginaIsolada: async () => {} };
    }
    return carregarOriginal.call(this, request, parent, isMain);
  };

  const caminhoGerador = require.resolve("../src/render/pdfGenerator");
  delete require.cache[caminhoGerador];
  let gerador;
  try {
    gerador = require(caminhoGerador);
  } finally {
    Module._load = carregarOriginal;
  }

  try {
    const pdf = await gerador.gerarPdfBuffer({});
    assert.deepEqual(pdf, Buffer.from("pdf recuperado"));
    assert.equal(inicializacoes, 2);
  } finally {
    await gerador.fecharNavegador();
    delete require.cache[caminhoGerador];
  }
});
