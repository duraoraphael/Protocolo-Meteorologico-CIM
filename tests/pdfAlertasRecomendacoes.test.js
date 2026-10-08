const test = require("node:test");
const assert = require("node:assert/strict");
const cheerio = require("cheerio");
const { renderPdfHtml } = require("../src/render/pdfTemplate");
const { recomendacoes, recomendacoesChuvaAvisoInmet } = require("../src/logic/inmetAlertRules");
const { RECOMENDACAO_NEUTRA, TIPOS_DOCUMENTO } = require("../src/logic/alertPresentation");

function relatorio(alteracoes = {}) {
  return {
    cidade: { nome: "Rio de Janeiro", uf: "RJ", fuso: "America/Sao_Paulo" },
    dataFormatadaLonga: "terça-feira, 6 de outubro de 2026",
    dataFormatadaCurta: "06/10/2026", horaConsulta: "05:00",
    horarioAgendado: "05:00",
    periodoCoberto: "hoje, das 05h até 00h",
    tabelaTemperaturaUmidade: [{ fonte: "Open-Meteo", tempMin: 20, tempMax: 28, umidadeMin: 60, umidadeMax: 90 }],
    ventoPorPeriodo: [
      { periodo: "Manhã", janela: "05h–12h", direcao: "E", intensidade: "Moderado (até 22 km/h)", velocidadeMaxKmh: 22, rajadaMaxKmh: 35, referenciaInmet: null },
      { periodo: "Tarde", janela: "12h–18h", direcao: "SE", intensidade: "Moderado (até 25 km/h)", velocidadeMaxKmh: 25, rajadaMaxKmh: 48, referenciaInmet: null },
    ],
    chuvaPorPeriodo: [{ periodo: "Manhã", janela: "05h–12h", probabilidade: 40, precipitacaoMm: 8, resumoInmet: null }],
    fontesPorCampo: { "periodos.manha.rajadaMaxKmh": "Open-Meteo", "periodos.tarde.rajadaMaxKmh": "Open-Meteo" },
    mar: null, qualidadeAr: null,
    severidade: { grau: "NORMAL", eventos: [] },
    avisosInmet: [],
    divergencias: [], avisosColeta: [],
    fontesAutomatizadas: [{ nome: "Open-Meteo", uso: "Previsão" }], fontesManuais: [],
    deslocamento: { pedestres: ["a"], transporte: ["b"], condutores: ["c"] },
    edificacao: [{ titulo: "Boas práticas", itens: ["d"] }],
    ...alteracoes,
  };
}

const eventoVento = {
  assinatura: "vento", fenomeno: "vento", tipo: "ventoForte", grau: "ALERTA",
  titulo: "VENTO - NÍVEL DE ALERTA", descricao: "Rajada prevista: 48 km/h", janela: "Tarde",
  fonteDados: "Open-Meteo", recomendacoes: recomendacoes("vento", "ALERTA"),
};
const eventoChuva = {
  assinatura: "chuva", fenomeno: "chuva", tipo: "chuvaModerada", grau: "ATENÇÃO",
  titulo: "CHUVA INTENSA - NÍVEL DE ATENÇÃO", descricao: "Acumulado diário previsto: 25 mm", janela: "Manhã",
  fonteDados: "Open-Meteo", recomendacoes: recomendacoes("chuva", "ATENÇÃO"),
};
const avisoChuva = {
  descricao: "Chuvas Intensas", severidade: "Perigo",
  inicio: "06/10/2026 10:00", fim: "07/10/2026 10:00",
  riscos: ["Chuva entre 30 e 60 mm/h ou 50 e 100 mm/dia."], instrucoes: ["Evite enfrentar o mau tempo."],
};

const recItens = ($, card) => $(card).find(".card-alerta-rec li").map((_, li) => $(li).text()).get();

test("cada alerta traz, dentro do mesmo card, todas as recomendações cadastradas", () => {
  const $ = cheerio.load(renderPdfHtml(relatorio({ severidade: { grau: "ALERTA", eventos: [eventoVento] } })));
  const card = $("section.card-alerta");
  assert.equal(card.length, 1);
  assert.equal($("table.alerta-bloco").length, 0, "sem o bloco lateral antigo");
  assert.match(card.find(".card-alerta-titulo").text(), /VENTO — ALERTA/);
  assert.match(card.text(), /Rajada prevista: 48 km\/h/);
  assert.equal(card.find(".card-alerta-rec-titulo").text(), "RECOMENDAÇÕES");
  assert.deepEqual(recItens($, card), recomendacoes("vento", "ALERTA"));
});

test("aviso INMET de chuva sem alerta equivalente da previsão traz as recomendações do nível oficial", () => {
  const $ = cheerio.load(renderPdfHtml(relatorio({ avisosInmet: [avisoChuva] })));
  // Sem evento da previsão, o programado mantém o card de condições normais — por último.
  assert.deepEqual($("section.card-alerta").map((_, c) => $(c).attr("data-nivel")).get(), ["ALERTA", "NORMAL"]);
  const card = $("section.card-alerta").first();
  assert.match(card.find(".card-alerta-meta").text(), /Aviso oficial INMET/);
  assert.match(card.find(".card-alerta-titulo").text(), /CHUVA INTENSA — ALERTA/);
  assert.match(card.text(), /Chuva entre 30 e 60 mm\/h/, "texto oficial preservado");
  assert.deepEqual(recItens($, card), recomendacoes("chuva", "ALERTA"));
});

test("alerta da previsão e aviso INMET do mesmo fenômeno trazem cada um a lista completa do seu nível", () => {
  const $ = cheerio.load(renderPdfHtml(relatorio({
    severidade: { grau: "ALERTA", eventos: [eventoChuva] },
    avisosInmet: [avisoChuva],
  })));
  const cards = $("section.card-alerta");
  assert.deepEqual(cards.map((_, c) => $(c).attr("data-nivel")).get(), ["ALERTA", "ATENÇÃO"], "ALERTA (INMET) antes de ATENÇÃO");
  assert.deepEqual(recItens($, cards[0]), recomendacoes("chuva", "ALERTA"));
  assert.deepEqual(recItens($, cards[1]), recomendacoes("chuva", "ATENÇÃO"));
  for (const card of cards.toArray()) {
    const itens = recItens($, card);
    assert.equal(new Set(itens).size, itens.length, "nenhum item repetido dentro do card");
  }
  assert.doesNotMatch($.html(), /já constam no alerta correspondente/);
});

test("cenário A: alerta NORMAL é removido antes da renderização do card", () => {
  const normal = { ...eventoVento, grau: "Normal", titulo: "VENTO — NORMAL", recomendacoes: [] };
  const html = renderPdfHtml(relatorio({
    horarioAgendado: null,
    tipoDocumento: TIPOS_DOCUMENTO.EXTRAORDINARIO,
    severidade: { grau: "NORMAL", eventos: [normal] },
  }));
  const $ = cheerio.load(html);
  assert.equal($("section.card-alerta").length, 0);
  assert.doesNotMatch(html, /VENTO — NORMAL|CONDIÇÕES METEOROLÓGICAS — NORMAL/);
});

for (const [horarioAgendado, tipoDocumento] of [
  ["05:00", TIPOS_DOCUMENTO.INFORMATIVO_05H],
  ["15:00", TIPOS_DOCUMENTO.INFORMATIVO_15H],
]) {
  test(`informativo programado das ${horarioAgendado} preserva o card NORMAL, sem recomendações`, () => {
    const normal = { ...eventoVento, grau: "NORMAL", titulo: "VENTO — NORMAL", recomendacoes: [] };
    const html = renderPdfHtml(relatorio({ horarioAgendado, tipoDocumento, severidade: { grau: "NORMAL", eventos: [normal] } }));
    const $ = cheerio.load(html);
    assert.match(html, /VENTO — NORMAL/);
    assert.equal($("section.card-alerta[data-nivel=NORMAL] .card-alerta-rec").length, 0);
    assert.doesNotMatch(html, /Não há recomendações cadastradas/);
  });
}

test("cenário B: ATENÇÃO mantém recomendação local e não a substitui pela orientação do INMET", () => {
  const local = { ...eventoVento, grau: "ATENÇÃO", titulo: "VENTO — ATENÇÃO", recomendacoes: ["Recomendação local cadastrada."] };
  const aviso = { descricao: "Vento Forte", severidade: "Perigo Potencial", instrucoes: ["Orientação oficial que é apenas fallback."] };
  const $ = cheerio.load(renderPdfHtml(relatorio({ severidade: { grau: "ATENÇÃO", eventos: [local] }, avisosInmet: [aviso] })));
  assert.deepEqual(recItens($, $("section.card-alerta").first()), ["Recomendação local cadastrada."]);
});

for (const [nome, grau, severidade] of [
  ["cenário C", "ATENÇÃO", "Perigo Potencial"],
  ["cenário D", "ALERTA", "Perigo"],
]) {
  test(`${nome}: ${grau} sem recomendação local usa a orientação oficial do INMET`, () => {
    const evento = { ...eventoVento, grau, titulo: `VENTO — ${grau}`, recomendacoes: [] };
    const aviso = { descricao: "Vento Forte", severidade, instrucoes: ["Afaste-se de árvores e estruturas frágeis."] };
    const $ = cheerio.load(renderPdfHtml(relatorio({ severidade: { grau, eventos: [evento] }, avisosInmet: [aviso] })));
    const primeiro = $("section.card-alerta").first();
    assert.match(primeiro.find(".card-alerta-rec-origem").text(), /Orientações oficiais do INMET/);
    assert.deepEqual(recItens($, primeiro), ["Afaste-se de árvores e estruturas frágeis."]);
  });
}

test("cenário E: sem recomendação local nem orientação do INMET usa somente o fallback neutro", () => {
  const evento = { ...eventoVento, grau: "ATENÇÃO", titulo: "VENTO — ATENÇÃO", recomendacoes: [] };
  const html = renderPdfHtml(relatorio({ severidade: { grau: "ATENÇÃO", eventos: [evento] }, avisosInmet: [] }));
  const $ = cheerio.load(html);
  assert.deepEqual(recItens($, $("section.card-alerta").first()), [RECOMENDACAO_NEUTRA]);
  assert.doesNotMatch(html, /Não há recomendações cadastradas/);
});

test("títulos FENÔMENO — NÍVEL em caixa alta, por severidade, sem alterar o texto das recomendações", () => {
  const eventos = [
    { ...eventoChuva, fenomeno: "Tempestade", titulo: "Tempestade — ATENÇÃO", grau: "ATENÇÃO", recomendacoes: ["Reforçar comunicação preventiva."] },
    { ...eventoVento, fenomeno: "Vento", titulo: "Vento — ALERTA", grau: "ALERTA", recomendacoes: ["Manter o monitoramento durante o dia."] },
  ];
  const $ = cheerio.load(renderPdfHtml(relatorio({ severidade: { grau: "ALERTA", eventos } })));
  assert.deepEqual($(".card-alerta-titulo").map((_, el) => $(el).text().replace("●", "").trim()).get(), ["VENTO — ALERTA", "TEMPESTADE COM RAIOS — ATENÇÃO"]);
  assert.deepEqual($(".card-alerta-rec li").map((_, el) => $(el).text()).get(), [
    "Manter o monitoramento durante o dia.",
    "Reforçar comunicação preventiva.",
  ]);
});

test("CSS: card inteiro na próxima página quando cabe; maior que a página continua sem título isolado", () => {
  const html = renderPdfHtml(relatorio());
  assert.match(html, /\.card-alerta \{[^}]*break-inside: avoid[^}]*page-break-inside: avoid[^}]*box-decoration-break: clone/s);
  assert.match(html, /\.card-alerta-topo \{ break-inside: avoid/);
  assert.match(html, /\.card-alerta-rec-cab \{ break-after: avoid/);
  assert.match(html, /\.card-alerta-rec li \{[^}]*break-inside: avoid/);
  assert.doesNotMatch(html, /\.card-alerta \{[^}]*page-break-before:\s*always/s);
});

test("regra de chuva do INMET: só avisos de chuva, só severidades reconhecidas", () => {
  assert.equal(recomendacoesChuvaAvisoInmet({ descricao: "Baixa Umidade", severidade: "Perigo" }), null);
  assert.equal(recomendacoesChuvaAvisoInmet({ descricao: "Chuvas Intensas", severidade: "Indefinida" }), null);
  assert.equal(recomendacoesChuvaAvisoInmet({ descricao: "Tempestade", severidade: "Perigo", riscos: ["Queda de granizo."] }), null);
  assert.equal(recomendacoesChuvaAvisoInmet({ descricao: "Tempestade", severidade: "Grande Perigo", riscos: ["Risco de alagamentos."] }).grau, "EMERGÊNCIA");
  assert.equal(recomendacoesChuvaAvisoInmet({ descricao: "Acumulado de Chuva", severidade: "Perigo Potencial" }).grau, "ATENÇÃO");
});

test("títulos, tabelas e fontes de dados ficam no mesmo bloco, com a fonte logo abaixo", () => {
  const $ = cheerio.load(renderPdfHtml(relatorio({
    previsaoDias: [{ periodo: "Hoje (05h–00h)", data: "2026-10-06", condicao: "Chuva", tempMin: 20, tempMax: 28, chuvaMm: 8, rajadaKmh: 48 }],
  })));
  const blocos = $("section.bloco-tabela");
  assert.ok(blocos.length >= 4);
  blocos.each((_, bloco) => {
    const filhos = $(bloco).children();
    const tabela = filhos.filter("table");
    if (!tabela.length) return;
    const titulo = filhos.filter("h3, h4").length;
    const fonte = $(bloco).children("p.fonte-tabela");
    if (fonte.length) assert.ok(fonte.prev().is("table"), "fonte imediatamente abaixo da tabela");
    if (titulo) assert.ok(filhos.first().is("h3, h4"), "título dentro do bloco da tabela");
  });
  assert.equal($("section.bloco-tabela").first().children("h3").text(), "1. Previsão");
  const vento = blocos.filter((_, b) => $(b).find("h4").text() === "Vento por período");
  assert.match(vento.find("p.fonte-tabela").text(), /Vento: maior velocidade média horária/);
  assert.match(vento.find("p.fonte-tabela").text(), /Rajada: maior rajada prevista na mesma janela/);
  assert.match(vento.text(), /Tarde\s*12h–18h/);
  assert.match($.html(), /\.bloco-tabela \{ break-inside: avoid/);
  assert.match($.html(), /\.bloco-lista \{ break-inside: auto/);
  assert.match($.html(), /\.bloco-lista li \{ break-inside: avoid/);
  assert.match($.html(), /thead \{ display: table-header-group; \}/);
});
