const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer");
const { argsChromium, prepararPaginaIsolada } = require("./render/chromiumSeguro");

const { montarRelatorioSemanal } = require("./logic/weeklyBuilder");
const { renderWeeklyPdfHtml, weeklyFooterTemplate } = require("./render/weeklyPdfTemplate");
const { renderWeeklyEmailHtml } = require("./render/weeklyEmailTemplate");
const ged = require("./integrations/sharepointGed");

const PASTA_SAIDA = path.join(__dirname, "..", "output");

async function gerarPdfSemanalBuffer(relatorio) {
  const navegador = await puppeteer.launch({
    headless: true,
    args: argsChromium(), // --no-sandbox só em Linux/container (V-12)
  });
  try {
    const pagina = await navegador.newPage();
    // V-12: sem JavaScript e sem rede (só data: e about:).
    await prepararPaginaIsolada(pagina);
    await pagina.setContent(renderWeeklyPdfHtml(relatorio), { waitUntil: "networkidle0" });
    return await pagina.pdf({
      format: "A4",
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: "<div></div>",
      footerTemplate: weeklyFooterTemplate(relatorio),
      margin: { top: "16px", bottom: "54px", left: "0px", right: "0px" },
    });
  } finally {
    await navegador.close();
  }
}

/**
 * Gera o relatório semanal. Por padrão NÃO envia e-mail — o envio é sempre
 * uma escolha explícita, para que gerar um preview nunca dispare mensagem
 * para as bases por engano.
 */
async function executarPipelineSemanal({ bases, dias = 7, enviarEmail = false, salvarPreviewHtml = false } = {}) {
  const relatorio = await montarRelatorioSemanal({ bases, dias });

  const pdfBuffer = await gerarPdfSemanalBuffer(relatorio);
  const emailHtml = renderWeeklyEmailHtml(relatorio);

  if (!fs.existsSync(PASTA_SAIDA)) fs.mkdirSync(PASTA_SAIDA, { recursive: true });
  const caminhoPdf = path.join(PASTA_SAIDA, `${relatorio.nomeArquivoBase}.pdf`);
  fs.writeFileSync(caminhoPdf, pdfBuffer);

  let caminhoHtmlEmail = null;
  let caminhoHtmlPdf = null;
  if (salvarPreviewHtml) {
    caminhoHtmlEmail = path.join(PASTA_SAIDA, `${relatorio.nomeArquivoBase}_EMAIL.html`);
    caminhoHtmlPdf = path.join(PASTA_SAIDA, `${relatorio.nomeArquivoBase}_PDF.html`);
    fs.writeFileSync(caminhoHtmlEmail, emailHtml);
    fs.writeFileSync(caminhoHtmlPdf, renderWeeklyPdfHtml(relatorio));
  }

  let envio = null;
  if (enviarEmail) {
    const { enviarRelatorioSemanalPorEmail } = require("./email/sendWeeklyReport");
    envio = await enviarRelatorioSemanalPorEmail(relatorio, pdfBuffer, emailHtml);
  }

  // Mesma regra do informativo diário: só sobe pro GED junto do envio real.
  let gedEnvio = null;
  if (enviarEmail && ged.destinoConfigurado()) {
    try {
      gedEnvio = await ged.enviarInformativo(pdfBuffer, `${relatorio.nomeArquivoBase}.pdf`, "Relatorios Semanais");
    } catch (erro) {
      console.error("[CIM] Falha ao gravar relatório semanal no GED:", erro.message);
    }
  }

  return { relatorio, caminhoPdf, caminhoHtmlEmail, caminhoHtmlPdf, envio, ged: gedEnvio };
}

module.exports = { executarPipelineSemanal, gerarPdfSemanalBuffer, PASTA_SAIDA };
