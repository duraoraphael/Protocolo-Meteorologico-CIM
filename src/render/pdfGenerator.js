const puppeteer = require("puppeteer");
const { renderPdfHtml, headerTemplateVazio, footerTemplate } = require("./pdfTemplate");

let navegadorPromise = null;

function getBrowser() {
  if (!navegadorPromise) {
    navegadorPromise = puppeteer.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        // Containers Docker (Render, etc.) costumam limitar /dev/shm a
        // ~64MB — sem essa flag o Chrome pode travar/matar a aba ao
        // renderizar o PDF, causando "Navigation timeout" no page.setContent.
        "--disable-dev-shm-usage",
        "--disable-gpu",
      ],
    });
  }
  return navegadorPromise;
}

async function gerarPdfBuffer(report) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
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
