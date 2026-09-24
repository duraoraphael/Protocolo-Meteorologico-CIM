const puppeteer = require("puppeteer");
const { renderPdfHtml, headerTemplateVazio, footerTemplate } = require("./pdfTemplate");
const { argsChromium, prepararPaginaIsolada } = require("./chromiumSeguro");

let navegadorPromise = null;

function getBrowser() {
  if (!navegadorPromise) {
    navegadorPromise = puppeteer.launch({
      headless: true,
      // --no-sandbox só em Linux/container (V-12) — ver chromiumSeguro.js.
      args: argsChromium(),
    });
  }
  return navegadorPromise;
}

async function gerarPdfBuffer(report) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    // V-12: sem JavaScript e sem rede (só data: e about:).
    await prepararPaginaIsolada(page);
    await page.setContent(renderPdfHtml(report), { waitUntil: "networkidle0" });
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
  if (navegadorPromise) {
    const browser = await navegadorPromise;
    await browser.close();
    navegadorPromise = null;
  }
}

module.exports = { gerarPdfBuffer, fecharNavegador };
