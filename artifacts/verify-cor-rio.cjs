// Verificação visual do painel "Comunicados COR-Rio" (node artifacts/verify-cor-rio.cjs).
// Sobe só o criarApp() (sem agendamentos/e-mails), carrega a base Rio com
// dados reais e depois simula, via interceptação de /api/cor-rio, os cinco
// estágios, a troca automática de estágio e os estados de falha.
require('../src/security/certificados');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer');
const { criarApp } = require('../server.js');

const SAIDA = path.join(__dirname, 'painel-cor-rio');
const CORES = { 1: 'rgb(34, 197, 94)', 2: 'rgb(250, 204, 21)', 3: 'rgb(249, 115, 22)', 4: 'rgb(239, 68, 68)', 5: 'rgb(168, 85, 247)' };

function respostaSimulada({ nivel, estagioStatus = 'operacional', comStatus = 'operacional', itens = 3 } = {}) {
  const agora = Date.now();
  const lista = Array.from({ length: itens }, (_, i) => ({
    id: String(900 + i),
    titulo: `[SIMULAÇÃO] Comunicado de teste ${i + 1} — não é dado real do COR-Rio`,
    resumo: 'Texto simulado para validar o layout do painel. Este conteúdo não foi publicado pelo COR-Rio e serve apenas para a verificação visual automatizada de cores, quebras de linha e estados.',
    paragrafos: [{ texto: 'SIMULAÇÃO', destaque: true }, { texto: 'Parágrafo simulado 1.\nSegunda linha.' }, { texto: 'Item simulado', item: true }],
    publicadoEm: new Date(agora - (i + 1) * 3600e3).toISOString(),
    atualizadoEm: i === 0 ? new Date(agora - 1800e3).toISOString() : null,
    link: `https://cor.rio/simulacao-${i}/`,
    abrangencia: 'Município do Rio de Janeiro',
  }));
  return {
    ok: true, aplicavel: true, fonte: 'COR-Rio', abrangencia: 'Município do Rio de Janeiro', urlPublica: 'https://cor.rio/',
    estagio: {
      status: estagioStatus,
      dados: nivel ? { nivel, rotulo: `Estágio ${nivel}`, vigenteDesde: new Date(agora - 5 * 3600e3).toISOString(), mensagens: [], urlPublica: 'https://cor.rio/estagios-operacionais-da-cidade/' } : null,
      consultadoEm: nivel ? new Date(agora - 600e3).toISOString() : null,
      falha: estagioStatus === 'operacional' ? null : 'a fonte não respondeu a tempo',
    },
    comunicados: {
      status: comStatus, janelaHoras: 24,
      consultadoEm: comStatus === 'indisponivel' ? null : new Date(agora - 600e3).toISOString(),
      falha: comStatus === 'operacional' ? null : 'falha de conexão com a fonte',
      itens: comStatus === 'indisponivel' ? [] : lista,
    },
  };
}

(async () => {
  fs.mkdirSync(SAIDA, { recursive: true });
  const servidor = http.createServer(criarApp({ senhaPainel: 'verificacao-visual-123' }));
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${servidor.address().port}`;
  const browser = await puppeteer.launch({ headless: true, pipe: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const page = await browser.newPage();
  const erros = [];
  page.on('pageerror', (e) => erros.push(e.message));
  // o 502 simulado de propósito no passo 6 não conta como erro
  page.on('console', (m) => { if (m.type() === 'error' && !/status of 502/.test(m.text())) erros.push(m.text()); });

  let simulacao = null; // null = deixa passar para a fonte real
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    if (simulacao && req.url().includes('/api/cor-rio')) {
      return simulacao === 'erro500'
        ? req.respond({ status: 502, contentType: 'application/json', body: JSON.stringify({ ok: false, erro: 'falha simulada' }) })
        : req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(simulacao) });
    }
    return req.continue();
  });

  const resultado = (rotulo, valor) => console.log(`${valor ? 'OK  ' : 'FALHA'} ${rotulo}`) || (valor || (process.exitCode = 1));
  const recarregarCor = async () => {
    await page.evaluate(() => { proximaConsultaCorRio = 0; window.dispatchEvent(new Event('focus')); });
    await new Promise((r) => setTimeout(r, 400));
  };
  const cores = () => page.evaluate(() => {
    const q = (s) => document.querySelector(s);
    const cs = (s, p) => (q(s) ? getComputedStyle(q(s))[p] : null);
    return {
      faixa: cs('.cor-rio', 'borderLeftColor'),
      borda: cs('.cor-rio', 'borderTopColor'),
      icone: q('.cor-rio-icone .icon') ? getComputedStyle(q('.cor-rio-icone .icon')).color : null,
      sublinhado: cs('.cor-rio-titulo', 'borderBottomColor'),
      chip: cs('.cor-rio-estagio-chip', 'backgroundColor'),
      chipTexto: cs('.cor-rio-estagio-chip', 'color'),
      atual: cs('.cor-rio-escala li.atual', 'backgroundColor'),
      botao: cs('.cor-rio-botao', 'borderLeftColor'),
      escala: [...document.querySelectorAll('.cor-rio-escala li')].map((li) => getComputedStyle(li).borderTopColor),
      textoChip: q('.cor-rio-estagio-chip')?.textContent,
      atuais: document.querySelectorAll('.cor-rio-escala li.atual').length,
      textoAtual: q('.cor-rio-escala li.atual')?.innerText,
    };
  });

  // 1) Dados reais, desktop
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(`${base}/?cidade=rio_de_janeiro`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('#conteudo').getAttribute('aria-busy') === 'false', { timeout: 200000 });
  await page.waitForFunction(() => estadoCorRio && !estadoCorRio.carregando && document.querySelector('.cor-rio'), { timeout: 60000 });
  const ordem = await page.evaluate(() => [...document.querySelector('#conteudo').children].map((el) => el.className || el.id));
  resultado(`posição: ocorrências → COR-Rio → indicadores (${ordem.slice(0, 3).join(' | ')})`, ordem[0] === 'ocorrencias' && ordem[1] === 'cor-rio-slot' && ordem[2] === 'indicadores');
  const real = await page.evaluate(() => ({ texto: document.querySelector('.cor-rio').innerText, estado: estadoCorRio.resposta.estagio }));
  console.log('Dados reais:', JSON.stringify({ estagio: real.estado.dados?.rotulo, status: real.estado.status }), '\n', real.texto.slice(0, 600));
  const panel = await page.$('.cor-rio');
  await panel.screenshot({ path: path.join(SAIDA, 'real-desktop.png') });
  await page.screenshot({ path: path.join(SAIDA, 'real-pagina-desktop.png'), fullPage: false, clip: { x: 0, y: (await panel.boundingBox()).y - 260, width: 1440, height: 900 } });

  // 2) Cinco estágios
  for (const n of [1, 2, 3, 4, 5]) {
    simulacao = respostaSimulada({ nivel: n });
    await recarregarCor();
    const c = await cores();
    resultado(`estágio ${n}: faixa/ícone/título/indicador/atual/botão em ${CORES[n]}`, [c.faixa, c.icone, c.sublinhado, c.chip, c.atual, c.botao].every((v) => v === CORES[n]));
    // color-mix() é serializado como color(srgb r g b / alfa), com canais 0–1
    const canais = (c.borda.match(/color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)/) || []).slice(1).map((v) => Math.round(v * 255));
    resultado(`estágio ${n}: borda com a cor do estágio (${c.borda})`, `rgb(${canais.join(', ')})` === CORES[n]);
    resultado(`estágio ${n}: escala 1–5 com a cor de cada estágio`, JSON.stringify(c.escala) === JSON.stringify(Object.values(CORES)));
    resultado(`estágio ${n}: texto "ESTÁGIO ${n}", um único "Atual", texto escuro no destaque`, c.textoChip === `ESTÁGIO ${n}` && c.atuais === 1 && /Atual/i.test(c.textoAtual) && c.chipTexto === 'rgb(11, 26, 18)');
    await (await page.$('.cor-rio')).screenshot({ path: path.join(SAIDA, `estagio-${n}-desktop.png`) });
  }

  // 3) Mudança automática 2 → 4 sem recarregar a página
  simulacao = respostaSimulada({ nivel: 2 });
  await recarregarCor();
  await page.evaluate(() => { window.__marcador = 'mesma-pagina'; });
  simulacao = respostaSimulada({ nivel: 4 });
  await page.evaluate(() => { proximaConsultaCorRio = 0; });
  await page.evaluate(() => verificarSeVencido());
  await new Promise((r) => setTimeout(r, 400));
  const troca = await cores();
  resultado('troca automática 2 → 4 pelo ciclo de verificação, sem recarregar', troca.textoChip === 'ESTÁGIO 4' && troca.faixa === CORES[4] && await page.evaluate(() => window.__marcador === 'mesma-pagina'));

  // 4) Celular
  for (const largura of [390, 320]) {
    await page.setViewport({ width: largura, height: 800, deviceScaleFactor: 2 });
    await new Promise((r) => setTimeout(r, 300));
    const m = await page.evaluate(() => {
      const sec = document.querySelector('.cor-rio');
      const estagio = document.querySelector('.cor-rio-estagio').getBoundingClientRect();
      const principal = document.querySelector('.cor-rio-principal').getBoundingClientRect();
      const cortados = [...sec.querySelectorAll('*')].filter((el) => el.getBoundingClientRect().right > innerWidth + 0.5).length;
      return { rolagem: document.documentElement.scrollWidth > innerWidth, empilhado: estagio.top >= principal.bottom - 1, cortados, colunas: getComputedStyle(sec).gridTemplateColumns };
    });
    resultado(`celular ${largura}px: sem rolagem horizontal, elementos empilhados, nada cortado (${JSON.stringify(m)})`, !m.rolagem && m.empilhado && m.cortados === 0);
    await (await page.$('.cor-rio')).screenshot({ path: path.join(SAIDA, `estagio-4-mobile-${largura}.png`) });
  }

  // 5) Botão "Ver comunicado"
  await page.setViewport({ width: 390, height: 800, deviceScaleFactor: 2 });
  await page.click('.cor-rio-botao');
  await page.waitForSelector('dialog[open]');
  const det = await page.evaluate(() => ({
    titulo: document.getElementById('detalhes-titulo').textContent,
    link: document.querySelector('#detalhes-conteudo a.cor-rio-link')?.href,
    alvo: document.querySelector('#detalhes-conteudo a.cor-rio-link')?.target,
    texto: document.getElementById('detalhes-conteudo').innerText.slice(0, 200),
    rolagem: document.getElementById('detalhes').scrollWidth > document.getElementById('detalhes').clientWidth,
  }));
  resultado(`diálogo: conteúdo completo e link original (${det.link})`, det.titulo === 'Comunicado COR-Rio' && det.link === 'https://cor.rio/simulacao-0/' && det.alvo === '_blank' && /SIMULAÇÃO/.test(det.texto) && !det.rolagem);
  await page.screenshot({ path: path.join(SAIDA, 'detalhe-mobile.png') });
  await page.click('#detalhes-conteudo [data-detail="cor-rio:901"]');
  resultado('diálogo: navega para outro comunicado vigente', await page.evaluate(() => /Comunicado de teste 2/.test(document.getElementById('detalhes-conteudo').innerText)));
  await page.keyboard.press('Escape');
  await page.setViewport({ width: 1440, height: 900 });

  // 6) Estados de indisponibilidade
  const estados = {
    'indisponivel': respostaSimulada({ nivel: null, estagioStatus: 'indisponivel', comStatus: 'indisponivel' }),
    'nenhum-comunicado': respostaSimulada({ nivel: 2, itens: 0 }),
    'desatualizado': respostaSimulada({ nivel: 3, estagioStatus: 'desatualizado', comStatus: 'desatualizado' }),
  };
  for (const [nome, sim] of Object.entries(estados)) {
    simulacao = sim;
    await recarregarCor();
    const t = await page.evaluate(() => ({ texto: document.querySelector('.cor-rio').innerText, cor: document.querySelector('.cor-rio').dataset.corEstagio || null, faixa: getComputedStyle(document.querySelector('.cor-rio')).borderLeftColor }));
    const ok = {
      indisponivel: /Estágio indisponível/.test(t.texto) && /Não foi possível consultar a fonte/.test(t.texto) && !t.cor && !Object.values(CORES).includes(t.faixa),
      'nenhum-comunicado': /Nenhum comunicado vigente/.test(t.texto) && !/Não foi possível/.test(t.texto),
      desatualizado: /ESTÁGIO 3/.test(t.texto) && /Desatualizado · última consulta válida/i.test(t.texto) && /Comunicados desatualizados/.test(t.texto),
    }[nome];
    resultado(`estado ${nome} (faixa ${t.faixa})`, ok);
    await (await page.$('.cor-rio')).screenshot({ path: path.join(SAIDA, `estado-${nome}.png`) });
  }
  // falha do próprio servidor depois de um dado válido
  simulacao = respostaSimulada({ nivel: 5 });
  await recarregarCor();
  simulacao = 'erro500';
  await recarregarCor();
  const offline = await page.evaluate(() => document.querySelector('.cor-rio').innerText);
  resultado('falha do /api/cor-rio preserva o último estágio, marcado como desatualizado', /ESTÁGIO 5/.test(offline) && /Desatualizado/.test(offline));
  await (await page.$('.cor-rio')).screenshot({ path: path.join(SAIDA, 'estado-falha-servidor.png') });

  // 7) Outra base: painel não aparece
  simulacao = null;
  await page.select('#seletor-base', 'macae');
  await page.waitForFunction(() => document.querySelector('#conteudo').getAttribute('aria-busy') === 'false', { timeout: 200000 });
  resultado('base Macaé: painel COR-Rio não é exibido', await page.evaluate(() => !document.querySelector('.cor-rio')));

  resultado(`sem erros no console (${JSON.stringify(erros)})`, erros.length === 0);
  await browser.close();
  servidor.closeAllConnections?.();
  servidor.close();
  process.exit();
})().catch((e) => { console.error(e); process.exit(1); });
