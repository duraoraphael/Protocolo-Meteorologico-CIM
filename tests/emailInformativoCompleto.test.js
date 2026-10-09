const test = require('node:test');
const assert = require('node:assert/strict');
const cheerio = require('cheerio');
const { renderEmailHtml } = require('../src/render/emailTemplate');
const { VISUAL_NIVEL } = require('../src/render/alertCards');

function relatorio(sobrescritas = {}) {
  return {
    cidade: { nome: 'Rio de Janeiro', uf: 'RJ' },
    dataFormatadaLonga: 'segunda-feira, 28 de setembro de 2026',
    dataFormatadaCurta: '28/09/2026', horaConsulta: '10:09',
    condicaoGeral: 'Muitas nuvens com pancadas de chuva',
    tempMin: 21, tempMax: 33, umidadeMin: 55, umidadeMax: 100,
    precipitacaoTotalMm: 0, precipitacaoDiariaMm: 0,
    ventoPorPeriodo: [
      { periodo: 'Manhã', rajadaMaxKmh: 24 },
      { periodo: 'Tarde', rajadaMaxKmh: 36 },
      { periodo: 'Noite', rajadaMaxKmh: 20 },
    ],
    qualidadeAr: { fonte: 'Open-Meteo Air Quality', pm25Medio: 14.5, pm25Periodo: 'média diária', pm25Classificacao: { nivel: 'Boa' }, uvMax: 11.2, uvClassificacao: { nivel: 'Extremo' } },
    mar: { fonte: 'Open-Meteo Marine', alturaMaxDiaM: 0.7, estadoMarDia: 'Leve' },
    fontesPorCampo: {
      condicaoGeral: 'INMET', tempMin: 'INMET', tempMax: 'INMET',
      umidadeMin: 'INMET', umidadeMax: 'INMET',
      'periodos.tarde.rajadaMaxKmh': 'Open-Meteo',
      precipitacaoTotalMm: 'Open-Meteo', precipitacaoDiariaMm: 'Open-Meteo — estimativa diária', 'ar.pm25Medio': 'Open-Meteo Air Quality',
      'ar.uvMax': 'Open-Meteo Air Quality', 'mar.alturaMaxDiaM': 'Open-Meteo Marine',
    },
    severidade: { grau: 'NORMAL', eventos: [] }, avisosInmet: [],
    ...sobrescritas,
  };
}

function semImagem(html) {
  return html.replace(/src="data:[^"]+"/g, 'src="[imagem]"');
}

test('cabeçalho, oito cards e rodapé usam dados e fontes do relatório', () => {
  const html = semImagem(renderEmailHtml(relatorio()));
  const $ = cheerio.load(html);
  assert.equal($('script, style, svg').length, 0);
  assert.equal($('table').length >= 4, true);
  assert.equal($('img[alt="Petrobras"]').length <= 1, true);
  assert.ok(html.includes('Rio de Janeiro — RJ — segunda-feira, 28 de setembro de 2026'));
  for (const texto of [
    'CIM', 'Centro Integrado', 'de Monitoramento', 'COMPARTILHADO',
    'INFORMATIVO METEOROLÓGICO', 'Hora da consulta:', '10:09',
    'TEMP. MÍN/MÁX', '21° / 33°C', 'UMIDADE MÍN/MÁX', '55% / 100%',
    'QUALIDADE DO AR', 'Boa', 'RAJADA PREVISTA', '36 km/h',
    'CHUVA ACUMULADA', '0 mm', 'CALOR', 'Indisponível',
    'MAR — ALTURA MÁX. DE ONDA', '0.7 m', 'CONDIÇÃO GERAL',
    'Fontes de dados:', 'INMET', 'Open-Meteo Air Quality', 'Open-Meteo Marine',
    'Informativo gerado automaticamente pelo Protocolo Meteorológico do COMPARTILHADO.',
  ]) assert.ok(html.includes(texto), texto);
  assert.match(html, /Fontes de dados:<\/strong><br>[^<]*INMET/);
  assert.ok(!html.includes('Rajada prevista/registrada'));
  assert.ok(!html.includes('QUALIDADE DO AR (PM2,5)') && !html.includes('14.5 µg/m³'));
  assert.ok(!html.includes('display:grid') && !html.includes('display:flex'));
});

test('card de rajada usa a edição, mostra a fonte e não duplica a frase no cabeçalho', () => {
  for (const [horarioAgendado, frase] of [['05:00', 'Previsão até as 15hrs'], ['15:00', 'Previsão até as 00h']]) {
    const html = semImagem(renderEmailHtml(relatorio({ horarioAgendado, previsaoAte: horarioAgendado === '05:00' ? '15h' : '00h' })));
    const $ = cheerio.load(html);
    const card = $('div').filter((_, elemento) => $(elemento).text().trim() === 'RAJADA PREVISTA').first().closest('td');
    const textoCard = card.text().replace(/\s+/g, ' ').trim();
    assert.ok(textoCard.indexOf(frase) < textoCard.indexOf('RAJADA PREVISTA'));
    assert.match(textoCard, /36 km\/h/);
    assert.match(textoCard, /Fonte: Open-Meteo/);
    assert.equal((html.match(new RegExp(frase, 'g')) || []).length, 1);
    assert.doesNotMatch(html, /\| Previsão até/);
  }
});

test('card de qualidade do ar exibe somente a classificação dinâmica', () => {
  const html = semImagem(renderEmailHtml(relatorio({
    qualidadeAr: {
      fonte: 'Open-Meteo Air Quality', pm25Medio: 27.4, pm25Periodo: 'média diária',
      pm25Classificacao: { nivel: 'Moderada' }, uvMax: 5,
      uvClassificacao: { nivel: 'Moderado' },
    },
  })));
  assert.ok(html.includes('QUALIDADE DO AR'));
  assert.ok(html.includes('Moderada'));
  assert.ok(!html.includes('QUALIDADE DO AR (PM2,5)'));
  assert.ok(!html.includes('27.4 µg/m³'));
});

test('CALOR é a última célula e alertas ficam em severidade decrescente com empate estável', () => {
  const html = semImagem(renderEmailHtml(relatorio({
    severidade: { grau: 'ALERTA', eventos: [
      { tipo: 'uvAlto', assinatura: 'uv', grau: 'ALERTA', titulo: 'ALERTA — ÍNDICE UV ELEVADO', descricao: 'Índice UV extremo', fonteDados: 'Open-Meteo Air Quality' },
      { tipo: 'ventoModerado', assinatura: 'vento', grau: 'ATENÇÃO', titulo: 'ATENÇÃO — VENTO', descricao: 'Vento', fonteDados: 'Open-Meteo' },
      { tipo: 'chuvaIntensa', assinatura: 'chuva', grau: 'ALERTA', titulo: 'ALERTA — CHUVA', descricao: 'Chuva', fonteDados: 'Open-Meteo' },
    ] },
  })));
  const $ = cheerio.load(html);
  const tabela = $('div').filter((_, elemento) => $(elemento).text().trim() === 'TEMP. MÍN/MÁX').first().closest('table');
  const segundaLinha = tabela.children('tbody').children('tr').eq(1).children('td').map((_, td) => $(td).text().replace(/\s+/g, ' ').trim()).get();
  assert.match(segundaLinha[0], /^QUALIDADE DO AR/);
  assert.match(segundaLinha[1], /^CHUVA ACUMULADA/);
  assert.match(segundaLinha[2], /^CALOR/);
  assert.doesNotMatch(segundaLinha.join(' '), /ÍNDICE UV|11\.2/, 'o card não usa o índice UV');
  const vento = html.indexOf('VENTO — ATENÇÃO');
  const chuva = html.indexOf('CHUVA INTENSA — ALERTA');
  const uv = html.indexOf('ÍNDICE UV — ALERTA');
  assert.ok(uv >= 0 && uv < chuva && chuva < vento);
  assert.match(html, /Índice UV extremo/, 'o evento de UV continua no e-mail');
});

test('card CALOR mostra a classificação EHF de hoje na cor do nível, sem usar UV', () => {
  const climaSaude = (previsaoDias, extra = {}) => ({ status: 'operacional', dados: {
    source: 'Clima e Saúde — Ministério da Saúde', dataConsulta: '2026-09-28',
    ehf: { classificacao: 'Sem excesso' }, previsaoDias, nivel: { grau: 'NORMAL' }, recomendacoes: [], ...extra,
  } });
  const celula = (html) => {
    const $ = cheerio.load(html);
    const tabela = $('div').filter((_, e) => $(e).text().trim() === 'TEMP. MÍN/MÁX').first().closest('table');
    return tabela.children('tbody').children('tr').eq(1).children('td').eq(2);
  };
  const base = { geradoEmISO: '2026-09-28T13:09:00Z', cidade: { nome: 'Rio de Janeiro', uf: 'RJ', fuso: 'America/Sao_Paulo' } };
  const atencao = celula(renderEmailHtml(relatorio({ ...base, climaSaude: climaSaude([{ data: '2026-09-28', classificacao: 'Baixo' }, { data: '2026-09-29', classificacao: 'Severo' }]) })));
  assert.equal(atencao.text().replace(/\s+/g, ' ').trim(), 'CALOR Atenção');
  assert.ok(atencao.html().includes(`color:${VISUAL_NIVEL['ATENÇÃO'].texto}`));
  const alerta = celula(renderEmailHtml(relatorio({ ...base, climaSaude: climaSaude([{ data: '2026-09-28', classificacao: 'Severo' }]) })));
  assert.match(alerta.text(), /Alerta/);
  assert.ok(alerta.html().includes(`color:${VISUAL_NIVEL.ALERTA.texto}`));
  const normal = celula(renderEmailHtml(relatorio({ ...base, climaSaude: climaSaude([{ data: '2026-09-28', classificacao: 'Sem excesso' }]) })));
  assert.match(normal.text(), /Normal/);
  assert.ok(normal.html().includes(`color:${VISUAL_NIVEL.NORMAL.texto}`));
  // Coleta de outro dia sem previsão para hoje: indisponível, nunca "Normal".
  const semHoje = celula(renderEmailHtml(relatorio({ ...base, climaSaude: { status: 'degradado', dados: { source: 'Clima e Saúde — Ministério da Saúde', dataConsulta: '2026-09-25', ehf: { classificacao: 'Sem excesso' }, previsaoDias: [{ data: '2026-09-25', classificacao: 'Sem excesso' }] } } })));
  assert.match(semHoje.text(), /Indisponível/);
  assert.doesNotMatch(semHoje.text(), /Normal/);
});

test('dados ausentes mostram traço sem fabricar números nem fontes', () => {
  const html = semImagem(renderEmailHtml(relatorio({
    condicaoGeral: null, tempMin: null, tempMax: null, umidadeMin: null, umidadeMax: null,
    precipitacaoTotalMm: null, ventoPorPeriodo: [], qualidadeAr: null, mar: null,
    fontesPorCampo: {},
  })));
  assert.ok(html.includes('RAJADA PREVISTA'));
  assert.ok(html.includes('CHUVA ACUMULADA'));
  assert.ok(html.includes('Dados indisponíveis nesta emissão.'));
  assert.ok(!html.includes('null°C') && !html.includes('undefined'));
  assert.ok(!html.includes('Fonte: INMET'));
});

test('dado marítimo armazenado exibe horário válido e não parece atual', () => {
  const html = semImagem(renderEmailHtml(relatorio({
    mar: {
      fonte: 'Open-Meteo Marine', alturaMaxDiaM: 0.7, estadoMarDia: 'Leve',
      desatualizado: true, ultimaAtualizacao: '2026-10-01T09:00:00.000Z',
    },
  })));
  assert.match(html, /Dado armazenado/);
  assert.match(html, /01\/10\/2026 06:00/);
  assert.doesNotMatch(html, /2026-10-01T09:00:00\.000Z/);
});

test('alerta, aviso oficial e recomendações aparecem uma vez e na ordem solicitada', () => {
  const html = semImagem(renderEmailHtml(relatorio({
    severidade: { grau: 'ALERTA', eventos: [{
      tipo: 'ventoForte', titulo: 'ALERTA — VENTO', descricao: 'Rajada prevista: 41 km/h',
      janela: 'Tarde', fonteDados: 'Open-Meteo', recomendacoes: ['Reforçar monitoramento.', 'Paralisar atividades expostas.'],
    }] },
    avisosInmet: [{
      descricao: 'Tempestade', severidade: 'Perigo Potencial', inicio: '14:00', fim: '18:00',
      riscos: ['Chuva entre 20 e 30 mm/h.'], instrucoes: ['Busque abrigo.'],
    }],
  })));
  const $ = cheerio.load(html);
  const cards = $('table[data-alert-card]');
  assert.deepEqual(cards.map((_, c) => $(c).attr('data-nivel')).get(), ['ALERTA', 'ATENÇÃO']);
  const [vento, aviso] = cards.map((_, c) => $(c)).get();
  assert.equal(vento.find('[data-alert-title]').text().replace(/\s+/g, ' ').trim(), '● VENTO — ALERTA');
  assert.equal(aviso.find('[data-alert-title]').text().replace(/\s+/g, ' ').trim(), '● TEMPESTADE COM RAIOS — ATENÇÃO');
  // Recomendações completas dentro do card do próprio alerta, sem bloco separado.
  assert.deepEqual(vento.find('[data-alert-recommendation]').map((_, li) => $(li).text()).get(), ['Reforçar monitoramento.', 'Paralisar atividades expostas.']);
  assert.ok(aviso.find('[data-alert-recommendation]').length > 0);
  assert.ok(!html.includes('Recomendações - Protocolo Meteorológico do COMPARTILHADO'));
  assert.ok(html.indexOf('Fontes de dados:') > html.lastIndexOf('data-alert-card'));
  assert.ok(!html.includes('Previsão para os próximos dias'));
  assert.equal((html.match(/Tempestade —/g) || []).length, 1);
  assert.equal((html.match(/Reforçar monitoramento\./g) || []).length, 1);
  const textoAviso = aviso.text().replace(/\s+/g, ' ');
  assert.ok(textoAviso.includes('Motivo do aviso: Chuva entre 20 e 30 mm/h.'));
  assert.ok(textoAviso.includes('Vigência: 14:00 até 18:00'));
  assert.ok(textoAviso.includes('Instruções oficiais: Busque abrigo.'));
  assert.ok(textoAviso.includes('Fonte de dados: INMET'));
  assert.ok(vento.text().replace(/\s+/g, ' ').includes('Fonte de dados: Open-Meteo'));
  assert.ok(vento.attr('style').includes(`border:1.5px solid ${VISUAL_NIVEL.ALERTA.cor}`));
  assert.ok(aviso.attr('style').includes(`border:1.5px solid ${VISUAL_NIVEL['ATENÇÃO'].cor}`));
  assert.ok(!html.includes('Fonte de critério') && !html.includes('A condição atingiu'));
});

test('aviso oficial INMET reutiliza exatamente o componente visual dos demais cards', () => {
  const html = semImagem(renderEmailHtml(relatorio({
    severidade: { grau: 'ATENÇÃO', eventos: [{
      tipo: 'ventoModerado', titulo: 'ATENÇÃO — VENTO', descricao: 'Rajada prevista: 36 km/h',
      fonteDados: 'Open-Meteo', recomendacoes: [],
    }] },
    avisosInmet: [{ descricao: 'Baixa Umidade', severidade: 'Perigo Potencial', riscos: ['Risco à saúde.'] }],
  })));
  const $ = cheerio.load(html);
  const [cardLocal, cardInmet] = $('table[data-alert-card]').map((_, c) => $(c)).get();
  assert.ok(cardLocal && cardInmet);
  assert.match(cardLocal.find('[data-alert-title]').text(), /VENTO — ATENÇÃO/);
  assert.match(cardInmet.find('[data-alert-title]').text(), /BAIXA UMIDADE — ATENÇÃO/);
  assert.equal(cardInmet.attr('style'), cardLocal.attr('style'));
  assert.equal(cardInmet.find('td').first().attr('style'), cardLocal.find('td').first().attr('style'));
  assert.equal(cardInmet.find('[data-alert-title]').attr('style'), cardLocal.find('[data-alert-title]').attr('style'));
  assert.equal(cardInmet.find('[data-alert-level]').attr('style'), cardLocal.find('[data-alert-level]').attr('style'));
});

test('aviso INMET usa a cor do seu nível e a linha dinâmica fica escura sobre o fundo do nível', () => {
  for (const [evento, severidade, nivel] of [
    ['Baixa Umidade', 'Perigo Potencial', 'ATENÇÃO'],
    ['Chuvas Intensas', 'Perigo', 'ALERTA'],
    ['Tempestade', 'Grande Perigo', 'EMERGÊNCIA'],
  ]) {
    const html = semImagem(renderEmailHtml(relatorio({ avisosInmet: [{ descricao: evento, severidade }] })));
    const $ = cheerio.load(html);
    const card = $('table[data-alert-card]');
    const v = VISUAL_NIVEL[nivel];
    assert.equal(card.length, 1);
    assert.equal(card.attr('data-nivel'), nivel);
    assert.ok(card.attr('style').includes(`border:1.5px solid ${v.cor}`));
    assert.match(card.find('[data-alert-title]').attr('style'), new RegExp(`^color:${v.texto};font:bold`));
    assert.equal(card.find('[data-alert-level]').text(), v.rotulo);
    const linha = $('div').filter((_, elemento) => $(elemento).text().trim() === `Aviso: ${evento} — ${severidade}`).first();
    assert.equal(linha.length, 1);
    assert.match(linha.closest('td').attr('style'), new RegExp(`background:${v.fundo};.*color:#222222;`));
    assert.equal(card.find('[data-alert-recommendations]').attr('bgcolor'), v.fundo);
  }
});

test('e-mail omite completamente as previsões dos próximos dias', () => {
  const quatroDias = ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01'].map((data, i) => ({
    data, periodo: i ? `Dia +${i}` : 'Hoje (05:00–00:00)',
    tempMin: 21 + i, tempMax: 33 + i, condicao: 'Pancadas de chuva', chuvaMm: i, rajadaKmh: 30 + i,
  }));
  const manha = semImagem(renderEmailHtml(relatorio({ horarioAgendado: '05:00', previsaoDias: quatroDias, periodoCoberto: 'Hoje, das 05:00 até 00:00, mais os três dias seguintes' })));
  const tarde = semImagem(renderEmailHtml(relatorio({ horarioAgendado: '15:00', previsaoDias: quatroDias.slice(0, 2), periodoCoberto: 'Hoje, das 15:00 até 00:00, mais o dia seguinte', mudancasDia: ['Grau geral: ATENÇÃO → ALERTA.'] })));
  for (const html of [manha, tarde]) {
    assert.ok(!html.includes('Previsão para os próximos dias'));
    assert.ok(!html.includes('Pancadas de chuva'));
    assert.ok(!html.includes('Dia +1'));
    assert.ok(!html.includes('2026-09-29'));
  }
  assert.ok(tarde.includes('ATENÇÃO → ALERTA'));
  assert.ok(tarde.includes('Fontes de dados:'));
  assert.ok(tarde.includes('Open-Meteo'));
});

test('HTML escapa textos externos sem transformar o e-mail em imagem', () => {
  const html = semImagem(renderEmailHtml(relatorio({ condicaoGeral: '<img src=x onerror=alert(1)>' })));
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(!html.includes('<img src=x onerror=alert(1)>'));
  assert.ok(html.includes('<table'));
});
