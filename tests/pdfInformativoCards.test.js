const test = require("node:test");
const assert = require("node:assert/strict");
const cheerio = require("cheerio");
const { renderPdfHtml } = require("../src/render/pdfTemplate");

function report(extra = {}) {
  return {
    cidade: { nome: "Rio de Janeiro", uf: "RJ", fuso: "America/Sao_Paulo" },
    dataFormatadaLonga: "sexta-feira, 9 de outubro de 2026", dataFormatadaCurta: "09/10/2026",
    horaConsulta: "15:00", previsaoAte: "00h", horarioAgendado: "15:00",
    tabelaTemperaturaUmidade: [{ fonte: "Clima e Saúde — Ministério da Saúde", tempMin: 23.2, tempMax: 38, umidadeMin: null, umidadeMax: null }],
    ventoPorPeriodo: [{ periodo: "Noite", janela: "18h–00h", direcao: "E", intensidade: "Fracos", rajadaMaxKmh: null, referenciaInmet: "E / Fracos" }],
    chuvaPorHora: [{ intervalo: "15:00–16:00", probabilidade: 30, precipitacaoMm: 1.2 }],
    chuvaPorPeriodo: [
      { periodo: "Manhã", janela: "05h–12h", probabilidade: 20, precipitacaoMm: 0.4, resumoInmet: "Nublado" },
      { periodo: "Tarde", janela: "12h–18h", probabilidade: 30, precipitacaoMm: 1.2, resumoInmet: "Chuva" },
      { periodo: "Noite", janela: "18h–00h", probabilidade: 10, precipitacaoMm: 0, resumoInmet: "Nublado" },
    ], mar: { periodos: [{ periodo: "Noite", estadoMar: "Leve", alturaMaxM: 0.7, periodoOndaS: 7, direcaoOnda: "SE", marulhoMaxM: 0.4 }], referenciaPonto: "costa" }, qualidadeAr: null,
    climaSaude: { status: "operacional", dados: { source: "Clima e Saúde — Ministério da Saúde", consultadoEm: "2026-10-09T12:00:00.000Z", temperatura: { minima: 23.2, maxima: 38 }, ehf: { valor: 4.57, classificacao: "Sem excesso" } } },
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

test("primeiro indicador de qualidade do ar não exibe o rótulo European AQI", () => {
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
    "42",
    "Moderada",
    "Classificação informada pela Open-Meteo/CAMS",
  ]);
  assert.doesNotMatch(primeiraLinha.text(), /European AQI/i);
});

test("qualidade do ar sem AQI oficial não atribui classificação CAMS", () => {
  const $ = cheerio.load(renderPdfHtml(report({
    qualidadeAr: { pm25Medio: 12, pm25Classificacao: { nivel: "Moderada" } },
  })));
  const primeiraLinha = $("h4.subsecao").filter((_, item) => $(item).text() === "Qualidade do Ar e Índice UV")
    .closest("section").find("tbody tr").first();
  assert.deepEqual(primeiraLinha.find("td").map((_, td) => $(td).text().trim()).get(), [
    "Qualidade do Ar", "—", "—", "Classificação indisponível",
  ]);
});

test("temperatura e umidade: quatro colunas sem coluna Fonte e fonte só na nota", () => {
  for (const horarioAgendado of ["05:00", "15:00"]) {
    const $ = cheerio.load(renderPdfHtml(report({
      horarioAgendado,
      tabelaTemperaturaUmidade: [{ fonte: "Clima e Saúde — Ministério da Saúde / Open-Meteo", tempMin: 23.2, tempMax: 38, umidadeMin: 84, umidadeMax: 97 }],
    })));
    const tabela = $("table.tabela-temp-umidade");
    assert.equal(tabela.length, 1);
    assert.deepEqual(tabela.find("th").map((_, th) => $(th).text()).get(), ["Temp. Mínima", "Temp. Máxima", "Umidade Mínima", "Umidade Máxima"]);
    assert.deepEqual(tabela.find("tbody td").map((_, td) => $(td).text()).get(), ["23,2°C", "38°C", "84%", "97%"]);
    assert.doesNotMatch(tabela.text(), /Clima e Saúde|Open-Meteo/);
    const bloco = tabela.closest("section");
    assert.equal(bloco.find(".subtitulo-tabela").text(), "Indicadores consolidados do período consultado.");
    assert.match(bloco.find(".fonte-tabela").text(), /^Fonte de dados: Clima e Saúde — Ministério da Saúde \/ Open-Meteo\./);
  }
});

test("tabela de calor exibe só temperatura e EHF, sem umidade nem períodos", () => {
  const html = renderPdfHtml(report());
  const $ = cheerio.load(html);
  const tabela = $("table.tabela-calor");
  assert.deepEqual(tabela.find("th").map((_, th) => $(th).text()).get(), [
    "Período", "Temperatura prevista (mín./máx.)", "Indicador de calor", "Classificação",
  ]);
  assert.deepEqual(tabela.find("tbody td").map((_, td) => $(td).text()).get(), [
    "Dia", "23.2 °C / 38 °C", "EHF 4.57", "Sem excesso",
  ]);
  assert.doesNotMatch(tabela.text(), /umidade relativa/i);
  assert.doesNotMatch(html, /não publicou umidade relativa/i);
  assert.match(html, /não publicou previsão por período/i);
});

test("chuva restaura a organização por manhã, tarde e noite", () => {
  const html = renderPdfHtml(report());
  assert.match(html, /Chuva acumulada\/hora/);
  assert.match(html, /<strong>MANHÃ<\/strong><br\/><small>05h–12h<\/small>/);
  assert.match(html, /<strong>TARDE<\/strong><br\/><small>12h–18h<\/small>/);
  assert.match(html, /<strong>NOITE<\/strong><br\/><small>18h–00h<\/small>/);
  assert.match(html, /1,2 mm/);
  assert.doesNotMatch(html, /15:00–16:00/);
});
