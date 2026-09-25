const test = require("node:test");
const assert = require("node:assert/strict");

const {
  classificarChuvaHoraria,
  classificarChuvaDiaria,
  classificarChuva,
  classificarRajada,
} = require("../src/logic/inmetAlertRules");
const { detectarAlertasGraves, filtrarNovidades } = require("../src/logic/alertWatcher");
const { renderAlertEmailHtml, assuntoAlerta } = require("../src/render/alertEmailTemplate");

function conferirFronteiras(classificar, casos) {
  for (const [valor, esperado] of casos) {
    assert.equal(classificar(valor), esperado, `valor ${valor}`);
  }
}

test("chuva horária respeita todas as fronteiras sem sobreposição", () => {
  conferirFronteiras(classificarChuvaHoraria, [
    [19.9, "NORMAL"],
    [20, "ATENÇÃO"],
    [29.9, "ATENÇÃO"],
    [30, "ALERTA"],
    [30.1, "ALERTA"],
    [59.9, "ALERTA"],
    [60, "ALERTA"],
    [60.1, "EMERGÊNCIA"],
    [100, "EMERGÊNCIA"],
  ]);
});

test("chuva diária preserva atenção a partir de 20 mm e respeita alerta/emergência", () => {
  conferirFronteiras(classificarChuvaDiaria, [
    [19.9, "NORMAL"],
    [49.9, "ATENÇÃO"],
    [50, "ALERTA"],
    [50.1, "ALERTA"],
    [99.9, "ALERTA"],
    [100, "ALERTA"],
    [100.1, "EMERGÊNCIA"],
  ]);
});

test("rajada respeita todas as fronteiras em km/h", () => {
  conferirFronteiras(classificarRajada, [
    [29.9, "NORMAL"],
    [30, "ATENÇÃO"],
    [39.9, "ATENÇÃO"],
    [40, "ALERTA"],
    [40.1, "ALERTA"],
    [59.9, "ALERTA"],
    [60, "ALERTA"],
    [60.1, "EMERGÊNCIA"],
  ]);
});

test("chuva sempre utiliza o maior grau entre intensidade horária e acumulado", () => {
  assert.deepEqual(classificarChuva(25, 75), {
    grau: "ALERTA",
    grauHorario: "ATENÇÃO",
    grauDiario: "ALERTA",
  });
  assert.equal(classificarChuva(65, 40).grau, "EMERGÊNCIA");
});

function relatorioBase() {
  return {
    avisosInmet: [],
    eventoMaisRelevante: null,
    rajadaMaxKmh: 30,
    precipitacaoHorariaMaxMm: 25,
    precipitacaoTotalMm: 75,
    ventoPorPeriodo: [
      { periodo: "Manhã", rajadaMaxKmh: 30 },
      { periodo: "Tarde", rajadaMaxKmh: 20 },
    ],
    chuvaPorPeriodo: [
      { periodo: "Manhã", precipitacaoHorariaMaxMm: 25, precipitacaoMm: 40 },
      { periodo: "Tarde", precipitacaoHorariaMaxMm: 10, precipitacaoMm: 35 },
    ],
    fontesPorCampo: {
      rajadaMaxKmh: "Open-Meteo",
      precipitacaoHorariaMaxMm: "Open-Meteo",
      precipitacaoTotalMm: "Open-Meteo",
    },
    mar: null,
    tempMax: null,
    qualidadeAr: null,
  };
}

test("monitor emite chuva e vento com grau, unidade, fonte e recomendações", () => {
  const alertas = detectarAlertasGraves(relatorioBase());
  const chuva = alertas.find((a) => a.assinatura === "chuva");
  const vento = alertas.find((a) => a.assinatura === "vento");

  assert.equal(chuva.grau, "ALERTA");
  assert.equal(chuva.origem, "INMET");
  assert.equal(chuva.fonteDados, "Open-Meteo");
  assert.equal(chuva.valores.intensidadeHorariaMmH, 25);
  assert.equal(chuva.valores.acumuladoDiarioMm, 75);
  assert.ok(chuva.recomendacoes.length > 0);

  assert.equal(vento.grau, "ATENÇÃO");
  assert.equal(vento.valores.rajadaKmh, 30);
  assert.equal(vento.unidade, "km/h");
  assert.ok(vento.recomendacoes.length > 0);
});

test("deduplicação ignora variação no mesmo grau e reavisa quando agrava", () => {
  const alertaAtencao = {
    assinatura: "vento",
    tipo: "Vento",
    grau: "ATENÇÃO",
    gravidade: "atencao",
  };
  const primeiro = filtrarNovidades("rio_de_janeiro", [alertaAtencao], {});
  assert.equal(primeiro.length, 1);

  const estado = {
    [primeiro[0].chaveEstado]: {
      gravidade: "atencao",
      tipo: "Vento",
      emISO: new Date().toISOString(),
    },
  };
  assert.equal(
    filtrarNovidades("rio_de_janeiro", [{ ...alertaAtencao, detalhe: "39,9 km/h" }], estado).length,
    0
  );

  const agravado = filtrarNovidades(
    "rio_de_janeiro",
    [{ ...alertaAtencao, grau: "ALERTA", gravidade: "alto", detalhe: "48 km/h" }],
    estado
  );
  assert.equal(agravado.length, 1);
  assert.equal(agravado[0].motivo, "agravou");
});

test("e-mail apresenta fenômeno, grau, fontes, valores e recomendações", () => {
  const alerta = detectarAlertasGraves(relatorioBase()).find((a) => a.assinatura === "chuva");
  const base = {
    cidade: { nome: "Rio de Janeiro", uf: "RJ" },
    report: {
      dataFormatadaCurta: "25/09/2026",
      horaConsulta: "14:00",
      tempMin: 20,
      tempMax: 28,
      ventoPorPeriodo: [],
      condicaoGeral: "Chuva",
    },
    alertas: [alerta],
  };
  const html = renderAlertEmailHtml(base);

  assert.match(html, /ALERTA — CHUVA INTENSA/);
  assert.match(html, /Fonte do critério: INMET/);
  assert.match(html, /Fonte do dado: Open-Meteo/);
  assert.match(html, /Intensidade horária máxima prevista: 25 mm\/h/);
  assert.match(html, /Recomendações:/);
  assert.match(assuntoAlerta(base), /ALERTA — Rio de Janeiro\/RJ: Chuva intensa/);
});
