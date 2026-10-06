const test = require('node:test');
const assert = require('node:assert/strict');
const cheerio = require('cheerio');
const { renderPdfHtml } = require('../src/render/pdfTemplate');

function relatorio(alteracoes = {}) {
  return {
    cidade: { nome: 'Rio de Janeiro', uf: 'RJ' },
    dataFormatadaLonga: 'terça-feira, 29 de setembro de 2026',
    dataFormatadaCurta: '29/09/2026', horaConsulta: '11:22',
    condicaoGeral: 'Nublado a encoberto',
    tabelaTemperaturaUmidade: [], ventoPorPeriodo: [], chuvaPorPeriodo: [],
    mar: null, qualidadeAr: null,
    severidade: { grau: 'ALERTA', eventos: [
      { tipo: 'uvAlto', grau: 'ALERTA', titulo: 'ALERTA — ÍNDICE UV ELEVADO',
        descricao: 'Índice UV extremo previsto.', janela: '12:00',
        fonteDados: 'Open-Meteo Air Quality', recomendacoes: ['Evitar exposição ao sol.'] },
      { tipo: 'ventoModerado', grau: 'ATENÇÃO', titulo: 'ATENÇÃO — VENTO',
        descricao: 'Rajada prevista: 36 km/h', janela: 'Tarde',
        fonteDados: 'Open-Meteo', recomendacoes: ['Manter monitoramento.'] },
      { tipo: 'avisoInmet', grau: 'ALERTA', titulo: 'ALERTA — AVISO OFICIAL INMET',
        descricao: 'Aviso oficial INMET ativo; consulte o texto completo.' },
    ] },
    avisosInmet: [{ descricao: 'Tempestade', severidade: 'Perigo Potencial',
      inicio: '29/09/2026 09:25', fim: '29/09/2026 23:59',
      riscos: ['Chuva entre 20 e 30 mm/h.'], instrucoes: ['Busque abrigo.'] }],
    climaSaude: { status: 'operacional', dados: {
      nivel: { grau: 'NORMAL' }, ehf: { classificacao: 'Sem excesso' },
      temperatura: { maxima: 38.6 }, riscoCombinado: 'Sem Risco',
      geoses: { valor: null }, source: 'Clima e Saúde — Ministério da Saúde',
      recomendacoes: ['Manter hidratação.'],
    } },
    divergencias: [], avisosColeta: [
      'Windy: dados de teste embaralhados recusados.',
      'Windy: dados de teste embaralhados recusados.',
    ],
    fontesAutomatizadas: [{ nome: 'Open-Meteo', uso: 'Previsão' }],
    fontesManuais: [],
    deslocamento: { pedestres: [], transporte: [], condutores: [] },
    edificacao: [],
    ...alteracoes,
  };
}

test('cards locais, calor e aviso oficial seguem o mesmo padrão, sem duplicar INMET', () => {
  const html = renderPdfHtml(relatorio());
  const $ = cheerio.load(html);
  assert.equal($('.evento-card').length, 4);
  assert.equal($('.aviso-inmet.evento-card').length, 1);
  assert.equal($('.evento-card').filter((_, e) => $(e).text().includes('CALOR / RISCO À SAÚDE')).length, 1);
  assert.equal(html.includes('Aviso oficial INMET ativo; consulte o texto completo.'), false);
  assert.equal(html.includes('Rajada prevista/registrada'), false);
  assert.equal(html.includes('Windy: dados de teste'), false);
  assert.match(html, /border-color:#D32F2F/);
  assert.match(html, /border-color:#F57C00/);
  assert.match(html, /border-color:#2E7D32/);
  assert.match(html, /\.evento-card \{[^}]*page-break-inside: avoid/s);
  assert.match(html, /\.aviso-inmet \{[^}]*page-break-inside: avoid/s);
  assert.equal($('h4.subsecao').filter((_, e) => $(e).text() === 'CALOR / RISCO À SAÚDE').length, 0);
  assert.match(html, /<strong>Motivo do aviso:<\/strong> Chuva entre 20 e 30 mm\/h\./);
  assert.match(html, /<strong>Instruções oficiais:<\/strong> Busque abrigo\./);
  assert.match(html, /Recomendações - Protocolo Meteorológico do COMPARTILHADO/);
});

test('PDF identifica dado marítimo armazenado com horário de Brasília', () => {
  const html = renderPdfHtml(relatorio({
    mar: {
      fonte: 'Open-Meteo Marine', alturaMaxDiaM: 0.7, estadoMarDia: 'Leve',
      desatualizado: true, ultimaAtualizacao: '2026-10-01T09:00:00.000Z',
      periodos: [{ periodo: 'Manhã', estadoMar: 'Leve', alturaMaxM: 0.7, periodoOndaS: 7, direcaoOnda: 'SE', marulhoMaxM: 0.5 }],
    },
  }));
  assert.match(html, /Dado armazenado/);
  assert.match(html, /01\/10\/2026 06:00/);
  assert.doesNotMatch(html, /2026-10-01T09:00:00\.000Z/);
});

test('aviso e calor ausentes não geram cards falsos; Windy só aparece com dados úteis', () => {
  const base = relatorio({
    avisosInmet: [], severidade: { grau: 'NORMAL', eventos: [] },
    climaSaude: { status: 'indisponivel', mensagem: 'Dados do Clima e Saúde indisponíveis nesta atualização.', dados: null },
  });
  const html = renderPdfHtml(base);
  const $ = cheerio.load(html);
  assert.equal($('.aviso-inmet').length, 0);
  assert.equal($('.evento-card').length, 1);
  assert.equal($('.evento-card').first().text().includes('CONDIÇÕES METEOROLÓGICAS — NORMAL'), true);
  assert.equal($('.clima-indisponivel').length, 1);
  assert.equal(html.includes('Sem excesso'), false);
  assert.equal(html.includes('Windy: dados de teste'), false);

  const comWindy = renderPdfHtml(relatorio({ fontesAutomatizadas: [{ nome: 'Windy (gfs)', uso: 'Dados válidos' }] }));
  assert.equal((comWindy.match(/Windy: dados de teste embaralhados recusados\./g) || []).length, 1);
});

test('aviso oficial sem evento local não vira condição NORMAL', () => {
  const html = renderPdfHtml(relatorio({
    severidade: { grau: 'ALERTA', eventos: [{ tipo: 'avisoInmet', grau: 'ALERTA' }] },
    avisosInmet: [{ descricao: 'Tempestade', severidade: 'Perigo', inicio: '09:00', fim: '18:00', riscos: ['Risco oficial'] }],
  }));
  assert.equal(html.includes('CONDIÇÕES METEOROLÓGICAS — NORMAL'), false);
  assert.equal((html.match(/Aviso oficial INMET<\/div>/g) || []).length, 1);
});

test('PDF ordena qualidade do ar, particulados e deixa o índice UV na última linha', () => {
  const html = renderPdfHtml(relatorio({
    qualidadeAr: {
      pm25Medio: 42.6,
      pm10Medio: 55.2,
      pm25Classificacao: { nivel: 'Muito Ruim' },
      uvMax: 11.2,
      horaPicoUv: '12:00',
      uvClassificacao: { nivel: 'Extremo' },
    },
  }));
  const $ = cheerio.load(html);
  const titulo = $('h4.subsecao').filter((_, elemento) => $(elemento).text() === 'Qualidade do Ar e Índice UV');
  const linhas = titulo.next('table').find('tbody tr');
  assert.match(linhas.eq(0).text(), /QUALIDADE DO AR.*Muito Ruim/s);
  assert.match(linhas.eq(1).text(), /PM2,5.*42\.6 µg\/m³/s);
  assert.match(linhas.eq(2).text(), /PM10.*55\.2 µg\/m³/s);
  assert.match(linhas.last().text(), /Índice UV.*11\.2.*12:00.*Extremo.*Faixas OMS/s);
});

test('PDF move o evento UV para depois dos demais preservando a ordem relativa', () => {
  const html = renderPdfHtml(relatorio());
  const vento = html.indexOf('VENTO — ATENÇÃO');
  const uv = html.indexOf('ÍNDICE UV — ALERTA');
  assert.ok(vento >= 0 && uv > vento);
  assert.match(html.slice(uv), /Índice UV extremo previsto/);
});

test('ressalva aparece uma vez depois das fontes manuais', () => {
  const html = renderPdfHtml(relatorio({
    divergencias: ['As fontes divergem.'],
    fontesManuais: [{ nome: 'Defesa Civil', uso: 'Conferência manual' }],
  }));
  assert.equal((html.match(/Ressalva sobre divergência entre fontes/g) || []).length, 1);
  assert.ok(html.indexOf('Integradas à coleta automática') < html.indexOf('Verificação manual (não integradas)'));
  assert.ok(html.indexOf('Verificação manual (não integradas)') < html.indexOf('Ressalva sobre divergência entre fontes'));
});

test('sem fontes manuais, ressalva permanece depois das fontes automatizadas', () => {
  const html = renderPdfHtml(relatorio({
    divergencias: ['As fontes divergem.'],
    fontesManuais: [],
  }));
  assert.equal((html.match(/Ressalva sobre divergência entre fontes/g) || []).length, 1);
  assert.ok(html.indexOf('Integradas à coleta automática') < html.indexOf('Ressalva sobre divergência entre fontes'));
  assert.equal(html.includes('Verificação manual (não integradas)'), false);
});

test('PDF omite exclusivamente o bloco de condição geral', () => {
  const html = renderPdfHtml(relatorio({ condicaoGeral: 'Nublado a encoberto' }));
  assert.equal(html.includes('Condição geral'), false);
  assert.equal(html.includes('Condição geral do céu'), false);
  assert.equal(html.includes('Nublado a encoberto'), false);
  assert.match(html, /Previsão por dia|Temperatura e umidade/);
});
