const test = require("node:test");
const assert = require("node:assert/strict");
const {
  classificarChuvaDiaria,
  classificarChuvaHoraria,
  classificarCondicoesMeteorologicas,
  classificarRajada,
  recomendacoes,
} = require("../src/logic/inmetAlertRules");
const { avaliarRiscos, grauUvConfigurado } = require("../src/logic/riskEngine");
const { recomendacoesProtecao } = require("../src/logic/healthProtection");
const { recomendacoesFenomeno } = require("../src/logic/phenomenonRecommendations");

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

test("fronteiras de chuva e vento seguem exatamente as faixas operacionais do CIM", () => {
  assert.deepEqual(
    [19.99, 20, 29.99, 30, 60, 60.01].map(classificarChuvaHoraria),
    ["NORMAL", "ATENÇÃO", "ATENÇÃO", "ALERTA", "ALERTA", "EMERGÊNCIA"]
  );
  assert.deepEqual(
    [19.99, 20, 49.99, 50, 100, 100.01].map(classificarChuvaDiaria),
    ["NORMAL", "ATENÇÃO", "ATENÇÃO", "ALERTA", "ALERTA", "EMERGÊNCIA"]
  );
  assert.deepEqual(
    [29.99, 30, 39.99, 40, 60, 60.01].map(classificarRajada),
    ["NORMAL", "ATENÇÃO", "ATENÇÃO", "ALERTA", "ALERTA", "EMERGÊNCIA"]
  );
});

test("motor cria classificações internas de chuva e vento com observações oficiais do INMET", () => {
  const resultado = avaliarRiscos(entrada({
    temTempestadeHoje: false,
    fontesPorCampo: {
      rajadaMaxKmh: "INMET — estação automática — observado",
      precipitacaoHorariaMaxMm: "INMET — estação automática — observado",
      precipitacaoTotalMm: "INMET — estação automática — observado",
    },
  }));
  assert.equal(resultado.severidade.vento.grau, "EMERGÊNCIA");
  assert.equal(resultado.severidade.chuva.grau, "EMERGÊNCIA");
  assert.equal(resultado.severidade.eventos.some((e) => e.tipo === "tempestadePrevista"), false);
  assert.ok(resultado.severidade.eventos
    .filter((e) => ["chuva", "vento"].includes(e.assinatura))
    .every((e) => e.naturezaDado === "Classificação interna baseada em observação oficial"));
});

test("rajada complementar permanece identificada como previsão e não como medição INMET", () => {
  const resultado = avaliarRiscos(entrada({
    rajadaMaxKmh: 49,
    precipitacaoHorariaMaxMm: null,
    precipitacaoTotalMm: null,
    temTempestadeHoje: false,
    periodos: {
      manha: { periodo: "Manhã", janela: "05h–12h", rajadaMaxKmh: 30 },
      tarde: { periodo: "Tarde", janela: "12h–18h", rajadaMaxKmh: 49 },
      noite: { periodo: "Noite", janela: "18h–00h", rajadaMaxKmh: 28 },
    },
    fontesPorCampo: { rajadaMaxKmh: "Open-Meteo — previsão complementar" },
  }));
  const vento = resultado.severidade.eventos.find((evento) => evento.assinatura === "vento");
  assert.equal(vento.descricao, "Rajada prevista: 49 km/h");
  assert.equal(vento.janela, "Tarde (12h–18h)");
  assert.equal(vento.fonteDados, "Open-Meteo — previsão complementar");
});

test("temperatura alta sem excesso de EHF não vira alerta de calor", () => {
  const resultado = avaliarRiscos(entrada({
    tempMax: 40,
    rajadaMaxKmh: null,
    precipitacaoHorariaMaxMm: null,
    precipitacaoTotalMm: null,
    temTempestadeHoje: false,
  }));
  assert.equal(resultado.severidade.eventos.some((evento) => evento.tipo === "calorExtremo"), false);
  assert.equal(resultado.severidade.grau, "NORMAL");
});

test("aviso oficial de calor permanece separado do EHF e conserva a severidade INMET", () => {
  const aviso = { descricao: "Onda de Calor", severidade: "Perigo", inicio: "10:00", fim: "18:00", riscos: ["Risco à saúde."] };
  const resultado = avaliarRiscos(entrada({ tempMax: 40, avisosInmet: [aviso] }));
  const evento = resultado.severidade.eventos.find((item) => item.tipo === "avisoInmet");
  assert.equal(evento.grau, "ALERTA");
  assert.equal(evento.fonteDados, undefined);
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
  const chuvaAtencao = recomendacoes("chuva", "ATENÇÃO");
  assert.doesNotMatch(chuvaAtencao.join(" "), /inunda|alagament|alagáveis|lâmina d’água/i);
});

test("UV usa recomendações solares próprias sem alterar seus limites técnicos", () => {
  assert.equal(recomendacoesProtecao("ATENÇÃO").length, 3);
  assert.equal(recomendacoesProtecao("ALERTA").length, 10);
  assert.equal(recomendacoesProtecao("EMERGÊNCIA").length, 13);
  const uv = avaliarRiscos(entrada({ qualidadeAr: { uvMax: 8, uvClassificacao: { nivel: "Muito alto" } } })).severidade.eventos.find((e) => e.tipo === "uvAlto");
  assert.equal(uv.grau, "ATENÇÃO");
  assert.deepEqual(uv.recomendacoes, recomendacoesFenomeno("uv", "ATENÇÃO"));
});

test("mapeamento operacional de UV é parametrizável", { concurrency: false }, () => {
  const anterior = process.env.UV_GRAU_EXTREMO;
  try {
    process.env.UV_GRAU_EXTREMO = "EMERGENCIA";
    assert.equal(grauUvConfigurado("extremo"), "EMERGÊNCIA");
    const uv = avaliarRiscos(entrada({ qualidadeAr: { uvMax: 11, uvClassificacao: { nivel: "Extremo" } } })).severidade.eventos.find((e) => e.tipo === "uvAlto");
    assert.equal(uv.grau, "EMERGÊNCIA");
    assert.deepEqual(uv.recomendacoes, recomendacoesFenomeno("uv", "EMERGÊNCIA"));
  } finally {
    if (anterior === undefined) delete process.env.UV_GRAU_EXTREMO;
    else process.env.UV_GRAU_EXTREMO = anterior;
  }
});

test("qualidade do ar usa somente o IQAr brasileiro e ignora índices US/EU", () => {
  const atencao = avaliarRiscos(entrada({ qualidadeAr: {
    iqar: 100, classificacao: { nivel: "Ruim", exibicao: "Ruim" }, european_aqi: 61, us_aqi: 30,
  } })).severidade.eventos.find((evento) => evento.tipo === "qualidadeArRuim");
  assert.equal(atencao.grau, "ATENÇÃO");
  assert.match(atencao.descricao, /IQAr 100/);
  assert.doesNotMatch(atencao.descricao, /European AQI|US AQI|µg\/m³|PM2,5/);

  const alerta = avaliarRiscos(entrada({ qualidadeAr: {
    iqar: 150, classificacao: { nivel: "Muito Ruim", exibicao: "Muito Ruim" },
  } })).severidade.eventos.find((evento) => evento.tipo === "qualidadeArRuim");
  assert.equal(alerta.grau, "ALERTA");
  const emergencia = avaliarRiscos(entrada({ qualidadeAr: {
    iqar: 250, classificacao: { nivel: "Péssima", exibicao: "Péssima" },
  } })).severidade.eventos.find((evento) => evento.tipo === "qualidadeArRuim");
  assert.equal(emergencia.grau, "EMERGÊNCIA");
  const semIndice = avaliarRiscos(entrada({ qualidadeAr: { aqiPm25: 500, european_aqi: 200, us_aqi: 300 } }));
  assert.equal(semIndice.severidade.eventos.some((evento) => evento.tipo === "qualidadeArRuim"), false);
});
