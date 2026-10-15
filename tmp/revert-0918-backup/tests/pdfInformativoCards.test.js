const test = require("node:test");
const assert = require("node:assert/strict");
const cheerio = require("cheerio");
const { renderPdfHtml } = require("../src/render/pdfTemplate");

function report(extra = {}) {
  return {
    cidade: { nome: "Rio de Janeiro", uf: "RJ", fuso: "America/Sao_Paulo" },
    dataFormatadaLonga: "sexta-feira, 9 de outubro de 2026", dataFormatadaCurta: "09/10/2026",
    horaConsulta: "15:00", previsaoAte: "00h", horarioAgendado: "15:00",
    tabelaTemperaturaUmidade: [{ fonte: "INMET — previsão oficial", tempMin: 23.2, tempMax: 38, umidadeMin: null, umidadeMax: null }],
    ventoPorPeriodo: [{ periodo: "Noite", janela: "18h–00h", direcao: "E", intensidade: "Fracos", rajadaMaxKmh: null, referenciaInmet: "E / Fracos" }],
    chuvaPorHora: [{ intervalo: "15:00–16:00", probabilidade: 30, precipitacaoMm: 1.2 }],
    chuvaPorPeriodo: [
      { periodo: "Manhã", janela: "05h–12h", probabilidade: 20, precipitacaoMm: 0.4, resumoInmet: "Nublado" },
      { periodo: "Tarde", janela: "12h–18h", probabilidade: 30, precipitacaoMm: 1.2, resumoInmet: "Chuva" },
      { periodo: "Noite", janela: "18h–00h", probabilidade: 10, precipitacaoMm: 0, resumoInmet: "Nublado" },
    ], mar: { periodos: [{ periodo: "Noite", estadoMar: "Leve", alturaMaxM: 0.7, periodoOndaS: 7, direcaoOnda: "SE", marulhoMaxM: 0.4 }], referenciaPonto: "costa" }, qualidadeAr: null,
    climaSaude: { status: "operacional", dados: { source: "Clima e Saúde — Ministério da Saúde", consultadoEm: "2026-10-09T12:00:00.000Z", ehf: { valor: 4.57, classificacao: "Sem excesso" }, riscoCombinado: "Sem risco" } },
    severidade: { grau: "NORMAL", eventos: [] }, avisosInmet: [], avisosInmetStatus: "operacional",
    divergencias: [], avisosColeta: [], fontesAutomatizadas: [], fontesManuais: [], fontesPorCampo: {},
    ...extra,
  };
}

test("cabeçalho usa a edição e a previsão na mesma linha", () => {
  const $ = cheerio.load(renderPdfHtml(report()));
  assert.match($(".referencia-edicao").text().replace(/\s+/g, " "), /Hora da consulta: 15:00 \(Horário de Brasília\) \| Previsão até 00h/);
});

test("condições de mar aparecem imediatamente após qualidade do ar e índice UV", () => {
  const html = renderPdfHtml(report({ qualidadeAr: { pm25Classificacao: {}, uvClassificacao: {} } }));
  const $ = cheerio.load(html);
  const titulos = $("h4.subsecao").map((_, h4) => $(h4).text()).get();
  const qualidade = titulos.indexOf("Qualidade do Ar e Índice UV");
  assert.ok(qualidade >= 0);
  assert.match(titulos[qualidade + 1], /^Condições de mar/);
});

test("qualidade do ar prioriza classificação e orientação simples, sem concentração técnica", () => {
  const $ = cheerio.load(renderPdfHtml(report({
    qualidadeAr: {
      aqiPm25: 42,
      pm25Classificacao: { nivel: "Moderada" },
      pm25Medio: 12,
      pm10Medio: 17,
      uvMax: 9,
      uvClassificacao: { nivel: "Muito alto" },
    },
  })));
  const primeiraLinha = $("h4.subsecao").filter((_, item) => $(item).text() === "Qualidade do Ar e Índice UV")
    .closest("section").find("tbody tr").first();
  assert.deepEqual(primeiraLinha.find("td").map((_, td) => $(td).text().trim()).get(), [
    "Qualidade do Ar",
    "Moderada",
    "Qualidade do ar moderada; atenção para pessoas mais sensíveis.",
  ]);
  assert.doesNotMatch($("h4.subsecao").filter((_, item) => $(item).text() === "Qualidade do Ar e Índice UV").closest("section").text(), /European AQI|PM2,5|PM10|µg\/m³|Diretriz OMS/i);
});

test("qualidade do ar sem AQI oficial não atribui classificação CAMS", () => {
  const $ = cheerio.load(renderPdfHtml(report({
    qualidadeAr: { pm25Medio: 12, pm25Classificacao: { nivel: "Moderada" } },
  })));
  const primeiraLinha = $("h4.subsecao").filter((_, item) => $(item).text() === "Qualidade do Ar e Índice UV")
    .closest("section").find("tbody tr").first();
  assert.deepEqual(primeiraLinha.find("td").map((_, td) => $(td).text().trim()).get(), [
    "Qualidade do Ar", "Classificação indisponível", "A fonte não publicou um índice classificável nesta emissão.",
  ]);
});

test("índice UV usa somente Clima e Saúde e apresenta indisponibilidade de forma curta", () => {
  const $ = cheerio.load(renderPdfHtml(report({
    indiceUv: { valorAtual: null, classificacao: null, motivo: "O portal não publicou índice UV." },
  })));
  const bloco = $("h4.subsecao").filter((_, item) => $(item).text() === "Qualidade do Ar e Índice UV").closest("section");
  const uv = bloco.find("tbody tr").eq(1).find("td").map((_, td) => $(td).text().trim()).get();
  assert.deepEqual(uv, ["Índice UV", "Índice UV indisponível", "Não publicado pelo Clima e Saúde nesta emissão."]);
  assert.match(bloco.find(".fonte-tabela").text(), /índice UV — Clima e Saúde/);
  assert.doesNotMatch(bloco.text(), /índice UV — Open-Meteo/i);
});

test("temperatura e umidade usam quatro colunas previstas e deixam a fonte na nota", () => {
  for (const horarioAgendado of ["05:00", "15:00"]) {
    const $ = cheerio.load(renderPdfHtml(report({
      horarioAgendado,
      tabelaTemperaturaUmidade: [{ fonte: "INMET — previsão oficial", natureza: "Previsão diária oficial", tempMin: 23.2, tempMax: 38, umidadeMin: 84, umidadeMax: 97 }],
    })));
    const tabela = $("table.tabela-temp-umidade");
    assert.equal(tabela.length, 1);
    assert.deepEqual(tabela.find("th").map((_, th) => $(th).text()).get(), ["Temp. Mínima", "Temp. Máxima", "Umidade Mínima", "Umidade Máxima"]);
    assert.deepEqual(tabela.find("tbody td").map((_, td) => $(td).text()).get(), ["23,2°C", "38°C", "84%", "97%"]);
    assert.doesNotMatch(tabela.text(), /Clima e Saúde|Open-Meteo/);
    const bloco = tabela.closest("section");
    assert.equal(bloco.find(".subtitulo-tabela").text(), "Indicadores consolidados do período consultado.");
    assert.equal(bloco.find(".fonte-tabela").text(), "Fonte de dados: INMET.");
  }
});

test("vento e chuva usam os cabeçalhos e a referência INMET solicitados", () => {
  const $ = cheerio.load(renderPdfHtml(report()));
  const vento = $("h4.subsecao").filter((_, item) => $(item).text() === "Vento por período").closest("section");
  assert.deepEqual(vento.find("thead th").map((_, th) => $(th).text()).get(), [
    "Período", "Direção", "Vento (velocidade média)", "Rajada prevista (máx.)", "Referência INMET",
  ]);
  assert.equal(vento.find("tbody tr").first().find("td").last().text(), "E / Fracos");
  const chuva = $("h4.subsecao").filter((_, item) => $(item).text() === "Chuva por período").closest("section");
  assert.deepEqual(chuva.find("thead th").map((_, th) => $(th).text()).get(), [
    "Período", "Probabilidade", "Chuva por período (mm)", "Resumo INMET",
  ]);
});

test("tabela de excesso de calor exibe apenas indicadores do Clima e Saúde", () => {
  const html = renderPdfHtml(report());
  const $ = cheerio.load(html);
  const tabela = $("table.tabela-calor");
  assert.deepEqual(tabela.find("th").map((_, th) => $(th).text()).get(), [
    "Período", "EHF", "Classificação", "Risco combinado",
  ]);
  assert.deepEqual(tabela.find("tbody td").map((_, td) => $(td).text()).get(), [
    "Dia", "4.57", "Sem excesso", "Sem risco",
  ]);
  assert.doesNotMatch(tabela.text(), /umidade relativa/i);
  assert.doesNotMatch(html, /não publicou umidade relativa/i);
  assert.match(html, /Fonte de dados: Clima e Saúde/);
});

test("chuva acumulada por hora usa a hora oficial de referência, sem agregado arbitrário", () => {
  const html = renderPdfHtml(report());
  assert.match(html, /Chuva acumulada\/Hora/);
  assert.match(html, /15:00–16:00/);
  assert.match(html, /1,2 mm/);
  assert.doesNotMatch(html, /<strong>MANHÃ<\/strong>/);
});
