// Prévia do card "Comunicado oficial COR-Rio" no CORPO DO E-MAIL
// (node artifacts/verify-email-cor-rio.cjs). Nenhum e-mail é enviado: o
// transporte do nodemailer é trocado por um que só monta a mensagem em memória.
// Cenários: dados reais do COR-Rio; várias publicações no mesmo dia
// (simuladas); nenhuma publicação do dia (simulada). As logos "cid:" viram
// data URI só na prévia, para a imagem ficar igual ao que o cliente mostra.
require('../src/security/certificados');
const nodemailer = require('nodemailer');
const criarOriginal = nodemailer.createTransport;
const capturados = [];
nodemailer.createTransport = () => {
  const memoria = criarOriginal({ streamTransport: true, buffer: true, newline: 'unix' });
  return { sendMail: async (msg) => { const info = await memoria.sendMail(msg); capturados.push(msg); return { ...info, accepted: [].concat(msg.to), rejected: [] }; } };
};
process.env.GMAIL_USER = process.env.EMAIL_REMETENTE = 'verificacao@example.invalid';
process.env.GMAIL_APP_PASSWORD = 'nao-usada-transporte-em-memoria';
process.env.REPORT_RECIPIENTS = 'destino@example.invalid';
delete process.env.SMTP_HOST;

const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer');
const { getCidade } = require('../src/config/cities');
const { montarRelatorio } = require('../src/logic/reportBuilder');
const { anexarCorRioAoRelatorio, interpretarComunicados } = require('../src/sources/corRio');
const { renderEmailHtml } = require('../src/render/emailTemplate');
const { renderPdfHtml } = require('../src/render/pdfTemplate');
const { comunicadoDoDia } = require('../src/render/corRioEmail');
const { enviarRelatorioPorEmail } = require('../src/email/sendReport');
const { gerarPdfBuffer, fecharNavegador } = require('../src/render/pdfGenerator');
const { LOGOS_HEADER, logoHeaderDataUri } = require('../src/config/headerAssets');

const SAIDA = path.join(__dirname, 'email-cor-rio');
const ok = (rotulo, cond) => { console.log(`${cond ? 'OK  ' : 'FALHA'} ${rotulo}`); if (!cond) process.exitCode = 1; };
const comLogos = (html) => Object.entries(LOGOS_HEADER).reduce((h, [nome, l]) => h.split(`cid:${l.cid}`).join(logoHeaderDataUri(nome) || ''), html);

(async () => {
  fs.mkdirSync(SAIDA, { recursive: true });
  const rio = getCidade('rio_de_janeiro');
  console.log('Coletando o relatório real do Rio de Janeiro…');
  const base = await montarRelatorio(rio, {});
  await anexarCorRioAoRelatorio(base, rio);
  const hoje = new Date(base.geradoEmISO);
  const dataBr = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: 'numeric', month: 'numeric' }).format(hoje);
  const isoLocal = (horasAtras) => new Date(hoje.getTime() - horasAtras * 3600e3).toISOString().slice(0, 19);
  const amanha = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: 'numeric', month: 'numeric' }).format(new Date(hoje.getTime() + 86400e3));
  const post = (id, horasAtras, titulo) => ({
    id, date_gmt: isoLocal(horasAtras), modified_gmt: isoLocal(horasAtras), link: `https://cor.rio/simulacao-${id}/`, categories: [46, 29],
    title: { rendered: titulo }, excerpt: { rendered: '' },
    content: { rendered: `<p>[SIMULAÇÃO] Condições previstas para hoje (${dataBr}) — texto de verificação, não publicado pelo COR-Rio.</p><p><strong>ORIENTAÇÕES (SIMULADAS)</strong></p><ul><li>Orientação simulada.</li></ul><p><strong>PREVISÃO PARA OS PRÓXIMOS DIAS:</strong></p><p>Amanhã (${amanha}), texto simulado do dia seguinte.</p>` },
  });

  const cenarios = {
    'real': base.corRio,
    'varias-publicacoes': { ...base.corRio, comunicados: { ...base.corRio.comunicados, status: 'operacional', consultadoEm: base.geradoEmISO, itens: interpretarComunicados([
      post(1, 0.2, `[SIMULAÇÃO] Atualização das ${new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }).format(new Date(hoje.getTime() - 0.2 * 3600e3))} (${dataBr})`),
      post(2, 1.5, `[SIMULAÇÃO] Publicação anterior de hoje (${dataBr})`),
      post(3, -1, `[SIMULAÇÃO] Publicada depois da geração (${dataBr})`),
    ]) } },
    'sem-publicacao-do-dia': { ...base.corRio, comunicados: { ...base.corRio.comunicados, status: 'operacional', consultadoEm: base.geradoEmISO, itens: interpretarComunicados([
      post(4, 30, '[SIMULAÇÃO] Comunicado de ontem'),
    ]) } },
  };

  const browser = await puppeteer.launch({ headless: true, pipe: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  for (const [nome, corRio] of Object.entries(cenarios)) {
    const report = { ...base, corRio };
    const html = renderEmailHtml(report);
    fs.writeFileSync(path.join(SAIDA, `${nome}.html`), comLogos(html));
    const page = await browser.newPage();
    await page.setJavaScriptEnabled(false);
    for (const [largura, sufixo] of [[900, 'desktop'], [390, 'celular']]) {
      await page.setViewport({ width: largura, height: 900 });
      await page.setContent(comLogos(html), { waitUntil: 'load' });
      const card = await page.evaluateHandle(() => [...document.querySelectorAll('table')].reverse().find((t) => /^\s*Comunicado oficial COR-Rio/.test(t.innerText) && /border-left:\s*7px/.test(t.getAttribute('style') || '')));
      const texto = await card.evaluate((t) => t.innerText);
      // Mede só o card: o cabeçalho institucional do e-mail já excede 390 px
      // por conta própria (problema anterior, fora do escopo desta seção).
      const rolagem = await card.evaluate((t) => {
        const limite = t.getBoundingClientRect().right + 1;
        return t.scrollWidth > t.clientWidth + 1 || [...t.querySelectorAll('*')].some((el) => el.getBoundingClientRect().right > limite);
      });
      await card.screenshot({ path: path.join(SAIDA, `${nome}-${sufixo}.png`) });
      if (sufixo === 'celular') ok(`${nome}: celular — card sem texto cortado nem transbordando`, !rolagem);
      if (sufixo !== 'desktop') continue;
      const escolhido = comunicadoDoDia(corRio.comunicados.itens, { geradoEm: base.geradoEmISO });
      ok(`${nome}: sem "próximos dias" nem "outros comunicados"`, !/PRÓXIMOS DIAS|Outros comunicados/i.test(texto));
      if (nome === 'real') {
        console.log(`     comunicado do dia escolhido: ${escolhido ? `"${escolhido.titulo}"` : 'nenhum'}`);
        ok('real: card coerente com a seleção', escolhido ? texto.includes(escolhido.titulo) && /Consultar publicação oficial/.test(texto) : /Nenhum comunicado do dia disponível até o horário da consulta/.test(texto));
        const pdf = renderPdfHtml(report);
        ok('real: PDF do mesmo relatório mantém o comunicado completo e os demais', !escolhido || (/Outros comunicados vigentes|Nenhum comunicado vigente/.test(pdf) && pdf.includes('Comunicado oficial COR-Rio')));
      }
      if (nome === 'varias-publicacoes') ok('várias publicações: mostra a mais recente até a geração', /Atualização das/.test(texto) && !/Publicação anterior|depois da geração/.test(texto) && /Orientação simulada/.test(texto) && !/dia seguinte/.test(texto));
      if (nome === 'sem-publicacao-do-dia') ok('sem publicação do dia: mensagem própria, sem publicação anterior, estágio mantido', /Nenhum comunicado do dia disponível até o horário da consulta/.test(texto) && !/Comunicado de ontem/.test(texto) && (/ESTÁGIO \d/.test(texto) || /ESTÁGIO INDISPONÍVEL/.test(texto)));
    }
    // PDF anexado ao e-mail neste cenário (versão só com o comunicado do dia)
    fs.writeFileSync(path.join(SAIDA, `${nome}-anexo.pdf`), await gerarPdfBuffer(report, { corRioSomenteDoDia: true }));
    await page.setViewport({ width: 794, height: 1123 });
    await page.emulateMediaType('print');
    await page.setContent(renderPdfHtml(report, { corRioSomenteDoDia: true }), { waitUntil: 'load' });
    const cardPdf = await page.$('.cor-card');
    const textoPdf = await cardPdf.evaluate((el) => el.innerText);
    await cardPdf.screenshot({ path: path.join(SAIDA, `${nome}-anexo-card.png`) });
    const semExtras = !/PRÓXIMOS DIAS/.test(textoPdf) && !(await page.$('.cor-outros'));
    if (nome === 'varias-publicacoes') ok('anexo PDF, várias publicações: a mais recente até a geração', semExtras && /Atualização das/.test(textoPdf) && !/Publicação anterior|depois da geração/.test(textoPdf));
    else if (nome === 'sem-publicacao-do-dia') ok('anexo PDF, sem publicação do dia: mensagem própria e estágio mantido', semExtras && /Nenhum comunicado do dia disponível até o horário da consulta/.test(textoPdf) && !/Comunicado de ontem/.test(textoPdf) && /ESTÁGIO/.test(textoPdf));
    else ok('anexo PDF, dados reais: sem próximos dias nem outros comunicados', semExtras);
    await page.emulateMediaType('screen');
    await page.close();
  }
  await browser.close();
  await fecharNavegador();

  // Caminho real de envio, com transporte em memória (nada é enviado).
  await enviarRelatorioPorEmail({ ...base, nomeArquivoBase: 'verificacao' }, Buffer.from('%PDF-1.4 verificacao'));
  const msg = capturados.at(-1);
  ok('envio (em memória): HTML da mensagem montada contém o card do COR-Rio', /Comunicado oficial COR-Rio/.test(msg?.html || '') && !/Outros comunicados vigentes/.test(msg.html));
  process.exit();
})().catch((e) => { console.error(e); process.exit(1); });
