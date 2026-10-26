const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { renderPdfHtml } = require("../src/render/pdfTemplate");
const { gerarPdfBuffer, fecharNavegador } = require("../src/render/pdfGenerator");

const PASTA = path.join(__dirname, "..", "artifacts", "auditoria-alertas-0815");

function previsaoD3() {
  return {
    fonte: "INMET / Open-Meteo Forecast — evidência sem consulta externa",
    status: "ok",
    consultadoEm: "2026-10-21T11:00:00.000Z",
    fuso: "America/Sao_Paulo",
    localidade: { nome: "Macaé", uf: "RJ" },
    fontesCampo: {
      temperatura: "INMET", umidade: "INMET", rajada: "Open-Meteo Forecast",
      chuva: "Open-Meteo Forecast", probabilidadeChuva: "Open-Meteo Forecast", uv: "Informação indisponível",
      condicao: "INMET",
    },
    dias: [
      { data: "2026-10-22", dataFormatada: "22/10/2026", diaSemana: "quinta-feira", tempMinC: 21, tempMaxC: 29, umidadeMinPct: 55, umidadeMaxPct: 90, rajadaMaxKmh: 38, chuvaMm: 4, probabilidadeChuvaPct: 60, uvMax: 7, condicao: "Nublado" },
      { data: "2026-10-23", dataFormatada: "23/10/2026", diaSemana: "sexta-feira", tempMinC: 20, tempMaxC: 28, umidadeMinPct: 60, umidadeMaxPct: 92, rajadaMaxKmh: 34, chuvaMm: 8, probabilidadeChuvaPct: 70, uvMax: 6, condicao: "Chuva" },
      { data: "2026-10-24", dataFormatada: "24/10/2026", diaSemana: "sábado", tempMinC: 22, tempMaxC: 30, umidadeMinPct: 50, umidadeMaxPct: 88, rajadaMaxKmh: 30, chuvaMm: 1, probabilidadeChuvaPct: 30, uvMax: 8, condicao: "Parcialmente nublado" },
    ],
  };
}

function relatorio(horarioAgendado) {
  const inicial = horarioAgendado === "08:00";
  return {
    cidade: { chave: "macae", nome: "Macaé", uf: "RJ", fuso: "America/Sao_Paulo" },
    dataFormatadaLonga: "quarta-feira, 21 de outubro de 2026",
    dataFormatadaCurta: "21/10/2026",
    horaConsulta: horarioAgendado,
    horarioAgendado,
    previsaoAte: inicial ? "15h" : "00h",
    periodoCoberto: inicial ? "hoje, das 08h até 15h" : "hoje, das 15h até 00h",
    mudancasDia: ["Grau geral: ATENÇÃO → ALERTA.", "Rajada prevista (previsão das 08:00 → previsão das 15:00): 35 km/h → 45 km/h."],
    previsaoDias: [{ periodo: inicial ? "Hoje (08h–15h)" : "Hoje (15h–00h)", data: "2026-10-21", condicao: "Nublado", tempMin: 21, tempMax: 30, umidadeMin: 55, umidadeMax: 90, chuvaMm: 4, rajadaKmh: inicial ? 35 : 45 }],
    condicaoGeral: "Nublado",
    probabilidadeChuvaPrevista: 60,
    tabelaTemperaturaUmidade: [{ fonte: "INMET — previsão oficial", tempMin: 21, tempMax: 30, umidadeMin: 55, umidadeMax: 90 }],
    ventoPorPeriodo: [{ periodo: "Tarde", janela: "12h–18h", direcao: "SE", intensidade: "Moderado", rajadaMaxKmh: inicial ? 35 : 45 }],
    chuvaPorPeriodo: [{ periodo: "Tarde", janela: "12h–18h", probabilidade: 60, precipitacaoMm: 4, resumoInmet: "Nublado" }],
    mar: null,
    qualidadeAr: null,
    climaSaude: null,
    severidade: { grau: inicial ? "ATENÇÃO" : "ALERTA", eventos: [] },
    avisosInmet: [], avisosInmetStatus: "operacional",
    divergencias: [], avisosColeta: [], fontesAutomatizadas: [], fontesManuais: [],
    fontesPorCampo: { tempMin: "INMET", tempMax: "INMET", umidadeMin: "INMET", umidadeMax: "INMET", rajadaMaxKmh: "Open-Meteo Forecast", precipitacaoTotalMm: "Open-Meteo Forecast", probabilidadeChuvaPrevista: "Open-Meteo Forecast" },
    deslocamento: { pedestres: [], transporte: [], condutores: [] },
    edificacao: [],
    previsaoProximosDias: previsaoD3(),
  };
}

async function main() {
  fs.mkdirSync(PASTA, { recursive: true });
  const r08 = relatorio("08:00");
  const r15 = relatorio("15:00");
  const html08 = renderPdfHtml(r08);
  const html15 = renderPdfHtml(r15);

  assert.doesNotMatch(html08, /Mudanças do dia|relatório das 05:00|previsão das 05:00/);
  assert.match(html08, /Hora da consulta:<\/strong> 08h/);
  assert.match(html08, /Previsão para os próximos 3 dias/);
  assert.match(html15, /Mudanças do dia em relação ao relatório das 08:00/);
  assert.match(html15, /Hora da consulta:<\/strong> 15h/);
  assert.match(html15, /Previsão para os próximos 3 dias/);

  const [pdf08, pdf15] = await Promise.all([gerarPdfBuffer(r08), gerarPdfBuffer(r15)]);
  const arquivo08 = path.join(PASTA, "Informativo_Macae_0800_EVIDENCIA.pdf");
  const arquivo15 = path.join(PASTA, "Informativo_Macae_1500_EVIDENCIA.pdf");
  fs.writeFileSync(arquivo08, pdf08);
  fs.writeFileSync(arquivo15, pdf15);
  console.log(JSON.stringify({ arquivo08, bytes08: pdf08.length, arquivo15, bytes15: pdf15.length }));
}

main().finally(() => fecharNavegador()).catch((erro) => {
  console.error(erro);
  process.exitCode = 1;
});
