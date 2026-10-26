// Valida painel, PDF e prévia de e-mail do mesmo relatório, sem envio.
// Execute com: node --use-system-ca scripts/validarCicloReal.js [chave-da-base]
require("dotenv").config({ quiet: true });
const fs = require("node:fs");
const path = require("node:path");
const { getCidade } = require("../src/config/cities");
const { montarRelatorio } = require("../src/logic/reportBuilder");
const { comConteudoEmail } = require("../src/logic/conteudoEmailPainel");
const { renderEmailHtml } = require("../src/render/emailTemplate");
const { gerarPdfBuffer, fecharNavegador } = require("../src/render/pdfGenerator");
const { renderPdfHtml } = require("../src/render/pdfTemplate");
const { conferirSaidasPeriodo } = require("./conferirSaidasPeriodo");
const { criarApp } = require("../server");
const puppeteer = require("puppeteer");

async function main() {
  const cidade = getCidade(process.argv[2] || "rio_de_janeiro");
  const pasta = path.join(__dirname, "..", "tmp", "validacao-ciclo-real");
  fs.mkdirSync(pasta, { recursive: true });
  const report = comConteudoEmail(await montarRelatorio(cidade, { atualizarClimaSaude: true }));
  const emailHtml = renderEmailHtml(report);
  const pdf = await gerarPdfBuffer(report);
  const app = criarApp({ senhaPainel: "validacao-local-sem-envio-2026", cidadeAtiva: cidade.chave,
    atualizadorDados: { obter: async () => ({ report, pendente: false }), registrar() {} } });
  const servidor = await new Promise((resolve) => {
    const instancia = app.listen(0, "127.0.0.1", () => resolve(instancia));
  });
  let browser;
  try {
    const porta = servidor.address().port;
    const resposta = await fetch(`http://127.0.0.1:${porta}/api/preview?cidade=${cidade.chave}`);
    const preview = await resposta.json();
    if (resposta.status !== 200 || preview.report?.snapshotId !== report.snapshotId) {
      throw new Error("O painel não recebeu o mesmo snapshot usado pelo PDF e e-mail.");
    }
    const navegadorLocal = [process.env.PUPPETEER_EXECUTABLE_PATH,
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"].find((arquivo) => arquivo && fs.existsSync(arquivo));
    browser = await puppeteer.launch({ headless: true,
      ...(navegadorLocal ? { executablePath: navegadorLocal } : {}) });
    const pagina = await browser.newPage();
    await pagina.setViewport({ width: 1440, height: 1000 });
    await pagina.goto(`http://127.0.0.1:${porta}/?cidade=${cidade.chave}`, { waitUntil: "networkidle0" });
    const painel = await pagina.locator("#titulo-indicadores").map((el) => el.textContent).wait();
    if (!painel) throw new Error("Cards meteorológicos não foram abertos no navegador.");
    const conferenciaSaidas = conferirSaidasPeriodo(report, {
      painelHtml: await pagina.content(), pdfHtml: renderPdfHtml(report), emailHtml,
    });
    const imagem = path.join(pasta, `${cidade.chave}-painel.png`);
    await pagina.screenshot({ path: imagem, fullPage: true });
    fs.writeFileSync(path.join(pasta, `${cidade.chave}-informativo.pdf`), pdf);
    fs.writeFileSync(path.join(pasta, `${cidade.chave}-email.html`), emailHtml, "utf8");
    const resumo = {
      ciclo: report.snapshotId, localidade: cidade.nome, geradoEm: report.geradoEmISO,
      painel: { http: resposta.status, snapshotId: preview.report.snapshotId, captura: imagem },
      pdf: { bytes: pdf.length, arquivo: path.join(pasta, `${cidade.chave}-informativo.pdf`) },
      email: { bytes: Buffer.byteLength(emailHtml), arquivo: path.join(pasta, `${cidade.chave}-email.html`) },
      indicadores: report.indicadoresSnapshot,
      ventoPorPeriodo: report.ventoPorPeriodo,
      chuvaPorPeriodo: report.chuvaPorPeriodo,
      conferenciaSaidas,
    };
    fs.writeFileSync(path.join(pasta, `${cidade.chave}-evidencia.json`), JSON.stringify(resumo, null, 2), "utf8");
    process.stdout.write(`${cidade.nome}: ciclo ${report.snapshotId}; painel HTTP ${resposta.status}; PDF ${pdf.length} bytes; e-mail ${resumo.email.bytes} bytes\n`);
  } finally {
    await browser?.close();
    await new Promise((resolve) => servidor.close(resolve));
    await fecharNavegador();
  }
}

main().catch((erro) => { console.error(erro); process.exitCode = 1; });
