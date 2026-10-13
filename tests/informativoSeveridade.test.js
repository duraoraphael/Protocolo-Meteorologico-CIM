const test = require("node:test");
const assert = require("node:assert/strict");
const { classificarCondicoesMeteorologicas, recomendacoes } = require("../src/logic/inmetAlertRules");
const { avaliarRiscos, grauUvConfigurado } = require("../src/logic/riskEngine");
const { recomendacoesProtecao } = require("../src/logic/healthProtection");

function entrada(extra = {}) {
  return {
    tempMax: null, umidadeMin: null, rajadaMaxKmh: 90,
    precipitacaoHorariaMaxMm: 80, precipitacaoTotalMm: 120,
    temTempestadeHoje: true,
    periodos: { manha: {}, tarde: {}, noite: {} },
    avisosInmet: [], mar: null, qualidadeAr: null,
    ...extra,
  };
}

test("classificador numérico isolado mantém suas fronteiras legadas", () => {
  assert.equal(classificarCondicoesMeteorologicas({ rajadaKmh: 30 }).vento.grau, "ATENÇÃO");
  assert.equal(classificarCondicoesMeteorologicas({ rajadaKmh: 40 }).vento.grau, "ALERTA");
  assert.equal(classificarCondicoesMeteorologicas({ rajadaKmh: 61 }).vento.grau, "EMERGÊNCIA");
  assert.equal(classificarCondicoesMeteorologicas({ chuvaHorariaMmH: 30 }).chuva.grau, "ALERTA");
});

test("motor do informativo não cria alerta de chuva, vento ou raios com Open-Meteo", () => {
  const resultado = avaliarRiscos(entrada());
  assert.equal(resultado.severidade.vento.grau, "NORMAL");
  assert.equal(resultado.severidade.chuva.grau, "NORMAL");
  assert.equal(resultado.severidade.eventos.some((e) => ["raios", "chuvaIntensa", "chuvaModerada", "ventoForte", "ventoModerado"].includes(e.tipo)), false);
});

test("aviso oficial INMET determina chuva e vento com a severidade oficial", () => {
  const aviso = { descricao: "Tempestade", severidade: "Grande Perigo", inicio: "10:00", fim: "18:00", riscos: ["Chuva intensa e rajadas de vento."] };
  const resultado = avaliarRiscos(entrada({ avisosInmet: [aviso] }));
  assert.equal(resultado.severidade.grau, "EMERGÊNCIA");
  assert.equal(resultado.severidade.chuva.grau, "EMERGÊNCIA");
  assert.equal(resultado.severidade.vento.grau, "EMERGÊNCIA");
  assert.ok(resultado.severidade.eventos.filter((e) => e.assinatura === "chuva" || e.assinatura === "vento").every((e) => e.fonteDados === "INMET — aviso oficial"));
});

test("recomendações de chuva e vento continuam acumulativas", () => {
  for (const fenomeno of ["chuva", "vento"]) {
    const a = recomendacoes(fenomeno, "ATENÇÃO");
    const b = recomendacoes(fenomeno, "ALERTA");
    const c = recomendacoes(fenomeno, "EMERGÊNCIA");
    assert.deepEqual(b.slice(0, a.length), a);
    assert.deepEqual(c.slice(0, b.length), b);
  }
});

test("UV compartilha as recomendações P1/P2/P3 sem alterar seus limites técnicos", () => {
  assert.equal(recomendacoesProtecao("ATENÇÃO").length, 3);
  assert.equal(recomendacoesProtecao("ALERTA").length, 10);
  assert.equal(recomendacoesProtecao("EMERGÊNCIA").length, 13);
  const uv = avaliarRiscos(entrada({ qualidadeAr: { uvMax: 8, uvClassificacao: { nivel: "Muito alto" } } })).severidade.eventos.find((e) => e.tipo === "uvAlto");
  assert.equal(uv.grau, "ATENÇÃO");
  assert.deepEqual(uv.recomendacoes, recomendacoesProtecao("ATENÇÃO"));
});

test("mapeamento operacional de UV é parametrizável", { concurrency: false }, () => {
  const anterior = process.env.UV_GRAU_EXTREMO;
  try {
    process.env.UV_GRAU_EXTREMO = "EMERGENCIA";
    assert.equal(grauUvConfigurado("extremo"), "EMERGÊNCIA");
    const uv = avaliarRiscos(entrada({ qualidadeAr: { uvMax: 11, uvClassificacao: { nivel: "Extremo" } } })).severidade.eventos.find((e) => e.tipo === "uvAlto");
    assert.equal(uv.grau, "EMERGÊNCIA");
    assert.deepEqual(uv.recomendacoes, recomendacoesProtecao("EMERGÊNCIA"));
  } finally {
    if (anterior === undefined) delete process.env.UV_GRAU_EXTREMO;
    else process.env.UV_GRAU_EXTREMO = anterior;
  }
});
