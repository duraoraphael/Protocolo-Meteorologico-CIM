const test = require("node:test");
const assert = require("node:assert/strict");

const AlertTitle = require("../public/alert-title");
const { renderPdfHtml } = require("../src/render/pdfTemplate");
const { renderEmailHtml } = require("../src/render/emailTemplate");
const { renderAlertEmailHtml } = require("../src/render/alertEmailTemplate");
const { carregarPainel } = require("./helpers/fakeDom");

const TITULOS = [
  "TEMPESTADE COM RAIOS — EMERGÊNCIA",
  "VENTO — ALERTA",
  "QUALIDADE DO AR — ATENÇÃO",
  "CALOR / RISCO À SAÚDE — NORMAL",
];
const ANTIGOS = [
  "EMERGÊNCIA — TEMPESTADE COM RAIOS",
  "ALERTA — VENTO",
  "ATENÇÃO — QUALIDADE DO AR",
  "NORMAL — CALOR / RISCO À SAÚDE",
];

function relatorio() {
  const eventos = [
    { tipo: "raios", grau: "EMERGÊNCIA", titulo: "EMERGÊNCIA — TEMPESTADE COM RAIOS", descricao: "Raios previstos.", fonteDados: "Open-Meteo", recomendacoes: [] },
    { tipo: "ventoForte", grau: "ALERTA", titulo: "ALERTA — VENTO", descricao: "Rajadas previstas.", fonteDados: "Open-Meteo", recomendacoes: [] },
    { tipo: "qualidadeArRuim", grau: "ATENÇÃO", titulo: "ATENÇÃO — QUALIDADE DO AR", descricao: "PM2,5 elevado.", fonteDados: "Open-Meteo Air Quality", recomendacoes: [] },
  ];
  return {
    cidade: { nome: "Rio de Janeiro", uf: "RJ" },
    dataFormatadaLonga: "segunda-feira, 5 de outubro de 2026", dataFormatadaCurta: "05/10/2026", horaConsulta: "15:00",
    tempMin: 20, tempMax: 31, umidadeMin: 45, umidadeMax: 88, precipitacaoTotalMm: 0,
    ventoPorPeriodo: [], chuvaPorPeriodo: [], tabelaTemperaturaUmidade: [], mar: null, qualidadeAr: null,
    severidade: { grau: "EMERGÊNCIA", eventos }, eventoMaisRelevante: eventos[0],
    avisosInmet: [], divergencias: [], avisosColeta: [], fontesAutomatizadas: [], fontesManuais: [],
    deslocamento: { pedestres: [], transporte: [], condutores: [] }, edificacao: [],
    climaSaude: { status: "operacional", dados: { nivel: { grau: "NORMAL" }, temperatura: {}, ehf: { classificacao: "Sem excesso" }, riscoCombinado: "Sem risco", source: "Clima e Saúde", recomendacoes: [] } },
    ocorrencias: [
      { id: "1", grau: "EMERGÊNCIA", rotulo: "Tempestade com raios", icone: "storm", resumo: "Raios", validade: "Hoje", fontes: ["Open-Meteo"] },
      { id: "2", grau: "ALERTA", rotulo: "Vento", icone: "wind", resumo: "Rajadas", validade: "Hoje", fontes: ["Open-Meteo"] },
      { id: "3", grau: "ATENÇÃO", rotulo: "Qualidade do ar", icone: "leaf", resumo: "PM2,5", validade: "Hoje", fontes: ["Open-Meteo"] },
      { id: "4", grau: "NORMAL", rotulo: "Calor / risco à saúde", icone: "thermometer", resumo: "Sem excesso", validade: "Hoje", fontes: ["Clima e Saúde"] },
    ],
  };
}

function conferir(html, nome) {
  for (const titulo of TITULOS) assert.ok(html.includes(titulo), `${nome}: ${titulo}`);
  for (const antigo of ANTIGOS) assert.ok(!html.includes(antigo), `${nome}: remove ${antigo}`);
}

test("formatador compartilhado produz os quatro títulos canônicos obrigatórios", () => {
  assert.deepEqual([
    AlertTitle.formatarTitulo("Tempestade com raios", "Emergência"),
    AlertTitle.formatarTitulo("Rajadas de vento", "Alerta"),
    AlertTitle.formatarTitulo("Qualidade do ar", "Atenção"),
    AlertTitle.formatarTitulo("Calor e saúde", "Normal"),
  ], TITULOS);
});

test("painel, informativo, PDF e e-mail de alerta usam parâmetro antes da classificação", () => {
  const r = relatorio();
  conferir(carregarPainel().executar("Dashboard.home")(r), "painel");
  conferir(renderEmailHtml(r), "informativo");
  conferir(renderPdfHtml(r), "PDF");
  conferir(renderAlertEmailHtml({ cidade: r.cidade, report: r, alertas: [
    { tipo: "Tempestade com raios", grau: "EMERGÊNCIA" },
    { tipo: "Vento", grau: "ALERTA" },
    { tipo: "Qualidade do ar", grau: "ATENÇÃO" },
    { tipo: "Calor / risco à saúde", grau: "NORMAL" },
  ] }), "e-mail de alerta");
});
