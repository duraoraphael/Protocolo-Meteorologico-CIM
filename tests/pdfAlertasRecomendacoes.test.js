const test = require("node:test");
const assert = require("node:assert/strict");
const cheerio = require("cheerio");
const { renderPdfHtml } = require("../src/render/pdfTemplate");

function report(extra = {}) {
  return {
    cidade: { nome: "Rio de Janeiro", uf: "RJ", fuso: "America/Sao_Paulo" },
    dataFormatadaLonga: "sexta-feira, 9 de outubro de 2026",
    dataFormatadaCurta: "09/10/2026", horaConsulta: "05:00", previsaoAte: "15h",
    tabelaTemperaturaUmidade: [], ventoPorPeriodo: [], chuvaPorPeriodo: [], chuvaPorHora: [],
    mar: null, qualidadeAr: null, severidade: { grau: "EMERGÊNCIA", eventos: [{
      tipo: "uvAlto", grau: "EMERGÊNCIA", titulo: "ÍNDICE UV ELEVADO — EMERGÊNCIA",
      descricao: "UV extremo", recomendacoes: ["Cessar trabalho externo."],
    }] },
    avisosInmet: [{ descricao: "Tempestade", severidade: "Perigo", inicio: "10:00", fim: "15:00", riscos: ["Ventos intensos."] }],
    avisosInmetStatus: "operacional", divergencias: [], avisosColeta: [],
    fontesAutomatizadas: [], fontesManuais: [], deslocamento: { pedestres: ["Não sair."] },
    edificacao: [{ titulo: "Ventos", itens: ["Suspender atividades."] }],
    ...extra,
  };
}

test("PDF remove todos os cards e recomendações operacionais", () => {
  const html = renderPdfHtml(report());
  const $ = cheerio.load(html);
  assert.equal($(".card-alerta,[data-alert-card]").length, 0);
  assert.doesNotMatch($("body").text(), /Cessar trabalho externo|Recomendações de Segurança|Não sair|Suspender atividades/);
});

test("PDF preserva avisos oficiais em tabela técnica, sem card", () => {
  const html = renderPdfHtml(report());
  assert.match(html, /Avisos oficiais do INMET — RIO DE JANEIRO\/RJ/);
  assert.match(html, /Tempestade/);
  assert.match(html, /Perigo/);
  assert.match(html, /10:00 — 15:00/);
  assert.doesNotMatch(html, /Ventos intensos/);
  assert.doesNotMatch(html, /data-nivel=/);
});

test("PDF sem aviso explicita estado da consulta", () => {
  const html = renderPdfHtml(report({ avisosInmet: [], avisosInmetStatus: "operacional" }));
  assert.match(html, /Nenhum aviso oficial do INMET aplicável à base no período consultado/);
});
