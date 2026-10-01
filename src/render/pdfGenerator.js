const puppeteer = require("puppeteer");
const { renderPdfHtml, headerTemplateVazio, footerTemplate } = require("./pdfTemplate");
const { argsChromium, prepararPaginaIsolada } = require("./chromiumSeguro");

let navegadorPromise = null;

function iniciarNavegador() {
  const inicializacao = puppeteer.launch({
    headless: true,
    // --no-sandbox só em Linux/container (V-12) — ver chromiumSeguro.js.
    args: argsChromium(),
  });

  navegadorPromise = inicializacao;
  inicializacao.then(
    (browser) => {
      // Um Chromium encerrado não pode continuar no cache para a próxima
      // geração. O evento também é disparado em quedas inesperadas.
      if (typeof browser.once === "function") {
        browser.once("disconnected", () => {
          if (navegadorPromise === inicializacao) navegadorPromise = null;
        });
      }
    },
    () => {
      if (navegadorPromise === inicializacao) navegadorPromise = null;
    }
  );

  return inicializacao;
}

async function getBrowser() {
  let ultimoErro;

  for (let tentativa = 1; tentativa <= 2; tentativa += 1) {
    const inicializacao = navegadorPromise || iniciarNavegador();
    try {
      return await inicializacao;
    } catch (erro) {
      ultimoErro = erro;
      if (navegadorPromise === inicializacao) navegadorPromise = null;
      if (tentativa === 1) {
        console.warn(`[CIM] Chromium não iniciou; tentando novamente: ${erro.message}`);
      }
    }
  }

  throw ultimoErro;
}

async function gerarPdfBuffer(report) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    // V-12: sem JavaScript e sem rede (só data: e about:).
    await prepararPaginaIsolada(page);
    await page.setContent(renderPdfHtml(report), {
      waitUntil: "load",
      timeout: 60000,
    });
    const buffer = await page.pdf({
      format: "A4",
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: headerTemplateVazio(),
      footerTemplate: footerTemplate(report),
      margin: { top: "20px", bottom: "60px", left: "0px", right: "0px" },
    });
    return buffer;
  } finally {
    await page.close();
  }
}

async function fecharNavegador() {
  const inicializacao = navegadorPromise;
  if (inicializacao) {
    const browser = await inicializacao;
    await browser.close();
    if (navegadorPromise === inicializacao) navegadorPromise = null;
  }
}

module.exports = { gerarPdfBuffer, fecharNavegador };
