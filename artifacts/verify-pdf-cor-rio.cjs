// Verificação do card "Comunicado oficial COR-Rio" no PDF (node artifacts/verify-pdf-cor-rio.cjs).
// - Gera PDFs dos cinco estágios, comunicado curto/longo, sem comunicado,
//   dados desatualizados, estágio indisponível e uma base fora do Rio, a partir
//   do relatório REAL do Rio (os estados do COR-Rio são simulados e marcados
//   como simulação no texto).
// - Renderiza cada página com pdf.js (Chrome) em PNG e confere texto e links.
// - Percorre o download pelo site (POST /api/gerar-relatorio + GET do link) e a
//   montagem do anexo de e-mail com um transporte em memória: NENHUMA mensagem
//   é enviada.
require('../src/security/certificados');
const nodemailer = require('nodemailer');
const capturados = [];
const criarTransporteOriginal = nodemailer.createTransport;
// streamTransport só monta a mensagem MIME em memória — não conecta a servidor algum.
nodemailer.createTransport = () => {
  const emMemoria = criarTransporteOriginal({ streamTransport: true, buffer: true, newline: 'unix' });
  return { sendMail: async (msg) => { const info = await emMemoria.sendMail(msg); capturados.push({ msg, raw: info.message }); return { ...info, accepted: [].concat(msg.to), rejected: [] }; } };
};

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const puppeteer = require('puppeteer');
process.env.GMAIL_USER = 'verificacao@example.invalid';
process.env.EMAIL_REMETENTE = 'verificacao@example.invalid';
process.env.REPORT_RECIPIENTS = 'destino@example.invalid';
process.env.GMAIL_APP_PASSWORD = 'nao-usada-transporte-em-memoria';
delete process.env.SMTP_HOST;

const { getCidade } = require('../src/config/cities');
const { montarRelatorio } = require('../src/logic/reportBuilder');
const { gerarPdfBuffer, fecharNavegador } = require('../src/render/pdfGenerator');
const { anexarCorRioAoRelatorio, interpretarComunicados, servicoCorRioPadrao } = require('../src/sources/corRio');
const { executarPipeline } = require('../src/pipeline');
const { criarApp } = require('../server.js');

const SAIDA = path.join(__dirname, 'pdf-cor-rio');
const ok = (rotulo, cond) => { console.log(`${cond ? 'OK  ' : 'FALHA'} ${rotulo}`); if (!cond) process.exitCode = 1; };

function estadoSimulado({ nivel, estagioStatus = 'operacional', comStatus = 'operacional', itens = 'curto' }) {
  const agora = Date.now();
  const post = (id, titulo, paragrafos, horasAtras) => ({
    id, date_gmt: new Date(agora - horasAtras * 3600e3).toISOString().slice(0, 19),
    modified_gmt: new Date(agora - horasAtras * 3600e3 + 1800e3).toISOString().slice(0, 19),
    link: `https://cor.rio/simulacao-${id}/`, title: { rendered: titulo },
    excerpt: { rendered: '<p>Resumo simulado.</p>' },
    content: { rendered: paragrafos },
  });
  const curto = post(1, '[SIMULAÇÃO] Comunicado curto de verificação — não é dado real do COR-Rio',
    '<p>Texto simulado para verificar o layout do card no PDF. Não foi publicado pelo COR-Rio.</p><p><strong>ORIENTAÇÕES (SIMULADAS)</strong></p><ul><li>Orientação simulada 1.</li><li>Orientação simulada 2.</li></ul>', 2);
  const longo = post(2, '[SIMULAÇÃO] Comunicado longo de verificação — não é dado real do COR-Rio',
    Array.from({ length: 70 }, (_, i) => i % 9 === 0 ? `<p><strong>SEÇÃO SIMULADA ${i / 9 + 1}</strong></p>` : `<p>${i}. Parágrafo simulado de verificação de quebra de página, com texto suficientemente longo para ocupar mais de uma linha no card e testar a continuação identificada entre páginas do informativo.</p>`).join('') +
    `<p>${'Linha de ocorrência simulada (bairro de teste).<br />'.repeat(40)}</p>`, 1);
  const antigo = post(3, '[SIMULAÇÃO] Outro comunicado vigente — não é dado real', '<p>Simulado.</p>', 20);
  const lista = itens === 'nenhum' ? [] : interpretarComunicados(itens === 'longo' ? [longo, antigo] : [curto, antigo]);
  return {
    fonte: 'COR-Rio — Centro de Operações e Resiliência (Prefeitura do Rio)', abrangencia: 'Município do Rio de Janeiro', urlPublica: 'https://cor.rio/',
    estagio: {
      status: estagioStatus,
      dados: nivel ? { nivel, rotulo: `Estágio ${nivel}`, vigenteDesde: new Date(agora - 1.5 * 3600e3).toISOString(), mensagens: [], urlPublica: 'https://cor.rio/estagios-operacionais-da-cidade/' } : null,
      consultadoEm: nivel ? new Date(agora - (estagioStatus === 'desatualizado' ? 26 * 3600e3 : 300e3)).toISOString() : null,
      falha: estagioStatus === 'operacional' ? null : 'a fonte não respondeu a tempo',
    },
    comunicados: {
      status: comStatus, janelaHoras: 24,
      consultadoEm: comStatus === 'indisponivel' ? null : new Date(agora - (comStatus === 'desatualizado' ? 26 * 3600e3 : 300e3)).toISOString(),
      falha: comStatus === 'operacional' ? null : 'falha de conexão com a fonte',
      itens: comStatus === 'indisponivel' ? [] : lista,
    },
  };
}

async function analisarPdf(browser, arquivo, prefixoPng, { paginasPng = 'cor' } = {}) {
  const page = await browser.newPage();
  await page.goto('about:blank');
  await page.addScriptTag({ url: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js' });
  const base64 = fs.readFileSync(arquivo).toString('base64');
  const paginas = await page.evaluate(async (b64) => {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    const doc = await pdfjsLib.getDocument({ data: Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)) }).promise;
    const out = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const p = await doc.getPage(n);
      const texto = (await p.getTextContent()).items.map((i) => i.str).join(' ');
      const links = (await p.getAnnotations()).filter((a) => a.subtype === 'Link' && a.url).map((a) => a.url);
      out.push({ n, texto, links });
    }
    window.__doc = doc;
    return out;
  }, base64);
  for (const pg of paginas) {
    if (paginasPng === 'cor' && !/COR-Rio/.test(pg.texto)) continue;
    const dataUrl = await page.evaluate(async (n) => {
      const p = await window.__doc.getPage(n);
      const vp = p.getViewport({ scale: 1.4 });
      const c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height;
      await p.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
      return c.toDataURL('image/png');
    }, pg.n);
    fs.writeFileSync(`${prefixoPng}-p${pg.n}.png`, Buffer.from(dataUrl.split(',')[1], 'base64'));
  }
  await page.close();
  return paginas;
}

(async () => {
  fs.mkdirSync(SAIDA, { recursive: true });
  const rio = getCidade('rio_de_janeiro');
  console.log('Coletando o relatório real do Rio de Janeiro…');
  const base = await montarRelatorio(rio, {});
  const browser = await puppeteer.launch({ headless: true, pipe: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });

  const cenarios = [
    ...[1, 2, 3, 4, 5].map((n) => [`estagio-${n}`, estadoSimulado({ nivel: n })]),
    ['comunicado-longo', estadoSimulado({ nivel: 3, itens: 'longo' })],
    ['sem-comunicado', estadoSimulado({ nivel: 2, itens: 'nenhum' })],
    ['desatualizado', estadoSimulado({ nivel: 4, estagioStatus: 'desatualizado', comStatus: 'desatualizado' })],
    ['indisponivel', estadoSimulado({ nivel: null, estagioStatus: 'indisponivel', comStatus: 'indisponivel' })],
  ];
  const CORES = { 1: '#22C55E', 2: '#FACC15', 3: '#F97316', 4: '#EF4444', 5: '#A855F7' };
  for (const [nome, estado] of cenarios) {
    const report = structuredClone(base);
    await anexarCorRioAoRelatorio(report, rio, { servico: { obter: async () => estado } });
    const html = require('../src/render/pdfTemplate').renderPdfHtml(report);
    const arquivo = path.join(SAIDA, `${nome}.pdf`);
    fs.writeFileSync(arquivo, await gerarPdfBuffer(report));
    const paginas = await analisarPdf(browser, arquivo, path.join(SAIDA, nome));
    const texto = paginas.map((p) => p.texto).join(' ');
    const links = paginas.flatMap((p) => p.links);
    const nivel = estado.estagio.dados?.nivel;
    const posCor = html.indexOf('Comunicado oficial COR-Rio');
    const posInmet = html.indexOf('Aviso oficial INMET');
    ok(`${nome}: card antes dos avisos INMET${posInmet < 0 ? ' (sem aviso INMET vigente nesta coleta)' : ''}`, posCor > 0 && (posInmet < 0 || posCor < posInmet));
    if (nivel) {
      ok(`${nome}: selo ESTÁGIO ${nivel} com ${CORES[nivel]} e texto #0B1A12; borda/faixa na mesma cor`, html.includes(`background:${CORES[nivel]};color:#0B1A12;">ESTÁGIO ${nivel}<`) && html.includes(`border-color:${CORES[nivel]};`) && /ESTÁGIO\s*\d/.test(texto));
    } else {
      ok(`${nome}: "Estágio indisponível" neutro, sem estágio presumido`, /Estágio indisponível/.test(texto) && !/ESTÁGIO [1-5]\b/.test(texto) && html.includes('cor-selo-neutro'));
    }
    if (nome === 'sem-comunicado') ok(`${nome}: "Nenhum comunicado vigente disponibilizado pela fonte"`, /Nenhum comunicado vigente disponibilizado pela fonte/.test(texto));
    if (nome === 'desatualizado') ok(`${nome}: "Dados desatualizados" + última consulta bem-sucedida`, /Dados desatualizados/.test(texto) && /Última consulta bem-sucedida/.test(texto));
    if (nome === 'indisponivel') ok(`${nome}: falha dos comunicados distinta de "nenhum"`, /Não foi possível consultar os comunicados/.test(texto) && !/Nenhum comunicado vigente/.test(texto));
    if (estado.comunicados.itens.length) ok(`${nome}: link clicável para a publicação (${links.filter((l) => /cor\.rio\/simulacao/.test(l))[0]})`, links.some((l) => /^https:\/\/cor\.rio\/simulacao-\d\/$/.test(l)));
    if (nome === 'comunicado-longo') {
      const partes = (texto.match(/continuação \(parte \d+ de \d+\)/g) || []);
      const total = Number((texto.match(/parte \d+ de (\d+)/) || [])[1]);
      ok(`${nome}: dividido em ${total} partes identificadas, nenhum parágrafo omitido`, total > 1 && partes.length === total - 1 && /68\. Parágrafo simulado/.test(texto) && (texto.match(/Linha de ocorrência simulada/g) || []).length === 40);
    }
    if (nivel || estado.comunicados.consultadoEm) ok(`${nome}: datas DD/MM/AAAA e horário de Brasília`, /\d{2}\/\d{2}\/\d{4} \d{2}:\d{2} \(Brasília\)/.test(texto));
    ok(`${nome}: Fontes Consultadas descreve o COR-Rio`, /COR-Rio — estágio operacional/.test(texto));
    ok(`${nome}: numeração de páginas ${paginas.length}/${paginas.length}`, texto.includes(`${paginas.length}/${paginas.length}`));
    console.log(`     ${paginas.length} páginas; PNG das páginas do card em artifacts/pdf-cor-rio/${nome}-p*.png`);
  }

  // Base fora do Rio: sem card e sem COR-Rio nas fontes.
  const macae = getCidade('macae');
  const relMacae = await montarRelatorio(macae, {});
  const anexado = await anexarCorRioAoRelatorio(relMacae, macae, { servico: { obter: async () => { throw new Error('não deveria consultar'); } } });
  const arqMacae = path.join(SAIDA, 'macae.pdf');
  fs.writeFileSync(arqMacae, await gerarPdfBuffer(relMacae));
  const txtMacae = (await analisarPdf(browser, arqMacae, path.join(SAIDA, 'macae'), { paginasPng: 'nenhuma' })).map((p) => p.texto).join(' ');
  ok('Macaé: sem card do COR-Rio e sem consulta', anexado === null && !/COR-Rio/.test(txtMacae));

  // Download pelo site + anexo de e-mail (pipeline real, transporte em memória).
  const app = criarApp({ senhaPainel: 'verificacao-pdf-123456', executarPipelineRelatorio: (o) => executarPipeline(o) });
  const servidor = http.createServer(app);
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${servidor.address().port}`;
  const estadoSite = await (await fetch(`${url}/api/cor-rio?cidade=rio_de_janeiro`)).json();
  const resp = await (await fetch(`${url}/api/gerar-relatorio`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ senha: 'verificacao-pdf-123456', cidade: 'rio_de_janeiro' }) })).json();
  ok(`site: geração concluída (${resp.message || resp.erro})`, resp.ok === true && resp.urlArquivo);
  if (resp.ok) {
    const pdfSite = Buffer.from(await (await fetch(url + resp.urlArquivo)).arrayBuffer());
    fs.writeFileSync(path.join(SAIDA, 'real-download-site.pdf'), pdfSite);
    const pgs = await analisarPdf(browser, path.join(SAIDA, 'real-download-site.pdf'), path.join(SAIDA, 'real-download-site'));
    const txt = pgs.map((p) => p.texto).join(' ');
    const nivelSite = estadoSite.estagio?.dados?.nivel;
    ok(`download: card com o mesmo estágio do painel (${nivelSite ? `ESTÁGIO ${nivelSite}` : 'indisponível'})`, nivelSite ? txt.includes(`ESTÁGIO ${nivelSite}`) : /Estágio indisponível/.test(txt));
    const principal = estadoSite.comunicados?.itens?.[0];
    if (principal) ok(`download: mesmo comunicado do painel ("${principal.titulo.slice(0, 50)}…") com link ${principal.link}`, txt.replace(/\s+/g, ' ').includes(principal.titulo.slice(0, 40)) && pgs.some((p) => p.links.includes(principal.link)));
    const email = capturados.at(-1);
    const anexo = email?.msg.attachments.find((a) => a.contentType === 'application/pdf');
    // a mensagem MIME montada em memória precisa conter o PDF codificado como anexo
    const mime = Buffer.isBuffer(email?.raw) ? email.raw.toString('utf8') : String(email?.raw || '');
    fs.writeFileSync(path.join(SAIDA, 'email-cabecalhos.txt'), mime.split(/\r?\n/).filter((l) => !/^[A-Za-z0-9+/=]{40,}$/.test(l)).join('\n'));
    const anexoNoMime =mime.includes(`filename=${anexo?.filename}`) || mime.includes(`filename="${anexo?.filename}"`);
    console.log(`     MIME em memória: ${mime.length} bytes; destinatários na mensagem montada: ${[].concat(email?.msg.to).length} (nada enviado)`);
    ok(`e-mail: mensagem montada sem envio real, anexo ${anexo?.filename}`, Boolean(anexo) && anexo.content instanceof Uint8Array && anexoNoMime && mime.includes('Content-Type: application/pdf'));
    // Anexo do e-mail: versão só com o comunicado do dia (o download segue completo).
    const arqAnexo = path.join(SAIDA, 'real-anexo-email.pdf');
    fs.writeFileSync(arqAnexo, Buffer.from(anexo.content));
    const pgsAnexo = await analisarPdf(browser, arqAnexo, path.join(SAIDA, 'real-anexo-email'));
    const txtAnexo = pgsAnexo.map((p) => p.texto).join(' ').replace(/\s+/g, ' ');
    const { comunicadoDoDia } = require('../src/render/corRioEmail');
    const doDia = comunicadoDoDia(estadoSite.comunicados?.itens, { geradoEm: Date.now() });
    console.log(`     comunicado do dia no anexo: ${doDia ? `"${doDia.titulo}"` : 'nenhum'}`);
    ok('anexo: sem "PREVISÃO PARA OS PRÓXIMOS DIAS" e sem "Outros comunicados vigentes"', !/PRÓXIMOS DIAS|Outros comunicados vigentes/.test(txtAnexo));
    ok('anexo: comunicado do dia (ou mensagem de ausência) com o mesmo estágio do painel', (doDia ? txtAnexo.includes(doDia.titulo.slice(0, 40)) && pgsAnexo.some((p) => p.links.includes(doDia.link)) : /Nenhum comunicado do dia disponível até o horário da consulta/.test(txtAnexo)) && txtAnexo.includes(`ESTÁGIO ${estadoSite.estagio?.dados?.nivel}`));
    const txtSite = pgs.map((p) => p.texto).join(' ');
    ok('download pelo site segue completo (outros comunicados presentes quando existem)', (estadoSite.comunicados?.itens?.length || 0) < 2 || /Outros comunicados vigentes/.test(txtSite));
    ok(`anexo: numeração ${pgsAnexo.length}/${pgsAnexo.length}`, txtAnexo.includes(`${pgsAnexo.length}/${pgsAnexo.length}`));
  }
  servidor.closeAllConnections?.(); servidor.close();
  await browser.close();
  await fecharNavegador();
  void servicoCorRioPadrao;
  process.exit();
})().catch((e) => { console.error(e); process.exit(1); });
