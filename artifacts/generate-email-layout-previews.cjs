const fs = require("node:fs/promises");
const path = require("node:path");
const puppeteer = require("puppeteer");
const { getCidade } = require("../src/config/cities");
const { montarRelatorio } = require("../src/logic/reportBuilder");
const { renderEmailHtml } = require("../src/render/emailTemplate");

const DIRETORIO = path.join(__dirname, "email-layout-3-3-2");
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";

async function inspecionar(page) {
  return page.evaluate(() => {
    const grade = document.querySelector('[data-email-metrics="true"]');
    const linhas = [...grade.querySelectorAll(':scope > tbody > [data-email-metric-row]')];
    const terceira = [...linhas[2].children].map((celula) => {
      const retangulo = celula.getBoundingClientRect();
      return {
        largura: Math.round(retangulo.width * 100) / 100,
        altura: Math.round(retangulo.height * 100) / 100,
        topo: Math.round(retangulo.top * 100) / 100,
        base: Math.round(retangulo.bottom * 100) / 100,
        colspan: celula.colSpan,
        alinhamentoVertical: getComputedStyle(celula).verticalAlign,
      };
    });
    return {
      linhas: linhas.map((linha) => [...linha.children].map((celula) => celula.colSpan)),
      borderCollapse: getComputedStyle(grade).borderCollapse,
      terceira,
      overflowHorizontal: document.documentElement.scrollWidth > innerWidth,
    };
  });
}

(async () => {
  await fs.mkdir(DIRETORIO, { recursive: true });
  const navegador = await puppeteer.launch({
    headless: true,
    pipe: true,
    executablePath: CHROME,
  });

  try {
    for (const horario of ["05:00", "15:00"]) {
      const relatorio = await montarRelatorio(getCidade("rio_de_janeiro"), { horarioAgendado: horario });
      const html = renderEmailHtml(relatorio, { incluirCorRio: false });
      const sufixo = horario.replace(":", "");
      const arquivoHtml = path.join(DIRETORIO, `email-${sufixo}.html`);
      await fs.writeFile(arquivoHtml, html, "utf8");

      const page = await navegador.newPage();
      try {
        for (const largura of [900, 390]) {
          await page.setViewport({ width: largura, height: 900, deviceScaleFactor: 1 });
          await page.setContent(html, { waitUntil: "domcontentloaded" });
          const arquivoPng = path.join(DIRETORIO, `email-${sufixo}-${largura}.png`);
          await page.screenshot({ path: arquivoPng, fullPage: true });
          process.stdout.write(`${horario} ${largura}px ${JSON.stringify(await inspecionar(page))}\n`);
        }
      } finally {
        await page.close();
      }
    }
  } finally {
    await navegador.close();
  }
})().catch((erro) => {
  console.error(erro);
  process.exitCode = 1;
});
