const test = require("node:test");
const assert = require("node:assert/strict");
const cheerio = require("cheerio");

const {
  detectarAlertasGraves,
  filtrarNovidades,
  marcarAlertasEnviados,
} = require("../src/logic/alertWatcher");
const { renderAlertEmailHtml } = require("../src/render/alertEmailTemplate");
const { classificacaoMudanca } = require("../src/render/emailComponents");

function relatorio(extra = {}) {
  return {
    dataFormatadaCurta: "13/10/2026",
    horaConsulta: "15:00",
    condicaoGeral: "Parcialmente nublado",
    tempMin: 22,
    tempMax: 31,
    umidadeMin: 55,
    rajadaMaxKmh: null,
    precipitacaoHorariaMaxMm: null,
    precipitacaoTotalMm: null,
    temTempestadeHoje: false,
    avisosInmet: [],
    ventoPorPeriodo: [
      { periodo: "Manhã", janela: "05h–12h", rajadaMaxKmh: 20 },
      { periodo: "Tarde", janela: "12h–18h", rajadaMaxKmh: null },
      { periodo: "Noite", janela: "18h–00h", rajadaMaxKmh: 18 },
    ],
    chuvaPorPeriodo: [
      { periodo: "Manhã", janela: "05h–12h", precipitacaoHorariaMaxMm: 0, precipitacaoMm: 0 },
      { periodo: "Tarde", janela: "12h–18h", precipitacaoHorariaMaxMm: null, precipitacaoMm: null },
      { periodo: "Noite", janela: "18h–00h", precipitacaoHorariaMaxMm: 0, precipitacaoMm: 0 },
    ],
    fontesPorCampo: {
      rajadaMaxKmh: "Open-Meteo",
      precipitacaoHorariaMaxMm: "Open-Meteo",
      precipitacaoTotalMm: "Open-Meteo",
      "ar.uvMax": "Open-Meteo Air Quality / CAMS",
      "ar.aqiPm25": "Open-Meteo Air Quality / CAMS",
    },
    mar: null,
    qualidadeAr: null,
    ...extra,
  };
}

function base(alertas, report = relatorio()) {
  return { cidade: { nome: "Macaé", uf: "RJ" }, report, alertas };
}

function vento(valor) {
  const report = relatorio({
    rajadaMaxKmh: valor,
    ventoPorPeriodo: [
      { periodo: "Manhã", janela: "05h–12h", rajadaMaxKmh: 20 },
      { periodo: "Tarde", janela: "12h–18h", rajadaMaxKmh: valor },
      { periodo: "Noite", janela: "18h–00h", rajadaMaxKmh: 18 },
    ],
  });
  return { report, alerta: detectarAlertasGraves(report).find((item) => item.assinatura === "vento") };
}

test("vento interno em ATENÇÃO e ALERTA exibe só informe e recomendações proporcionais", () => {
  const atencao = vento(36);
  assert.equal(atencao.alerta.grau, "ATENÇÃO");
  assert.equal(atencao.alerta.janela, "Tarde (12h–18h)");
  assert.deepEqual(atencao.alerta.recomendacoes, ["Manter o monitoramento durante o dia."]);

  const alerta = vento(45);
  assert.equal(alerta.alerta.grau, "ALERTA");
  assert.ok(alerta.alerta.recomendacoes.some((item) => /Suspender içamentos/.test(item)));

  const html = renderAlertEmailHtml(base([atencao.alerta], atencao.report));
  assert.match(html, /VENTO — ATENÇÃO/);
  assert.match(html, /Informe do aviso:<\/strong> Rajada prevista: 36 km\/h/);
  assert.doesNotMatch(html, /Origem da classificação|Significado do nível CIM|Instalações \(Operações\)|Período:|Fonte de dados:/);
});

test("vento representa redução e agravamento somente com classificação anterior válida", () => {
  const estado = {};
  const confirmar = (alertas) => marcarAlertasEnviados(
    { alertas },
    { carregar: () => estado, salvar: () => {} }
  );
  const enviar = (valor) => {
    const atual = vento(valor).alerta;
    const novidades = filtrarNovidades("macae", [atual], estado);
    if (novidades.length) confirmar(novidades);
    return novidades[0];
  };

  const novo = enviar(45);
  assert.equal(novo.grauAnterior, undefined);
  const reducao = enviar(36);
  assert.deepEqual([reducao.grauAnterior, reducao.grau, reducao.motivo], ["ALERTA", "ATENÇÃO", "reduziu"]);
  let html = renderAlertEmailHtml(base([reducao], vento(36).report));
  assert.match(html, /VENTO — ATENÇÃO/);
  assert.doesNotMatch(cheerio.load(html)("[data-alert-card='true']").text(), /MUDANÇA DE STATUS|Mudança de gatilho/);

  const agravamento = enviar(45);
  assert.deepEqual([agravamento.grauAnterior, agravamento.grau, agravamento.motivo], ["ATENÇÃO", "ALERTA", "agravou"]);
  html = renderAlertEmailHtml(base([agravamento], vento(45).report));
  assert.match(html, /VENTO — ALERTA/);
  assert.doesNotMatch(cheerio.load(html)("[data-alert-card='true']").text(), /MUDANÇA DE STATUS|AGRAVAMENTO/);
  assert.equal(classificacaoMudanca("ALERTA", "ALERTA"), "MANUTENÇÃO");
});

test("chuva interna apresenta recomendação específica e vários fenômenos permanecem separados", () => {
  const report = relatorio({
    rajadaMaxKmh: 45,
    precipitacaoHorariaMaxMm: 35,
    precipitacaoTotalMm: 55,
    ventoPorPeriodo: [
      { periodo: "Manhã", janela: "05h–12h", rajadaMaxKmh: 20 },
      { periodo: "Tarde", janela: "12h–18h", rajadaMaxKmh: 45 },
    ],
    chuvaPorPeriodo: [
      { periodo: "Manhã", janela: "05h–12h", precipitacaoHorariaMaxMm: 5, precipitacaoMm: 5 },
      { periodo: "Tarde", janela: "12h–18h", precipitacaoHorariaMaxMm: 35, precipitacaoMm: 50 },
    ],
  });
  const alertas = detectarAlertasGraves(report);
  const chuva = alertas.find((item) => item.assinatura === "chuva");
  assert.equal(chuva.grau, "ALERTA");
  assert.doesNotMatch(chuva.recomendacoes.join(" "), /inunda|alagament|alagáveis|lâmina d’água/i);
  assert.equal(alertas.filter((item) => ["chuva", "vento"].includes(item.assinatura)).length, 2);
  const $ = cheerio.load(renderAlertEmailHtml(base(alertas, report)));
  assert.equal($("[data-alert-card='true']").length, 2);
  assert.doesNotMatch($.root().text(), /inunda|alagament|alagáveis|lâmina d’água/i);
});

test("aviso oficial prevalece sem repetir metadados no card resumido", () => {
  const report = relatorio({
    rajadaMaxKmh: 45,
    ventoPorPeriodo: [{ periodo: "Tarde", janela: "12h–18h", rajadaMaxKmh: 45 }],
    avisosInmet: [{
      descricao: "Ventos Costeiros",
      severidade: "Perigo",
      inicio: "13/10/2026 12:00",
      fim: "13/10/2026 20:00",
      riscos: ["Intensificação dos ventos em áreas costeiras."],
      instrucoes: ["Siga as orientações da Defesa Civil."],
    }],
  });
  const alertas = detectarAlertasGraves(report);
  assert.equal(alertas.filter((item) => item.assinatura === "vento").length, 0);
  const oficial = alertas.find((item) => item.assinatura === "inmet:vento");
  assert.equal(oficial.orgaoEmissor, "INMET");
  assert.match(oficial.previsaoComplementar, /45 km\/h/);
  const $ = cheerio.load(renderAlertEmailHtml(base([oficial], report)));
  assert.equal($("[data-alert-card='true']").length, 1);
  assert.equal($("[data-alert-forecast-complement='true']").length, 0);
  assert.equal($("[data-alert-notice='true']").length, 1);
});

test("ausência de dados não cria alerta nem simula redução", () => {
  const report = relatorio({
    rajadaMaxKmh: null,
    precipitacaoHorariaMaxMm: null,
    precipitacaoTotalMm: null,
    ventoPorPeriodo: [],
    chuvaPorPeriodo: [],
  });
  assert.deepEqual(detectarAlertasGraves(report), []);
  const estado = {
    "macae|vento": { grau: "ALERTA", gravidade: "alto", tipo: "Vento", fonteDados: "Open-Meteo" },
  };
  assert.equal(filtrarNovidades("macae", [], estado, () => false).length, 0);
  assert.equal(renderAlertEmailHtml(base([], report)), "");
});

test("histórico e dados de uma base não interferem em outra", () => {
  const atual = vento(36).alerta;
  const estado = {
    "rio_de_janeiro|vento": { grau: "ALERTA", gravidade: "alto", tipo: "Vento" },
  };
  const [macae] = filtrarNovidades("macae", [atual], estado);
  assert.equal(macae.grauAnterior, undefined);
  assert.equal(macae.motivo, "novo");
});

test("UV e qualidade do ar usam títulos humanos sem metadados técnicos", () => {
  const report = relatorio({
    qualidadeAr: {
      uvMax: 11,
      horaPicoUv: "11:00",
      uvClassificacao: { nivel: "Extremo" },
      aqiPm25: 85,
      pm25Medio: 29,
      pm25Classificacao: { nivel: "Muito ruim" },
    },
  });
  const html = renderAlertEmailHtml(base(detectarAlertasGraves(report), report));
  assert.match(html, /ÍNDICE UV — ALERTA/);
  assert.match(html, /QUALIDADE DO AR — ALERTA/);
  assert.doesNotMatch(html, /Fonte de dados:|Origem da classificação|Significado do nível CIM|Instalações/);
  assert.doesNotMatch(html, /UVALTO|QUALIDADEARRUIM/);
});
