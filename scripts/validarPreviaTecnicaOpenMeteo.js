// Prévia técnica local com respostas públicas reais. Nunca envia e-mail,
// atualiza cache operacional ou habilita a API gratuita no servidor CIM.
require("dotenv").config({ quiet: true });
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const puppeteer = require("puppeteer");
const { getCidade } = require("../src/config/cities");
const { buscarJsonComRetentativa } = require("../src/sources/httpJsonClient");
const { criarUrlPublicaOpenMeteo, normalizarRespostaOpenMeteo } = require("../src/sources/openMeteo");
const { criarUrlPublicaQualidadeAr, validarAtual } = require("../src/sources/airQuality");
const { montarRelatorio } = require("../src/logic/reportBuilder");
const { comConteudoEmail } = require("../src/logic/conteudoEmailPainel");
const { renderEmailHtml } = require("../src/render/emailTemplate");
const { gerarPdfBuffer, fecharNavegador } = require("../src/render/pdfGenerator");
const { renderPdfHtml } = require("../src/render/pdfTemplate");
const { conferirSaidasPeriodo } = require("./conferirSaidasPeriodo");
const { criarApp } = require("../server");

async function consultar(url, nomeFonte) {
  let http = null;
  const json = await buscarJsonComRetentativa(url, {
    nomeFonte, timeoutMs: 15000, tentativas: 2,
    fetchImpl: async (input, init) => {
      const resposta = await fetch(input, init);
      http = resposta.status;
      return resposta;
    },
  });
  return { json, http, endpoint: new URL(url).origin + new URL(url).pathname };
}

async function main() {
  if (process.env.NODE_ENV === "production" || os.hostname().split(".")[0].toUpperCase() === "NPAB2542") {
    throw new Error("A prévia com API pública não pode ser executada em produção.");
  }
  const cidade = getCidade(process.argv[2] || "rio_de_janeiro");
  const agora = new Date();
  const tempoUrl = criarUrlPublicaOpenMeteo(cidade.latitude, cidade.longitude,
    { diasPrevisao: 4, fuso: "auto" });
  const arUrl = new URL(criarUrlPublicaQualidadeAr(cidade));
  const [tempoResposta, arResposta] = await Promise.all([
    consultar(tempoUrl, "Open-Meteo Weather público — prévia técnica"),
    consultar(arUrl.toString(), "Open-Meteo Air Quality público — prévia técnica"),
  ]);
  const tempo = normalizarRespostaOpenMeteo(tempoResposta.json, cidade.latitude,
    cidade.longitude, { now: agora, fuso: tempoResposta.json.timezone, url: tempoUrl });
  const ar = validarAtual(arResposta.json, { now: agora, cidade });
  const report = comConteudoEmail(await montarRelatorio(cidade, {
    atualizarClimaSaude: true,
    dependencias: {
      agora: () => agora,
      buscarOpenMeteo: async () => tempo,
      buscarQualidadeAr: async () => ar,
    },
  }));
  for (const indicador of Object.values(report.indicadoresSnapshot || {})) {
    if (indicador?.fonte?.includes("Open-Meteo") && indicador.statusValidacao === "operacional") {
      indicador.statusValidacao = "teste_tecnico";
    }
  }
  report.avisosColeta.unshift("PRÉVIA TÉCNICA LOCAL: dados públicos da Open-Meteo; proibido usar como relatório operacional ou enviar.");

  const pasta = path.join(__dirname, "..", "tmp", "previa-tecnica-open-meteo");
  fs.mkdirSync(pasta, { recursive: true });
  const prefixo = path.join(pasta, cidade.chave);
  const emailHtml = renderEmailHtml(report).replace(/(<body[^>]*>)/i,
    '$1<table role="presentation" width="100%" bgcolor="#9b1c1c"><tr><td style="color:#ffffff;font:bold 16px Arial,sans-serif;text-align:center;padding:10px">PRÉVIA TÉCNICA LOCAL — Open-Meteo pública; não enviar como relatório operacional</td></tr></table>');
  const pdf = await gerarPdfBuffer(report);
  const app = criarApp({ senhaPainel: "previa-tecnica-local-sem-envio", cidadeAtiva: cidade.chave,
    atualizadorDados: { obter: async () => ({ report, pendente: false }), registrar() {} } });
  const servidor = await new Promise((resolve) => {
    const instancia = app.listen(0, "127.0.0.1", () => resolve(instancia));
  });
  let browser;
  try {
    const endereco = `http://127.0.0.1:${servidor.address().port}`;
    const resposta = await fetch(`${endereco}/api/preview?cidade=${cidade.chave}`);
    const preview = await resposta.json();
    if (resposta.status !== 200 || preview.report?.snapshotId !== report.snapshotId) {
      throw new Error("O painel não recebeu o snapshot usado pelo PDF e e-mail.");
    }
    const navegadorLocal = [process.env.PUPPETEER_EXECUTABLE_PATH,
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"]
      .find((arquivo) => arquivo && fs.existsSync(arquivo));
    browser = await puppeteer.launch({ headless: true,
      ...(navegadorLocal ? { executablePath: navegadorLocal } : {}) });
    const pagina = await browser.newPage();
    await pagina.setViewport({ width: 1440, height: 1000 });
    await pagina.goto(`${endereco}/?cidade=${cidade.chave}`, { waitUntil: "networkidle0" });
    await pagina.locator("#titulo-indicadores").map((el) => el.textContent).wait();
    const conferenciaSaidas = conferirSaidasPeriodo(report, {
      painelHtml: await pagina.content(), pdfHtml: renderPdfHtml(report), emailHtml,
    });
    await pagina.evaluate(() => {
      const aviso = document.createElement("div");
      aviso.textContent = "PRÉVIA TÉCNICA LOCAL — Open-Meteo pública; não é o painel operacional";
      aviso.style.cssText = "position:fixed;top:0;left:0;right:0;z-index:2147483647;background:#9b1c1c;color:white;padding:8px;text-align:center;font:bold 16px Arial";
      document.body.appendChild(aviso);
    });
    await pagina.screenshot({ path: `${prefixo}-painel-PREVIA-TECNICA.png`, fullPage: true });
    fs.writeFileSync(`${prefixo}-informativo-PREVIA-TECNICA.pdf`, pdf);
    fs.writeFileSync(`${prefixo}-email-PREVIA-TECNICA.html`, emailHtml, "utf8");
    const evidencia = {
      finalidade: "prévia técnica local, sem licença comercial e sem envio",
      ciclo: report.snapshotId, localidade: cidade.nome, consultadoEm: agora.toISOString(),
      consultas: {
        tempo: { endpoint: tempoResposta.endpoint, http: tempoResposta.http,
          referenciaModelo: tempo.atual?.horario, fuso: tempo.fuso },
        ar: { endpoint: arResposta.endpoint, http: arResposta.http,
          referenciaModelo: ar.referenciaEm },
      },
      snapshotIdPainel: preview.report.snapshotId,
      pdfBytes: pdf.length, emailBytes: Buffer.byteLength(emailHtml),
      indicadores: report.indicadoresSnapshot,
      ventoPorPeriodo: report.ventoPorPeriodo,
      chuvaPorPeriodo: report.chuvaPorPeriodo,
      conferenciaSaidas,
    };
    fs.writeFileSync(`${prefixo}-evidencia.json`, JSON.stringify(evidencia, null, 2));
    process.stdout.write(`${cidade.nome}: prévia ${report.snapshotId}; HTTP ${resposta.status}; PDF ${pdf.length} bytes; e-mail ${evidencia.emailBytes} bytes\n`);
  } finally {
    await browser?.close();
    await new Promise((resolve) => servidor.close(resolve));
    await fecharNavegador();
  }
}

main().catch((erro) => { console.error(erro); process.exitCode = 1; });
