// Painel: todas as informações do e-mail do informativo aparecem nos cards
// do site (mesmos valores e mesmos cards de alerta).
const test = require("node:test");
const assert = require("node:assert/strict");

const { montarOcorrencias } = require("../src/logic/ocorrenciasPainel");
const { normalizarAviso } = require("../src/sources/inmet");
const { conteudoEmailPainel, comConteudoEmail } = require("../src/logic/conteudoEmailPainel");
const { renderEmailHtml } = require("../src/render/emailTemplate");
const { carregarPainel } = require("./helpers/fakeDom");

function avisoBruto(sobrescrever = {}) {
  return {
    id_aviso: 28388, id_sequencia: 1, codigo: "urn:oid:2.49.0.0.76.0.2026.28388.1",
    descricao: "Tempestade", severidade: "Perigo",
    inicio: "2099-10-01 09:29", fim: "2099-10-01 23:59",
    estados: "Rio de Janeiro",
    municipios: "Rio de Janeiro - RJ (3304557)",
    geocodes: "3304557",
    riscos: ["Chuva entre 30 e 60 mm/h, ventos intensos (60-100 km/h) e queda de granizo."],
    instrucoes: ["Não se abrigue debaixo de árvores.", "Desligue aparelhos elétricos."],
    encerrado: false,
    ...sobrescrever,
  };
}

function relatorio(sobrescrever = {}) {
  const r = {
    cidade: { chave: "rio_de_janeiro", nome: "Rio de Janeiro", uf: "RJ" },
    horaConsulta: "12:00",
    dataFormatadaLonga: "sexta-feira, 16 de outubro de 2026",
    geradoEmISO: "2026-10-16T15:00:00.000Z",
    severidade: { grau: "NORMAL", eventos: [] },
    avisosInmet: [normalizarAviso(avisoBruto())],
    avisosInmetStatus: "operacional",
    climaSaude: null,
    tempMin: 22, tempMax: 29, umidadeMin: 70, umidadeMax: 100,
    ventoPorPeriodo: [{ periodo: "Tarde", janela: "12h–18h", rajadaMaxKmh: 37 }],
    chuvaPorPeriodo: [
      { periodo: "Manhã", janela: "05h–12h", probabilidade: 20, precipitacaoMm: 0.1 },
      { periodo: "Tarde", janela: "12h–18h", probabilidade: 88, precipitacaoMm: 0.6 },
      { periodo: "Noite", janela: "18h–00h", probabilidade: 59, precipitacaoMm: 0.4 },
    ],
    previsaoDias: [{ data: "2026-10-16", chuvaMm: 1.1 }],
    fontesPorCampo: { precipitacaoTotalMm: "Open-Meteo — previsão complementar", "periodos.tarde.probabilidadeChuva": "Open-Meteo — previsão complementar" },
    condicaoGeral: "Muitas nuvens com pancadas de chuva",
    ...sobrescrever,
  };
  r.ocorrencias = montarOcorrencias(r);
  return r;
}

function telaDoPainel(r) {
  return carregarPainel().executar("Dashboard.home")(comConteudoEmail(r));
}

const decodificar = (html) => html.replace(/&quot;/g, "\"").replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

test("conteúdo do painel usa exatamente os valores e cards do e-mail", () => {
  const r = relatorio();
  const ce = conteudoEmailPainel(r);
  const htmlEmail = renderEmailHtml(r);
  assert.equal(ce.chuvaPrevistaMm, 1.1);
  assert.match(htmlEmail, /CHUVA ACUMULADA\/DIA<\/div>\s*<div[^>]*>1\.1 mm/);
  assert.equal(ce.probabilidadeChuva, 88);
  assert.match(htmlEmail, /PROBABILIDADE DE CHUVA<\/div>\s*<div[^>]*>88%/);
  assert.equal(ce.frasePrevisao, "Previsão até 00h", "fora das edições agendadas o painel cobre até 00h");
  assert.equal(ce.cards.length, 1);
  assert.equal(ce.cards[0].fenomeno, "tempestade");
  for (const linha of ce.cards[0].linhas) {
    assert.ok(decodificar(htmlEmail).includes(linha.texto.split("\n")[0]), `linha do e-mail: ${linha.rotulo}`);
  }
});

test("site mostra no card da ocorrência todas as linhas e recomendações do card do e-mail", () => {
  const r = relatorio();
  const tela = decodificar(telaDoPainel(r));
  const [card] = conteudoEmailPainel(r).cards;

  assert.equal((tela.match(/class="ocorrencia /g) || []).length, 1, "o card do e-mail entra na ocorrência do mesmo fenômeno, sem duplicar");
  for (const linha of card.linhas) {
    if (linha.rotulo) assert.ok(tela.includes(`<strong>${linha.rotulo}:</strong>`), `rótulo ${linha.rotulo}`);
    for (const parte of linha.texto.split("\n")) assert.ok(tela.includes(parte), `texto de ${linha.rotulo}`);
  }
  assert.ok(card.recomendacoes?.itens.length);
  assert.match(tela, /<h4>Recomendações<\/h4>/);
  for (const item of card.recomendacoes.itens) assert.ok(tela.includes(item), `recomendação: ${item}`);
  assert.match(tela, /Ver detalhes/, "o botão de detalhes continua disponível");
});

test("indicadores do site incluem chuva prevista, probabilidade, hora da consulta e fontes do e-mail", () => {
  const tela = decodificar(telaDoPainel(relatorio()));
  assert.match(tela, /<h2 class="rotulo">Chuva prevista\/dia<\/h2><\/div><div class="valor">1\.1 <small>mm<\/small>/);
  assert.match(tela, /<h2 class="rotulo">Probabilidade de chuva<\/h2><\/div><div class="valor">88%/);
  assert.match(tela, /Hora da consulta:<\/strong> 12:00 \(Horário de Brasília\) <span>\| Previsão até 00h<\/span>/);
  assert.match(tela, /Fontes de dados:<\/strong> INMET \| Clima e Saúde — Ministério da Saúde \| Open-Meteo/);
});

test("card do e-mail sem ocorrência correspondente vira card próprio; mudanças do dia aparecem", () => {
  const r = relatorio({ avisosInmet: [], mudancasDia: ["Grau geral: NORMAL → ATENÇÃO."] });
  const painel = { ...comConteudoEmail(r) };
  painel.conteudoEmail.cards = [{
    fenomeno: "outro", nivel: "ATENÇÃO", titulo: "ATENÇÃO — TESTE", rotuloOrigem: "Previsão",
    linhas: [{ rotulo: "Janela prevista", texto: "Tarde (12h–18h)", lista: null, multilinha: false }],
    recomendacoes: { titulo: "Protocolo", itens: ["Acompanhar."] },
  }];
  const tela = decodificar(carregarPainel().executar("Dashboard.home")(painel));
  assert.match(tela, /ATENÇÃO — TESTE/);
  assert.match(tela, /<strong>Janela prevista:<\/strong> Tarde \(12h–18h\)/);
  assert.match(tela, /Mudanças do dia[\s\S]*Grau geral: NORMAL → ATENÇÃO\./);
});

test("textos da fonte são escapados nos cards do site", () => {
  const r = relatorio({ avisosInmet: [normalizarAviso(avisoBruto({ riscos: ["<img src=x onerror=alert(1)> chuva forte"] }))] });
  const tela = telaDoPainel(r);
  assert.doesNotMatch(tela, /<img src=x/);
  assert.match(tela, /&lt;img src=x onerror=alert\(1\)&gt; chuva forte/);
});

test("relatório sem conteudoEmail (versão antiga) continua renderizando", () => {
  const r = relatorio();
  const tela = carregarPainel().executar("Dashboard.home")(r);
  assert.match(tela, /Ocorrências em destaque/);
  assert.doesNotMatch(tela, /Chuva prevista\/dia/);
});
