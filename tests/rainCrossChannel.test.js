const test = require("node:test");
const assert = require("node:assert/strict");
const { carregarPainel } = require("./helpers/fakeDom");
const { renderPdfHtml } = require("../src/render/pdfTemplate");
const { renderEmailHtml } = require("../src/render/emailTemplate");
const { classificarDadosRelatorio, validarDadosRelatorio } = require("../src/logic/meteorologicalValidity");

test("painel e PDF preservam estimativas; e-mail mostra apenas chuva prevista", () => {
  const fonte = "Open-Meteo — estimativa de modelo";
  const r = {
    cidade: { chave: "santos", nome: "Santos", uf: "SP", latitude: -23.9609448,
      longitude: -46.3166316, fuso: "America/Sao_Paulo" },
    dataFormatadaLonga: "sexta-feira, 23 de outubro de 2026", dataFormatadaCurta: "23/10/2026",
    geradoEmISO: "2026-10-23T17:49:00.000Z", horaConsulta: "14:49", condicaoGeral: "Chuva",
    chuvaPrevistaDiaMm: 16.8, chuvaEstimadaDiaMm: 5.4,
    chuvaEstimadaHoraMm: 0.6, chuvaEstimada24hMm: 5.9,
    chuvaEstimadaReferencia: "2026-10-23T14:00", chuvaEstimadaHoraReferencia: "2026-10-23T14:00",
    coberturaChuvaEstimadaDia: { amostras: 14, horasEsperadas: 14, parcial: false },
    coberturaChuvaEstimada24h: { amostras: 24, horasEsperadas: 24, parcial: false },
    precipitacaoDiariaMm: null, precipitacaoHoraMm: null, precipitacaoUltimas24hMm: null,
    previsaoDias: [{ chuvaMm: 16.8 }],
    openMeteo: { dataReferencia: "2026-10-23" },
    fontesPorCampo: { chuvaPrevistaDiaMm: "Open-Meteo — previsão meteorológica",
      chuvaEstimadaDiaMm: fonte, chuvaEstimadaHoraMm: fonte, chuvaEstimada24hMm: fonte },
    tabelaTemperaturaUmidade: [], ventoPorPeriodo: [], chuvaPorPeriodo: [], chuvaPorHora: [],
    monitoramentoApis: [], fontesAutomatizadas: [], fontesManuais: [],
    inmetObservacao: { status: "indisponivel" }, avisosInmet: [], avisosInmetStatus: "indisponivel",
    severidade: { grau: "NORMAL", eventos: [] }, divergencias: [], avisosColeta: [],
  };
  r.classificacaoDados = classificarDadosRelatorio(r);
  assert.equal(validarDadosRelatorio(r), true);
  assert.equal(r.classificacaoDados.chuvaEstimadaDia.estado, "estimada");
  assert.equal(r.classificacaoDados.chuvaObservadaDia.valor, null);
  const painel = carregarPainel().executar("Dashboard.home")(r);
  const pdf = renderPdfHtml(r);
  const email = renderEmailHtml(r, { incluirCorRio: false });
  for (const html of [painel, pdf]) {
    assert.match(html, /ESTIMATIVA OPEN-METEO/i);
    for (const n of ["5.4", "0.6", "5.9"]) assert.match(html.replaceAll(",", "."), new RegExp(n.replace(".", "\\.")));
  }
  assert.match(painel, /Chuva acumulada\/dia/);
  assert.match(email, /CHUVA PREVISTA\/DIA/);
  assert.match(email, /16\.8 mm/);
  assert.doesNotMatch(email, /ESTIMATIVA OPEN-METEO|5\.4 mm|0\.6 mm|5\.9 mm/);
  assert.match(pdf, /Chuva acumulada estimada/);
});
