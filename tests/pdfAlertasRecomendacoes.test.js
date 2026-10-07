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

test("cada alerta traz ao lado, no mesmo bloco, todas as recomendações cadastradas", () => {
  const $ = cheerio.load(renderPdfHtml(relatorio({ severidade: { grau: "ALERTA", eventos: [eventoVento] } })));
  const bloco = $("table.alerta-bloco");
  assert.equal(bloco.length, 1);
  assert.match(bloco.find("td.alerta-col-card").text(), /VENTO — ALERTA/);
  assert.match(bloco.find("td.alerta-col-card").text(), /Rajada prevista: 48 km\/h/);
  const itens = bloco.find("td.alerta-col-rec li").map((_, li) => $(li).text()).get();
  assert.deepEqual(itens, recomendacoes("vento", "ALERTA"));
});

test("aviso INMET de chuva sem alerta equivalente da previsão traz as recomendações do nível oficial", () => {
  const html = renderPdfHtml(relatorio({ avisosInmet: [avisoChuva] }));
  const $ = cheerio.load(html);
  const bloco = $("table.alerta-bloco");
  assert.equal(bloco.length, 1);
  assert.match(bloco.find("td.alerta-col-card").text(), /Aviso oficial INMET/);
  assert.match(bloco.find("td.alerta-col-card").text(), /Chuva entre 30 e 60 mm\/h/, "texto oficial preservado");
  assert.equal(bloco.find(".alerta-rec-sub").text(), "CHUVA INTENSA:");
  const itens = bloco.find("td.alerta-col-rec li").map((_, li) => $(li).text()).get();
  assert.deepEqual(itens, recomendacoes("chuva", "ALERTA"));
});

test("aviso INMET de chuva não repete recomendações já listadas no alerta de chuva da previsão", () => {
  const $ = cheerio.load(renderPdfHtml(relatorio({
    severidade: { grau: "ALERTA", eventos: [eventoChuva] },
    avisosInmet: [avisoChuva],
  })));
  const todos = $("td.alerta-col-rec li").map((_, li) => $(li).text()).get();
  assert.equal(new Set(todos).size, todos.length, "nenhum item repetido");
  assert.deepEqual(todos, recomendacoes("chuva", "ALERTA"));
  assert.match($("table.alerta-bloco").last().text(), /já constam no alerta correspondente acima/);
});

test("cenário A: alerta NORMAL é removido antes da renderização do card", () => {
  const normal = { ...eventoVento, grau: "Normal", titulo: "VENTO — NORMAL", recomendacoes: [] };
  const html = renderPdfHtml(relatorio({
    horarioAgendado: null,
    tipoDocumento: TIPOS_DOCUMENTO.EXTRAORDINARIO,
    severidade: { grau: "NORMAL", eventos: [normal] },
  }));
  const $ = cheerio.load(html);
  assert.equal($("table.alerta-bloco").length, 0);
  assert.doesNotMatch(html, /VENTO — NORMAL|CONDIÇÕES METEOROLÓGICAS — NORMAL/);
});

for (const [horarioAgendado, tipoDocumento] of [
  ["05:00", TIPOS_DOCUMENTO.INFORMATIVO_05H],
  ["15:00", TIPOS_DOCUMENTO.INFORMATIVO_15H],
]) {
  test(`informativo programado das ${horarioAgendado} preserva o card NORMAL`, () => {
    const normal = { ...eventoVento, grau: "NORMAL", titulo: "VENTO — NORMAL", recomendacoes: [] };
    const html = renderPdfHtml(relatorio({ horarioAgendado, tipoDocumento, severidade: { grau: "NORMAL", eventos: [normal] } }));
    assert.match(html, /VENTO — NORMAL/);
    assert.doesNotMatch(html, /Não há recomendações cadastradas/);
  });
}

test("cenário B: ATENÇÃO mantém recomendação local e não a substitui pela orientação do INMET", () => {
  const local = { ...eventoVento, grau: "ATENÇÃO", titulo: "VENTO — ATENÇÃO", recomendacoes: ["Recomendação local cadastrada."] };
  const aviso = { descricao: "Vento Forte", severidade: "Perigo Potencial", instrucoes: ["Orientação oficial que é apenas fallback."] };
  const $ = cheerio.load(renderPdfHtml(relatorio({ severidade: { grau: "ATENÇÃO", eventos: [local] }, avisosInmet: [aviso] })));
  const itens = $("table.alerta-bloco").first().find("td.alerta-col-rec li").map((_, li) => $(li).text()).get();
  assert.deepEqual(itens, ["Recomendação local cadastrada."]);
});

for (const [nome, grau, severidade] of [
  ["cenário C", "ATENÇÃO", "Perigo Potencial"],
  ["cenário D", "ALERTA", "Perigo"],
]) {
  test(`${nome}: ${grau} sem recomendação local usa a orientação oficial do INMET`, () => {
    const evento = { ...eventoVento, grau, titulo: `VENTO — ${grau}`, recomendacoes: [] };
    const aviso = { descricao: "Vento Forte", severidade, instrucoes: ["Afaste-se de árvores e estruturas frágeis."] };
    const $ = cheerio.load(renderPdfHtml(relatorio({ severidade: { grau, eventos: [evento] }, avisosInmet: [aviso] })));
    const primeiroBloco = $("table.alerta-bloco").first();
    assert.match(primeiroBloco.find(".alerta-rec-titulo").text(), /Orientações oficiais do INMET/);
    assert.deepEqual(primeiroBloco.find("td.alerta-col-rec li").map((_, li) => $(li).text()).get(), ["Afaste-se de árvores e estruturas frágeis."]);
  });
}

test("cenário E: sem recomendação local nem orientação do INMET usa somente o fallback neutro", () => {
  const evento = { ...eventoVento, grau: "ATENÇÃO", titulo: "VENTO — ATENÇÃO", recomendacoes: [] };
  const html = renderPdfHtml(relatorio({ severidade: { grau: "ATENÇÃO", eventos: [evento] }, avisosInmet: [] }));
  const $ = cheerio.load(html);
  assert.deepEqual($("table.alerta-bloco").first().find("td.alerta-col-rec li").map((_, li) => $(li).text()).get(), [RECOMENDACAO_NEUTRA]);
  assert.doesNotMatch(html, /Não há recomendações cadastradas/);
});

test("títulos dos fenômenos ficam em caixa alta sem alterar o texto das recomendações", () => {
  const eventos = [
    { ...eventoVento, fenomeno: "Vento", titulo: "Vento — ALERTA", grau: "ALERTA", recomendacoes: ["Manter o monitoramento durante o dia."] },
    { ...eventoChuva, fenomeno: "Tempestade", titulo: "Tempestade — ATENÇÃO", grau: "ATENÇÃO", recomendacoes: ["Reforçar comunicação preventiva."] },
  ];
  const $ = cheerio.load(renderPdfHtml(relatorio({ severidade: { grau: "ALERTA", eventos } })));
  assert.deepEqual($(".alerta-rec-sub").map((_, el) => $(el).text()).get(), ["TEMPESTADE COM RAIOS:", "VENTO:"]);
  assert.deepEqual($(".alerta-rec li").map((_, el) => $(el).text()).get(), [
    "Reforçar comunicação preventiva.",
    "Manter o monitoramento durante o dia.",
  ]);
});

test("CSS mantém cada alerta com recomendações unido e reduz o espaço entre blocos", () => {
  const html = renderPdfHtml(relatorio());
  assert.match(html, /table\.alerta-bloco \{[^}]*margin: 10px 0[^}]*break-inside: avoid[^}]*page-break-inside: avoid/s);
  assert.doesNotMatch(html, /table\.alerta-bloco \{[^}]*page-break-before:\s*always/s);
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
