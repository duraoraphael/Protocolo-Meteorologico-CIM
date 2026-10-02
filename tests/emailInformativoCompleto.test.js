const test = require('node:test');
const assert = require('node:assert/strict');
const cheerio = require('cheerio');
const { renderEmailHtml } = require('../src/render/emailTemplate');

function relatorio(sobrescritas = {}) {
  return {
    cidade: { nome: 'Rio de Janeiro', uf: 'RJ' },
    dataFormatadaLonga: 'segunda-feira, 28 de setembro de 2026',
    dataFormatadaCurta: '28/09/2026', horaConsulta: '10:09',
    condicaoGeral: 'Muitas nuvens com pancadas de chuva',
    tempMin: 21, tempMax: 33, umidadeMin: 55, umidadeMax: 100,
    precipitacaoTotalMm: 0,
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
      precipitacaoTotalMm: 'Open-Meteo', 'ar.pm25Medio': 'Open-Meteo Air Quality',
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
    'CHUVA ACUMULADA', '0 mm', 'ÍNDICE UV', '11.2',
    'MAR — ALTURA MÁX. DE ONDA', '0.7 m', 'CONDIÇÃO GERAL',
    'Fontes de dados:', 'INMET', 'Open-Meteo Air Quality', 'Open-Meteo Marine',
    'Informativo gerado automaticamente pelo Protocolo Meteorológico do COMPARTILHADO.',
  ]) assert.ok(html.includes(texto), texto);
  assert.match(html, /Fontes de dados:<\/strong><br>[^<]*INMET/);
  assert.ok(!html.includes('Rajada prevista/registrada'));
  assert.ok(!html.includes('QUALIDADE DO AR (PM2,5)') && !html.includes('14.5 µg/m³'));
  assert.ok(!html.includes('display:grid') && !html.includes('display:flex'));
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

test('ÍNDICE UV é a última célula e o evento UV fica após os demais sem reordená-los', () => {
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
  assert.match(segundaLinha[2], /^ÍNDICE UV/);
  const vento = html.indexOf('ATENÇÃO — VENTO');
  const chuva = html.indexOf('ALERTA — CHUVA');
  const uv = html.indexOf('ALERTA — ÍNDICE UV ELEVADO');
  assert.ok(vento < chuva && chuva < uv);
  assert.match(html, /11\.2/);
  assert.match(html, /Extremo/);
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
  const alerta = html.indexOf('ALERTA — VENTO');
  const aviso = html.indexOf('AVISO OFICIAL INMET');
  const recomendacoes = html.indexOf('Recomendações - Protocolo Meteorológico do COMPARTILHADO');
  const fontes = html.indexOf('Fontes de dados:');
  assert.ok(alerta > 0 && aviso > alerta && recomendacoes > aviso && fontes > recomendacoes);
  assert.ok(!html.includes('Previsão para os próximos dias'));
  assert.equal((html.match(/Tempestade —/g) || []).length, 1);
  assert.ok(html.includes('Motivo do aviso:'));
  assert.ok(html.includes('Vigência: 14:00 até 18:00'));
  assert.ok(html.includes('Instruções oficiais:'));
  assert.ok(html.includes('Busque abrigo.'));
  assert.ok(html.includes('Fonte: INMET'));
  assert.ok(html.includes('Fonte de dados: Open-Meteo'));
  assert.ok(html.includes('border:1.5px solid #D32F2F'));
  assert.ok(!html.includes('Fonte de critério') && !html.includes('A condição atingiu'));
});

test('aviso oficial INMET reutiliza exatamente o componente visual dos demais cards', () => {
  const html = semImagem(renderEmailHtml(relatorio({
    severidade: { grau: 'ALERTA', eventos: [{
      tipo: 'ventoForte', titulo: 'ALERTA — VENTO', descricao: 'Rajada prevista: 41 km/h',
      fonteDados: 'Open-Meteo', recomendacoes: [],
    }] },
    avisosInmet: [{ descricao: 'Baixa Umidade', severidade: 'Perigo Potencial', riscos: ['Risco à saúde.'] }],
  })));
  const $ = cheerio.load(html);
  const tituloLocal = $('div').filter((_, elemento) => $(elemento).text().trim() === 'ALERTA — VENTO').first();
  const tituloInmet = $('div').filter((_, elemento) => $(elemento).text().trim() === 'AVISO OFICIAL INMET').first();
  const cardLocal = tituloLocal.closest('table');
  const cardInmet = tituloInmet.closest('table');
  assert.equal(cardInmet.attr('style'), cardLocal.attr('style'));
  assert.equal(cardInmet.find('td').first().attr('style'), cardLocal.find('td').first().attr('style'));
  assert.equal(tituloInmet.attr('style'), tituloLocal.attr('style'));
});

test('título do INMET fica vermelho e a linha dinâmica do aviso fica escura sobre o fundo branco', () => {
  for (const [evento, severidade] of [
    ['Baixa Umidade', 'Perigo Potencial'],
    ['Chuvas Intensas', 'Perigo'],
    ['Tempestade', 'Grande Perigo'],
  ]) {
    const html = semImagem(renderEmailHtml(relatorio({ avisosInmet: [{ descricao: evento, severidade }] })));
    const $ = cheerio.load(html);
    const titulo = $('div').filter((_, elemento) => $(elemento).text().trim() === 'AVISO OFICIAL INMET').first();
    const linha = $('div').filter((_, elemento) => $(elemento).text().trim() === `${evento} — ${severidade}`).first();
    assert.match(titulo.attr('style'), /color:#D32F2F;.*font:bold/);
    assert.match(linha.attr('style'), /color:#222222;/);
    assert.match(linha.find('strong').attr('style'), /color:#222222;/);
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
