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

test("ordem obrigatória: mar, calor, qualidade do ar", () => {
  const html = renderPdfHtml(report({ qualidadeAr: { pm25Classificacao: {}, uvClassificacao: {} } }));
  const pos = ["Condições de mar", "Condições de Calor", "Qualidade do Ar e Índice UV"].map((x) => html.indexOf(x));
  assert.ok(pos.every((x) => x >= 0));
  assert.deepEqual([...pos].sort((a, b) => a - b), pos);
});

test("tabela de calor não fabrica umidade nem períodos", () => {
  const html = renderPdfHtml(report());
  assert.match(html, /Dia \(sem detalhamento por período\)/);
  assert.match(html, /EHF 4\.57/);
  assert.match(html, /não publicou umidade relativa nem previsão por período/i);
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
