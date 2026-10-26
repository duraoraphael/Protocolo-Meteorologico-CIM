const test = require('node:test');
const assert = require('node:assert/strict');
const cheerio = require('cheerio');
const { carregarPainel } = require('./helpers/fakeDom');
const { renderEmailHtml } = require('../src/render/emailTemplate');
const { renderPdfHtml } = require('../src/render/pdfTemplate');

test('site e PDF usam observação; e-mail usa previsão INMET do mesmo relatório', () => {
  const fonte = 'INMET — estação automática (A636)';
  const relatorio = {
    cidade: { chave: 'rio_de_janeiro', nome: 'Rio de Janeiro', uf: 'RJ', fuso: 'America/Sao_Paulo' },
    dataFormatadaLonga: 'sexta-feira, 23 de outubro de 2026', dataFormatadaCurta: '23/10/2026',
    horaConsulta: '15:30', geradoEmISO: '2026-10-23T18:30:00Z',
    tempMin: 21.4, tempMax: 27.1, umidadeMin: 55, umidadeMax: 82,
    temperaturaObservadaMinC: 21.4, temperaturaObservadaMaxC: 27.1,
    umidadeObservadaMinPct: 55, umidadeObservadaMaxPct: 82,
    coberturaTemperaturaObservada: { amostras: 2, horasEsperadas: 15, parcial: true },
    coberturaUmidadeObservada: { amostras: 2, horasEsperadas: 15, parcial: true },
    tabelaTemperaturaUmidade: [{ fonte, tempMin: 21.4, tempMax: 27.1, umidadeMin: 55, umidadeMax: 82 }],
    fontesPorCampo: { tempMin: fonte, tempMax: fonte, umidadeMin: fonte, umidadeMax: fonte },
    inmetObservacao: { status: 'operacional', observacao: { medidoEm: '2026-10-23T18:00:00Z', estacao: { codigo: 'A636', nome: 'JACAREPAGUÁ' } } },
    inmetPrevisao: { data: '23/10/2026', dias: [
      { dataBr: '23/10/2026', tempMin: 20, tempMax: 25, umidadeMin: 76, umidadeMax: 98 },
    ] },
    condicaoGeral: 'Nublado', severidade: { grau: 'NORMAL', eventos: [] },
    ventoPorPeriodo: [], chuvaPorPeriodo: [], previsaoDias: [], avisosInmet: [], ocorrencias: [],
    fontes: [], fontesAutomatizadas: [], fontesManuais: [], mar: null, qualidadeAr: null,
  };
  const site = carregarPainel().executar('Dashboard.home')(relatorio);
  const email = cheerio.load(renderEmailHtml(relatorio));
  const pdf = cheerio.load(renderPdfHtml(relatorio));

  assert.match(site, /Temperatura observada mín\/máx/);
  assert.match(site, /21,4° \/ 27,1°/);
  assert.match(site, /55% \/ 82%/);
  assert.match(site, /Parcial · 2\/15 leituras/);
  assert.match(site, /INMET — estação automática \(A636\)/);
  assert.match(email('[data-email-metrics="true"]').text(), /PREVISÃO TEMP\. MÍN\/MÁX\s*20° \/ 25°C/);
  assert.match(email('[data-email-metrics="true"]').text(), /PREVISÃO UMIDADE MÍN\/MÁX\s*76% \/ 98%/);
  assert.doesNotMatch(email('[data-email-metrics="true"]').text(), /21,4° \/ 27,1°C|55% \/ 82%/);
  assert.deepEqual(pdf('table.tabela-temp-umidade tbody td').map((_, td) => pdf(td).text()).get(), ['21,4°C', '27,1°C', '55%', '82%']);
  assert.match(pdf('table.tabela-temp-umidade').closest('section').text(), /parcial \(2\/15 leituras\)/);
});
