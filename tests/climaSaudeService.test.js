const test = require('node:test');
const assert = require('node:assert/strict');
const {
  interpretarHtml, nivelEhf, recomendacoesCalor, consultar, lerArmazenado, validarUrl,
} = require('../src/sources/climaSaudeService');
const { CIDADES } = require('../src/config/cities');
const { resumo, compararComManha } = require('../src/logic/scheduledReport');
const { detectarAlertasGraves, filtrarNovidades } = require('../src/logic/alertWatcher');
const { renderPdfHtml } = require('../src/render/pdfTemplate');
const { renderEmailHtml } = require('../src/render/emailTemplate');
const { renderAlertEmailHtml } = require('../src/render/alertEmailTemplate');
const { carregarPainel } = require('./helpers/fakeDom');
const { montarOcorrencias } = require('../src/logic/ocorrenciasPainel');

function pagina({ ehf = 'Severo', risco = 'Alto', valor = '7.76', temperatura = true, geoses = true } = {}) {
  return `<html><body><section><h1>Petrópolis</h1><p>RJ · Sudeste</p>
    ${ehf == null ? '' : `<span role="status" aria-label="EHF: ${ehf}">EHF: ${ehf}</span>`}
    ${risco == null ? '' : `<span role="status" aria-label="Risco Combinado: ${risco}">Risco: ${risco}</span>`}
    <div><div><span>29 set 2026</span></div><div><span>EHF</span><span>${valor}</span><span>${ehf || ''}</span></div>
    ${temperatura ? '<div><span>Média </span><span>27.6°</span><span>Hoje </span><span>34.3°</span><span>(mín 21.0°)</span></div>' : ''}</div>
    <button aria-label="2026-09-30: Extremo, 38°"></button>
    ${geoses ? '<div><p>Vulnerabilidade social (GeoSES)</p><span>0.10 (Moderado)</span></div>' : ''}
    </section></body></html>`;
}
const parametros = { url: 'https://clima.saude.gov.br/rj/petropolis?modo=ehf', consultadoEm: '2026-09-29T10:00:00.000Z' };
const cidade = { chave: 'petropolis', nome: 'Petrópolis', uf: 'RJ', climaSaudeUrl: parametros.url };

test('EHF define apenas seu próprio nível, com recomendações acumulativas', () => {
  for (const [entrada, grau, protocolo, quantidade] of [
    ['Sem excesso', 'NORMAL', null, 0], ['Baixo', 'ATENÇÃO', 'P1', 3],
    ['Severo', 'ALERTA', 'P2', 10], ['Extremo', 'EMERGÊNCIA', 'P3', 13],
  ]) {
    const nivel = nivelEhf(entrada);
    assert.equal(nivel.grau, grau);
    assert.equal(nivel.protocolo, protocolo);
    assert.equal(recomendacoesCalor(nivel).length, quantidade);
  }
  assert.equal(nivelEhf('desconhecido'), null);
});

test('interpreta HTML SSR semanticamente e deixa ausências como null', () => {
  const completo = interpretarHtml(pagina(), parametros);
  assert.equal(completo.municipio, 'Petrópolis');
  assert.equal(completo.uf, 'RJ');
  assert.deepEqual(completo.ehf, { valor: 7.76, classificacao: 'Severo' });
  assert.equal(completo.riscoCombinado, 'Alto');
  assert.deepEqual(completo.temperatura, { media: 27.6, maxima: 34.3, minima: 21 });
  assert.deepEqual(completo.geoses, { valor: 0.1, classificacao: 'Moderado' });
  assert.equal(completo.previsaoDias[0].data, '2026-09-30');
  const parcial = interpretarHtml(pagina({ risco: null, temperatura: false, geoses: false, valor: '—' }), parametros);
  assert.equal(parcial.riscoCombinado, null);
  assert.deepEqual(parcial.temperatura, { media: null, maxima: null, minima: null });
  assert.deepEqual(parcial.geoses, { valor: null, classificacao: null });
  assert.equal(parcial.ehf.valor, null);
});

test('HTML alterado ou EHF ausente não vira Sem excesso', () => {
  assert.throws(() => interpretarHtml('<html><h1>Petrópolis</h1></html>', parametros), /classificação EHF/);
  assert.throws(() => interpretarHtml(pagina({ ehf: null }), parametros), /classificação EHF/);
});

test('valida URL e não consulta base sem configuração', () => {
  assert.throws(() => validarUrl('http://clima.saude.gov.br/rj/petropolis'), /inválida/);
  assert.throws(() => validarUrl('https://outro.example/rj/petropolis'), /inválida/);
  assert.equal(lerArmazenado({ chave: 'x' }).status, 'nao_configurada');
  assert.equal(CIDADES.cabiunas.climaSaudeMunicipio, 'Macaé');
});

test('falha de rede, timeout e HTTP não-200 preservam último válido sem fabricar dado novo', async () => {
  const anterior = interpretarHtml(pagina({ ehf: 'Severo' }), parametros);
  for (const fetchFn of [
    async () => { throw new Error('rede indisponível'); },
    async () => { throw Object.assign(new Error('timeout'), { name: 'TimeoutError' }); },
    async () => ({ status: 503 }),
  ]) {
    const saida = await consultar(cidade, { fetchFn, carregar: () => ({ petropolis: anterior }), salvar: () => assert.fail('não deve gravar'), tentativas: 1 });
    assert.equal(saida.status, 'degradado');
    assert.equal(saida.dados.ehf.classificacao, 'Severo');
    assert.equal(saida.ultimoValido.ehf.classificacao, 'Severo');
    assert.match(saida.mensagem, /última coleta válida de \d{2}\/\d{2}\/\d{4}/i);
  }
});

test('timeout real aborta a requisição dentro do limite', async () => {
  const saida = await consultar(cidade, {
    fetchFn: (_, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })),
    carregar: () => ({}), salvar: () => assert.fail('não deve gravar'), tentativas: 1, timeoutMs: 5,
  });
  assert.equal(saida.status, 'indisponivel');
  assert.equal(saida.dados, null);
});

test('coleta válida persiste e risco combinado não altera grau EHF', async () => {
  let estado = {};
  const saida = await consultar(cidade, {
    fetchFn: async () => ({ status: 200, text: async () => pagina({ ehf: 'Baixo', risco: 'Muito Alto' }) }),
    carregar: () => estado, salvar: (novo) => { estado = novo; }, tentativas: 1,
  });
  assert.equal(saida.status, 'operacional');
  assert.equal(saida.dados.nivel.protocolo, 'P1');
  assert.equal(estado.petropolis.riscoCombinado, 'Muito Alto');
});

test('05h→15h informa mudança e alerta de calor só em transição', () => {
  const baixo = interpretarHtml(pagina({ ehf: 'Baixo' }), parametros);
  const severo = interpretarHtml(pagina({ ehf: 'Severo' }), parametros);
  const base = { severidade: { grau: 'NORMAL', eventos: [] }, climaSaude: { status: 'operacional', dados: baixo } };
  const manha = resumo(base);
  const tarde = resumo({ ...base, climaSaude: { status: 'operacional', dados: severo } });
  assert.ok(compararComManha(manha, tarde).some((x) => x.includes('ATENÇÃO P1 → ALERTA P2')));
  const alerta = detectarAlertasGraves(base).find((a) => a.assinatura === 'calor-ehf');
  assert.equal(alerta.grau, 'ATENÇÃO');
  const estado = { 'petropolis|calor-ehf': { gravidade: 'atencao', grau: 'ATENÇÃO' } };
  assert.equal(filtrarNovidades('petropolis', [alerta], estado).length, 0);
  const agravado = detectarAlertasGraves({ ...base, climaSaude: { status: 'operacional', dados: severo } }).filter((a) => a.assinatura === 'calor-ehf');
  assert.equal(filtrarNovidades('petropolis', agravado, estado)[0].motivo, 'agravou');
  const htmlAlerta = renderAlertEmailHtml({ cidade, report: { dataFormatadaCurta: '29/09/2026', horaConsulta: '15:00' }, alertas: agravado });
  assert.match(htmlAlerta, /CALOR \/ RISCO À SAÚDE — ALERTA/);
  assert.match(htmlAlerta, /Protocolo aplicável:<\/strong> P2/);
  assert.equal(detectarAlertasGraves({ ...base, climaSaude: { status: 'indisponivel', dados: null } }).some((a) => a.assinatura === 'calor-ehf'), false);
});

test('PDF, e-mail e painel exibem bloco próprio sem alterar severidade meteorológica', () => {
  const dados = interpretarHtml(pagina(), parametros);
  const report = {
    cidade: { chave: 'petropolis', nome: 'Petrópolis', uf: 'RJ' },
    dataFormatadaLonga: 'terça-feira, 29 de setembro de 2026', dataFormatadaCurta: '29/09/2026', horaConsulta: '07:00',
    condicaoGeral: 'Ensolarado', tempMin: 20, tempMax: 30, umidadeMin: 40, umidadeMax: 80,
    precipitacaoTotalMm: 0, tabelaTemperaturaUmidade: [], ventoPorPeriodo: [], chuvaPorPeriodo: [],
    mar: null, qualidadeAr: null, severidade: { grau: 'NORMAL', eventos: [] }, avisosInmet: [],
    divergencias: [], avisosColeta: [], deslocamento: { pedestres: [], transporte: [], condutores: [] }, edificacao: [],
    fontesAutomatizadas: [], fontesManuais: [], fontesPorCampo: {}, monitoramentoApis: [],
    climaSaude: { status: 'operacional', dados },
  };
  for (const html of [renderPdfHtml(report), renderEmailHtml(report)]) {
    assert.match(html, /CALOR \/ RISCO À SAÚDE|Calor \/ risco à saúde/);
    assert.match(html, /ALERTA/);
    assert.match(html, /RISCO COMBINADO À SAÚDE/);
    assert.match(html, /Recomendações - Protocolo Meteorológico do COMPARTILHADO/);
  }
  // Painel: calor em ALERTA vira card na área de destaque e no card compacto;
  // risco combinado e recomendações ficam em "Ver detalhes".
  report.ocorrencias = montarOcorrencias(report);
  const painel = carregarPainel();
  const tela = painel.executar('Dashboard.home')(report);
  const calor = report.ocorrencias.find((o) => o.fenomeno === 'calor');
  assert.equal(calor.grau, 'ALERTA');
  assert.match(tela, /aria-label="CALOR \/ RISCO À SAÚDE — ALERTA"/);
  assert.match(tela, /CALOR \/ RISCO À SAÚDE — ALERTA/);
  assert.doesNotMatch(tela, /Previsão Clima e Saúde/, 'lista de vários dias fora do painel');
  const detalhe = painel.executar('Dashboard.details')(report, `ocorrencia:${calor.id}`);
  assert.match(detalhe, /Risco combinado à saúde/);
  assert.match(detalhe, /Recomendações - Protocolo Meteorológico do COMPARTILHADO/);
  assert.equal(report.severidade.grau, 'NORMAL');
});
