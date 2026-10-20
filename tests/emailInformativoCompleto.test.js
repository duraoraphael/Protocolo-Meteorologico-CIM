const test = require('node:test');
const assert = require('node:assert/strict');
const cheerio = require('cheerio');
const { renderEmailHtml, probabilidadeChuvaPrevista } = require('../src/render/emailTemplate');
const { VISUAL_NIVEL } = require('../src/render/alertCards');

function relatorio(sobrescritas = {}) {
  return {
    cidade: { nome: 'Rio de Janeiro', uf: 'RJ' },
    dataFormatadaLonga: 'segunda-feira, 28 de setembro de 2026',
    dataFormatadaCurta: '28/09/2026', horaConsulta: '10:09',
    condicaoGeral: 'Muitas nuvens com pancadas de chuva',
    tempMin: 21, tempMax: 33, umidadeMin: 55, umidadeMax: 100,
    precipitacaoTotalMm: 0, precipitacaoDiariaMm: 0, probabilidadeChuvaPrevista: 85,
    ventoPorPeriodo: [
      { periodo: 'Manhã', janela: '05h–12h', direcao: 'N', velocidadeMediaKmh: null, rajadaMaxKmh: 24, referenciaInmet: 'Previsão municipal INMET' },
      { periodo: 'Tarde', janela: '12h–18h', direcao: 'S', velocidadeMediaKmh: null, rajadaMaxKmh: 36, referenciaInmet: 'Previsão municipal INMET' },
      { periodo: 'Noite', janela: '18h–00h', direcao: 'SW', velocidadeMediaKmh: null, rajadaMaxKmh: 20, referenciaInmet: 'Previsão municipal INMET' },
    ],
    chuvaPorPeriodo: [
      { periodo: 'Manhã', janela: '05h–12h', probabilidade: null, precipitacaoMm: null, resumoInmet: 'Muitas nuvens' },
      { periodo: 'Tarde', janela: '12h–18h', probabilidade: null, precipitacaoMm: null, resumoInmet: 'Pancadas de chuva' },
      { periodo: 'Noite', janela: '18h–00h', probabilidade: null, precipitacaoMm: null, resumoInmet: 'Muitas nuvens' },
    ],
    previsaoDias: [{ chuvaMm: 0 }],
    qualidadeAr: { fonte: 'Open-Meteo Air Quality', aqiPm25: 18, pm25Medio: 14.5, pm25Periodo: 'média diária', pm25Classificacao: { nivel: 'Boa' }, uvMax: 11.2, uvClassificacao: { nivel: 'Extremo' } },
    mar: { fonte: 'Open-Meteo Marine', alturaMaxDiaM: 0.7, estadoMarDia: 'Leve' },
    fontesPorCampo: {
      condicaoGeral: 'INMET — previsão oficial', tempMin: 'INMET — previsão oficial', tempMax: 'INMET — previsão oficial',
      umidadeMin: 'INMET — previsão oficial', umidadeMax: 'INMET — previsão oficial',
      'periodos.tarde.rajadaMaxKmh': 'INMET — previsão oficial',
      precipitacaoTotalMm: 'INMET — estação automática — observado', precipitacaoDiariaMm: 'INMET — estação automática — observado', 'ar.pm25Medio': 'Open-Meteo Air Quality',
      'ar.uvMax': 'Open-Meteo Air Quality', 'mar.alturaMaxDiaM': 'Open-Meteo Marine',
    },
    severidade: { grau: 'NORMAL', eventos: [] }, avisosInmet: [],
    ...sobrescritas,
  };
}

function semImagem(html) {
  return html.replace(/src="data:[^"]+"/g, 'src="[imagem]"');
}

test('cabeçalho, indicadores e rodapé usam dados e fontes do relatório', () => {
  const html = semImagem(renderEmailHtml(relatorio()));
  const $ = cheerio.load(html);
  assert.equal($('script, svg').length, 0);
  assert.equal($('style').length, 1);
  assert.match($('style').text(), /@media only screen and \(max-width:640px\)/);
  assert.equal($('table').length >= 4, true);
  assert.equal($('img[alt="Petrobras"]').length, 0);
  assert.ok(html.includes('Rio de Janeiro — RJ — segunda-feira, 28 de setembro de 2026'));
  for (const texto of [
    'CIM', 'Centro Integrado', 'de Monitoramento', 'COMPARTILHADO',
    'INFORMATIVO METEOROLÓGICO', 'Hora da consulta:', '10:09',
    'PREVISÃO TEMP. MÍN/MÁX', '21° / 33°C', 'PREVISÃO UMIDADE MÍN/MÁX', '55% / 100%',
    'QUALIDADE DO AR', 'Boa', 'RAJADA PREVISTA', '36 km/h',
    'CHUVA ACUMULADA/DIA', '0 mm', 'PROBABILIDADE DE CHUVA', '85%', 'CALOR', 'Dado indisponível',
    'MAR — ALTURA MÁX. DE ONDA', '0.7 m', 'CONDIÇÃO GERAL',
    'Fontes de dados:', 'INMET', 'Clima e Saúde — Ministério da Saúde',
    'Open-Meteo — todos (previsão complementar, Air Quality / CAMS e Marine)',
    'Informativo gerado automaticamente pelo Protocolo Meteorológico do COMPARTILHADO.',
  ]) assert.ok(html.includes(texto), texto);
  for (const secaoRemovida of ['Temperatura e umidade', 'Vento por período', 'Chuva por período']) {
    assert.ok(!html.includes(secaoRemovida), secaoRemovida);
  }
  assert.match(html, /Fontes de dados:<\/strong><br>[^<]*INMET/);
  assert.ok(!html.includes('Rajada prevista/registrada'));
  assert.ok(!html.includes('QUALIDADE DO AR (PM2,5)') && !html.includes('14.5 µg/m³'));
  assert.ok(!html.includes('display:grid') && !html.includes('display:flex'));
});

test('e-mail identifica Petrobras — OCEANOP somente quando a fonte entrou no relatório', () => {
  const html = semImagem(renderEmailHtml(relatorio({
    mar: { fonte: 'Petrobras — OCEANOP', alturaMaxDiaM: 2.1, estadoMarDia: 'Moderado' },
    fontesPorCampo: {
      ...relatorio().fontesPorCampo,
      'mar.alturaMaxDiaM': 'Petrobras — OCEANOP',
    },
  })));
  assert.match(html, /Petrobras — OCEANOP/);
});

test('card de e-mail usa a máxima OCEANOP da janela, não outra rajada fora dela', () => {
  const html = semImagem(renderEmailHtml(relatorio({
    rajadaMaxKmh: 43.2,
    rajadaPrevistaReferencia: { periodoReferencia: '28/09/2026 12:00:00 a 28/09/2026 12:59:59' },
    ventoPorPeriodo: [
      { periodo: 'Tarde', janela: '12h–18h', rajadaMaxKmh: 43.2 },
      { periodo: 'Noite', janela: '18h–00h', rajadaMaxKmh: 80 },
    ],
    fontesPorCampo: { ...relatorio().fontesPorCampo, rajadaMaxKmh: 'Petrobras — OCEANOP' },
  })));
  const $ = cheerio.load(html);
  const card = $('div').filter((_, elemento) => $(elemento).text().trim() === 'RAJADA PREVISTA').first().closest('td');
  assert.match(card.text(), /43\.2 km\/h/);
  assert.doesNotMatch(card.text(), /80 km\/h/);
});

test('informativos de 05h e 15h exibem exatamente a lista institucional de fontes', () => {
  const fontesEsperadas = 'INMET | Clima e Saúde — Ministério da Saúde | Open-Meteo — todos (previsão complementar, Air Quality / CAMS e Marine)';
  for (const horarioAgendado of ['05:00', '15:00']) {
    const $ = cheerio.load(renderEmailHtml(relatorio({ horarioAgendado, previsaoAte: '00h' })));
    const linhaFontes = $('strong').filter((_, elemento) => $(elemento).text() === 'Fontes de dados:').parent();
    assert.equal(linhaFontes.find('strong').text(), 'Fontes de dados:');
    assert.equal(linhaFontes.clone().find('strong, br').remove().end().text().trim(), fontesEsperadas);
  }
});

test('indicadores formam uma única grade 3–3–2 sem tabelas técnicas no corpo', () => {
  const html = semImagem(renderEmailHtml(relatorio()));
  const $ = cheerio.load(html);
  const grade = $('[data-email-metrics="true"]');
  const linhas = grade.children('tbody').children('[data-email-metric-row]');

  assert.equal(grade.length, 1);
  assert.match(grade.attr('style'), /border-collapse:collapse/);
  assert.deepEqual(linhas.map((_, linha) => $(linha).children('td').length).get(), [3, 3, 2]);
  assert.deepEqual(linhas.eq(0).children('td').map((_, td) => $(td).attr('colspan')).get(), ['2', '2', '2']);
  assert.deepEqual(linhas.eq(1).children('td').map((_, td) => $(td).attr('colspan')).get(), ['2', '2', '2']);
  const chuva = linhas.eq(1).children('td').eq(1);
  assert.deepEqual(chuva.find('[data-email-rain-metric]').map((_, td) => $(td).attr('data-email-rain-metric')).get(), ['acumulado', 'probabilidade']);
  assert.match(chuva.text(), /CHUVA ACUMULADA\/DIA/);
  assert.match(chuva.text(), /PROBABILIDADE DE CHUVA/);
  assert.deepEqual(linhas.eq(2).children('td').map((_, td) => $(td).attr('colspan')).get(), ['3', '3']);
  assert.deepEqual(linhas.eq(2).children('td').map((_, td) => $(td).attr('width')).get(), ['50%', '50%']);
  assert.deepEqual(linhas.eq(2).children('td').map((_, td) => $(td).attr('valign')).get(), ['middle', 'middle']);
  assert.match(linhas.eq(2).children('td').eq(0).text(), /MAR — ALTURA MÁX\. DE ONDA/);
  assert.match(linhas.eq(2).children('td').eq(1).text(), /CONDIÇÃO GERAL/);
  assert.match(linhas.eq(2).children('td').eq(1).text(), /Previsão para o dia/);
  assert.doesNotMatch(linhas.eq(2).children('td').eq(1).text(), /Fonte de dados/);
  assert.equal($('.email-period-table, .email-period-title, .email-period-source').length, 0);
});

test('terceira linha mantém alinhamento e quebra uma condição geral longa', () => {
  const condicao = 'Muitas nuvens com pancadas de chuva e trovoadas isoladas durante o dia';
  const html = semImagem(renderEmailHtml(relatorio({ condicaoGeral: condicao })));
  const $ = cheerio.load(html);
  const linha = $('[data-email-metric-row="3"]');
  const celulas = linha.children('td');

  assert.equal(celulas.length, 2);
  assert.equal(celulas.eq(0).parent()[0], celulas.eq(1).parent()[0]);
  assert.match(celulas.eq(1).text(), new RegExp(condicao));
  for (const celula of celulas.toArray()) {
    assert.match($(celula).attr('style'), /overflow-wrap:anywhere/);
    assert.match($(celula).attr('style'), /word-break:break-word/);
  }
});

test('chuva acumulada/dia usa apenas previsão e nunca o acumulado observado', () => {
  const html = semImagem(renderEmailHtml(relatorio({
    precipitacaoDiariaMm: 91,
    precipitacaoTotalMm: 91,
    previsaoDias: [{ chuvaMm: 4.7 }],
  })));
  const $ = cheerio.load(html);
  const chuva = $('div').filter((_, elemento) => $(elemento).text().trim() === 'CHUVA ACUMULADA/DIA').first().closest('[data-email-rain-card]');

  assert.match(chuva.text(), /4\.7 mm/);
  assert.match(chuva.text(), /PROBABILIDADE DE CHUVA/);
  assert.match(chuva.text(), /85%/);
  assert.doesNotMatch(chuva.text(), /91 mm/);

  const indisponivel = semImagem(renderEmailHtml(relatorio({
    precipitacaoDiariaMm: 91,
    precipitacaoTotalMm: 91,
    previsaoDias: [],
    probabilidadeChuvaPrevista: null,
    chuvaPorPeriodo: [{ periodo: 'Manhã', precipitacaoMm: null }],
  })));
  const $indisponivel = cheerio.load(indisponivel);
  const cardIndisponivel = $indisponivel('div').filter((_, elemento) => $indisponivel(elemento).text().trim() === 'CHUVA ACUMULADA/DIA').first().closest('[data-email-rain-card]');
  assert.match(cardIndisponivel.text(), /Dado indisponível/);
  assert.doesNotMatch(cardIndisponivel.text(), /91 mm/);
});

test('previsão de todas as edições fica à direita, até 00h e com escrita padronizada', () => {
  for (const horarioAgendado of ['05:00', '09:00', '12:00', '15:00', '17:00', '20:00']) {
    const horaExibida = horarioAgendado.replace(':00', 'h');
    const frase = 'Previsão até 00h';
    const html = semImagem(renderEmailHtml(relatorio({ horarioAgendado, horaConsulta: horarioAgendado, previsaoAte: '00h' })));
    const $ = cheerio.load(html);
    const card = $('div').filter((_, elemento) => $(elemento).text().trim() === 'RAJADA PREVISTA').first().closest('td');
    const textoCard = card.text().replace(/\s+/g, ' ').trim();
    assert.equal(textoCard, 'RAJADA PREVISTA 36 km/h');
    const celulaFrase = $('td').filter((_, el) => $(el).text().trim() === frase);
    assert.equal(celulaFrase.length, 1);
    assert.equal(celulaFrase.attr('width'), '33.33%');
    assert.equal(celulaFrase.attr('align'), 'right');
    assert.match(celulaFrase.prev('td').text(), new RegExp(`Hora da consulta:\\s*${horaExibida} \\(Horário de Brasília\\)`));
    assert.doesNotMatch(celulaFrase.prev('td').text(), /(?:05|15):00/);
    const estiloConsulta = celulaFrase.prev('td').attr('style');
    const estiloPrevisao = celulaFrase.attr('style');
    for (const regra of [
      'padding:0 5px', 'color:#222222', 'font-family:Arial,sans-serif',
      'font-size:16px', 'font-weight:400', 'line-height:1.4',
    ]) {
      assert.ok(estiloConsulta.includes(regra), `Hora da consulta sem ${regra}`);
      assert.ok(estiloPrevisao.includes(regra), `Previsão sem ${regra}`);
    }
    assert.equal(celulaFrase.find('strong').length, 0);
    assert.equal(celulaFrase.prev('td').find('strong').attr('style'), 'font-weight:bold;');
    assert.ok(html.indexOf(frase) < html.indexOf('RAJADA PREVISTA'));
    assert.equal((html.match(new RegExp(frase, 'g')) || []).length, 1);
    assert.doesNotMatch(html, /\| Previsão até/);
    assert.match($.text(), /Fontes de dados:[^]*Open-Meteo/);
  }
});

test('fallback da probabilidade das 05h considera também o período da noite', () => {
  assert.equal(probabilidadeChuvaPrevista(relatorio({
    horarioAgendado: '05:00',
    probabilidadeChuvaPrevista: null,
    chuvaPorPeriodo: [
      { periodo: 'Manhã', janela: '05h–12h', probabilidade: 20 },
      { periodo: 'Tarde', janela: '12h–18h', probabilidade: 45 },
      { periodo: 'Noite', janela: '18h–00h', probabilidade: 90 },
    ],
  })), 90);
});

test('card de qualidade do ar exibe somente a classificação dinâmica', () => {
  const html = semImagem(renderEmailHtml(relatorio({
    qualidadeAr: {
      fonte: 'Open-Meteo Air Quality', pm25Medio: 27.4, pm25Periodo: 'média diária',
      aqiPm25: 42, pm25Classificacao: { nivel: 'Moderada' }, uvMax: 5,
      uvClassificacao: { nivel: 'Moderado' },
    },
  })));
  assert.ok(html.includes('QUALIDADE DO AR'));
  assert.ok(html.includes('Moderada'));
  assert.ok(!html.includes('QUALIDADE DO AR (PM2,5)'));
  assert.ok(!html.includes('27.4 µg/m³'));
});

test('card de qualidade do ar não classifica concentração sem AQI oficial', () => {
  const html = semImagem(renderEmailHtml(relatorio({
    qualidadeAr: { pm25Medio: 27.4, pm25Classificacao: { nivel: 'Moderada' } },
  })));
  assert.match(html, /QUALIDADE DO AR[\s\S]*Dado indisponível/);
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
  const tabela = $('div').filter((_, elemento) => $(elemento).text().trim() === 'PREVISÃO TEMP. MÍN/MÁX').first().closest('table');
  const segundaLinha = tabela.children('tbody').children('tr').eq(1).children('td').map((_, td) => $(td).text().replace(/\s+/g, ' ').trim()).get();
  assert.match(segundaLinha[0], /^QUALIDADE DO AR/);
  assert.match(segundaLinha[1], /^CHUVA ACUMULADA\/DIA/);
  assert.match(segundaLinha[2], /^CALOR/);
  assert.doesNotMatch(segundaLinha.join(' '), /ÍNDICE UV|11\.2/, 'o card não usa o índice UV');
  const vento = html.indexOf('VENTO — ATENÇÃO');
  const chuva = html.indexOf('CHUVA INTENSA — ALERTA');
  const uv = html.indexOf('ÍNDICE UV — ALERTA');
  assert.ok(uv >= 0 && uv < chuva && chuva < vento);
  assert.match(html, /Índice UV extremo/, 'o evento de UV continua no e-mail');
});

test('card CALOR usa somente o EHF oficial, sem ser elevado por temperatura ou UV', () => {
  const climaSaude = (previsaoDias, extra = {}) => ({ status: 'operacional', dados: {
    source: 'Clima e Saúde — Ministério da Saúde', dataConsulta: '2026-09-28',
    ehf: { classificacao: 'Sem excesso' }, previsaoDias, nivel: { grau: 'NORMAL' }, recomendacoes: [], ...extra,
  } });
  const celula = (html) => {
    const $ = cheerio.load(html);
    const tabela = $('div').filter((_, e) => $(e).text().trim() === 'PREVISÃO TEMP. MÍN/MÁX').first().closest('table');
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
  const temperaturaAlta = celula(renderEmailHtml(relatorio({
    ...base,
    tempMax: 40,
    qualidadeAr: { uvMax: 12, uvClassificacao: { nivel: 'Extremo' } },
    climaSaude: climaSaude([{ data: '2026-09-28', classificacao: 'Sem excesso' }]),
  })));
  assert.match(temperaturaAlta.text(), /Normal/);
  assert.ok(temperaturaAlta.html().includes(`color:${VISUAL_NIVEL.NORMAL.texto}`));
  // Coleta de outro dia sem previsão para hoje: indisponível, nunca "Normal".
  const semHoje = celula(renderEmailHtml(relatorio({ ...base, climaSaude: { status: 'degradado', dados: { source: 'Clima e Saúde — Ministério da Saúde', dataConsulta: '2026-09-25', ehf: { classificacao: 'Sem excesso' }, previsaoDias: [{ data: '2026-09-25', classificacao: 'Sem excesso' }] } } })));
  assert.match(semHoje.text(), /Dado indisponível/);
  assert.doesNotMatch(semHoje.text(), /Normal/);
});

test('dados ausentes mostram Dado indisponível sem fabricar números nem fontes', () => {
  const html = semImagem(renderEmailHtml(relatorio({
    condicaoGeral: null, tempMin: null, tempMax: null, umidadeMin: null, umidadeMax: null,
    precipitacaoTotalMm: null, ventoPorPeriodo: [], chuvaPorPeriodo: [], previsaoDias: [],
    qualidadeAr: null, mar: null, climaSaude: null,
    fontesPorCampo: {},
  })));
  const $ = cheerio.load(html);
  const grade = $('[data-email-metrics="true"]');
  assert.ok(html.includes('RAJADA PREVISTA'));
  assert.ok(html.includes('CHUVA ACUMULADA/DIA'));
  for (const rotulo of [
    'PREVISÃO TEMP. MÍN/MÁX', 'PREVISÃO UMIDADE MÍN/MÁX', 'RAJADA PREVISTA',
    'QUALIDADE DO AR', 'CHUVA ACUMULADA/DIA', 'CALOR',
    'MAR — ALTURA MÁX. DE ONDA', 'CONDIÇÃO GERAL',
  ]) {
    const card = grade.find('div').filter((_, elemento) => $(elemento).text().trim() === rotulo).first().closest('td');
    assert.match(card.text(), /Dado indisponível/, rotulo);
  }
  assert.ok(html.includes('INMET | Clima e Saúde — Ministério da Saúde | Open-Meteo — todos (previsão complementar, Air Quality / CAMS e Marine)'));
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
  assert.equal(aviso.find('[data-alert-title]').text().replace(/\s+/g, ' ').trim(), '● TEMPESTADE — ATENÇÃO');
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
  assert.ok(vento.text().replace(/\s+/g, ' ').includes('Fonte de dados: INMET — fonte prioritária consultada | Open-Meteo — previsão complementar'));
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

test('aviso oficial identifica INMET como previsão principal antes do complemento numérico', () => {
  const html = semImagem(renderEmailHtml(relatorio({
    rajadaMaxKmh: 49,
    fontesPorCampo: {
      rajadaMaxKmh: 'Open-Meteo — previsão complementar',
      'periodos.manha.rajadaMaxKmh': 'Open-Meteo — previsão complementar',
      'periodos.tarde.rajadaMaxKmh': 'Open-Meteo — previsão complementar',
      'periodos.noite.rajadaMaxKmh': 'Open-Meteo — previsão complementar',
    },
    avisosInmet: [{
      descricao: 'Tempestade', severidade: 'Perigo', inicio: '00:01', fim: '23:59',
      riscos: ['Ventos intensos.'], instrucoes: ['Busque abrigo.'],
    }],
  })));
  const $ = cheerio.load(html);
  const aviso = $('table[data-alert-card]').filter((_, card) => $(card).text().includes('Aviso: Tempestade')).first();
  const texto = aviso.text().replace(/\s+/g, ' ');
  assert.match(texto, /Fonte de dados: INMET/);
  assert.match(texto, /Fonte da previsão: INMET — previsão principal \| Open-Meteo — previsão complementar/);
  assert.doesNotMatch(texto, /Fonte da previsão: Open-Meteo — previsão complementar(?!\s*\|)/);
});

test('aviso INMET usa a cor do seu nível e a linha dinâmica fica escura sobre o fundo do nível', () => {
  for (const [evento, severidade, nivel] of [
    ['Baixa Umidade', 'Perigo Potencial', 'ATENÇÃO'],
    ['Chuvas Intensas', 'Perigo', 'ALERTA'],
    ['Tempestade', 'Grande Perigo', 'EMERGÊNCIA'],
    ['Vendaval', 'Perigo', 'ALERTA'],
  ]) {
    const html = semImagem(renderEmailHtml(relatorio({ avisosInmet: [{ descricao: evento, severidade }] })));
    const $ = cheerio.load(html);
    const card = $('table[data-alert-card]');
    const v = VISUAL_NIVEL[nivel];
    assert.equal(card.length, 1);
    assert.equal(card.attr('data-nivel'), nivel);
    assert.equal(card.find('[data-alert-title]').text().replace(/^●\s*/, '').trim(), `${evento.toUpperCase()} — ${nivel}`);
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
    tempMin: 21 + i, tempMax: 33 + i, condicao: i ? 'Condição futura exclusiva' : 'Condição do dia', chuvaMm: i, rajadaKmh: 30 + i,
  }));
  const manha = semImagem(renderEmailHtml(relatorio({ horarioAgendado: '05:00', previsaoDias: quatroDias, periodoCoberto: 'Hoje, das 05:00 até 00:00, mais os três dias seguintes' })));
  const tarde = semImagem(renderEmailHtml(relatorio({ horarioAgendado: '15:00', previsaoDias: quatroDias.slice(0, 2), periodoCoberto: 'Hoje, das 15:00 até 00:00, mais o dia seguinte', mudancasDia: ['Grau geral: ATENÇÃO → ALERTA.'] })));
  for (const html of [manha, tarde]) {
    assert.ok(!html.includes('Previsão para os próximos dias'));
    assert.ok(!html.includes('Condição futura exclusiva'));
    assert.ok(!html.includes('Dia +1'));
    assert.ok(!html.includes('2026-09-29'));
  }
  assert.ok(!tarde.includes('ATENÇÃO → ALERTA'));
  assert.ok(!tarde.includes('ATUALIZAÇÃO DE PREVISÃO'));
  assert.ok(tarde.includes('Fontes de dados:'));
  assert.ok(tarde.includes('Open-Meteo'));
});

test('HTML escapa textos externos sem transformar o e-mail em imagem', () => {
  const html = semImagem(renderEmailHtml(relatorio({ condicaoGeral: '<img src=x onerror=alert(1)>' })));
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(!html.includes('<img src=x onerror=alert(1)>'));
  assert.ok(html.includes('<table'));
});
