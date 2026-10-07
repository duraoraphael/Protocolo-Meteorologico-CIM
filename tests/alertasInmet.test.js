const test = require("node:test");
const assert = require("node:assert/strict");

const {
  classificarChuvaHoraria,
  classificarChuvaDiaria,
  classificarChuva,
  classificarRajada,
} = require("../src/logic/inmetAlertRules");
const { detectarAlertasGraves, filtrarNovidades, marcarAlertasEnviados } = require("../src/logic/alertWatcher");
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

test("mudança de gatilho comunica agravamento, redução e retorno ao normal uma vez", () => {
  const base = "rio_de_janeiro";
  const estado = {};
  const alerta = (grau, gravidade) => ({ assinatura: "vento", tipo: "Vento", grau, gravidade, origem: "INMET", fonteDados: "Open-Meteo" });
  const enviar = (achados) => {
    const novidades = filtrarNovidades(base, achados, estado);
    if (novidades.length) marcarAlertasEnviados({ alertas: novidades }, { carregar: () => estado, salvar: () => {} });
    return novidades;
  };
  assert.equal(enviar([alerta("ATENÇÃO", "atencao")]).length, 1);
  assert.equal(enviar([alerta("ATENÇÃO", "atencao")]).length, 0);
  assert.equal(enviar([alerta("ALERTA", "alto")])[0].motivo, "agravou");
  assert.equal(enviar([alerta("EMERGÊNCIA", "severo")])[0].motivo, "agravou");
  assert.equal(enviar([alerta("EMERGÊNCIA", "severo")]).length, 0);
  assert.equal(enviar([alerta("ALERTA", "alto")])[0].motivo, "reduziu");
  assert.equal(enviar([alerta("ATENÇÃO", "atencao")])[0].motivo, "reduziu");
  assert.equal(enviar([])[0].grau, "NORMAL");
  assert.equal(enviar([]).length, 0);
  assert.equal(enviar([alerta("ATENÇÃO", "atencao")]).length, 1);
});

test("estado de alerta só muda ao confirmar explicitamente o envio", () => {
  const estado = {};
  const [alerta] = filtrarNovidades("macae", [{ assinatura: "chuva", tipo: "Chuva", grau: "ALERTA", gravidade: "alto" }], estado);
  assert.deepEqual(estado, {});
  marcarAlertasEnviados({ alertas: [alerta] }, { carregar: () => estado, salvar: () => {} });
  assert.equal(estado["macae|chuva"].grau, "ALERTA");
});

test("avisos oficiais usam assinatura própria e acompanham todo o ciclo de severidade", () => {
  const chaveBase = "rio_de_janeiro";
  const estado = {};
  const detectar = (severidade) => detectarAlertasGraves({
    ...relatorioBase(),
    avisosInmet: [{
      descricao: "Chuvas Intensas", severidade,
      inicio: "30/09/2026 10:00", fim: "30/09/2026 20:00",
      riscos: ["Chuva intensa."], instrucoes: ["Busque abrigo."],
    }],
  }).find((alerta) => alerta.assinatura === "inmet:chuva");
  const confirmar = (alertas) => marcarAlertasEnviados(
    { alertas },
    { carregar: () => estado, salvar: () => {} }
  );
  const transicao = (severidade) => {
    const novidades = filtrarNovidades(chaveBase, [detectar(severidade)], estado, () => true);
    if (novidades.length) confirmar(novidades);
    return novidades;
  };

  let [mudanca] = transicao("Perigo Potencial");
  assert.equal(mudanca.grauAnterior, "NORMAL");
  assert.equal(mudanca.grau, "ATENÇÃO");
  assert.equal(mudanca.assinatura, "inmet:chuva");
  assert.equal(filtrarNovidades(chaveBase, [detectar("Perigo Potencial")], estado).length, 0);

  [mudanca] = transicao("Perigo");
  assert.deepEqual([mudanca.grauAnterior, mudanca.grau, mudanca.motivo], ["ATENÇÃO", "ALERTA", "agravou"]);
  [mudanca] = transicao("Grande Perigo");
  assert.deepEqual([mudanca.grauAnterior, mudanca.grau, mudanca.motivo], ["ALERTA", "EMERGÊNCIA", "agravou"]);
  [mudanca] = transicao("Perigo");
  assert.deepEqual([mudanca.grauAnterior, mudanca.grau, mudanca.motivo], ["EMERGÊNCIA", "ALERTA", "reduziu"]);
  [mudanca] = transicao("Perigo Potencial");
  assert.deepEqual([mudanca.grauAnterior, mudanca.grau, mudanca.motivo], ["ALERTA", "ATENÇÃO", "reduziu"]);

  assert.equal(filtrarNovidades(chaveBase, [], estado, () => false).length, 0, "falha da API não normaliza");
  [mudanca] = filtrarNovidades(chaveBase, [], estado, () => true);
  assert.deepEqual([mudanca.grauAnterior, mudanca.grau, mudanca.motivo], ["ATENÇÃO", "NORMAL", "normalizou"]);
  assert.match(mudanca.detalhe, /não consta mais entre os avisos ativos do INMET/);
  confirmar([mudanca]);
  assert.equal(filtrarNovidades(chaveBase, [], estado, () => true).length, 0);
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

  assert.match(html, /CHUVA INTENSA — ALERTA/);
  assert.doesNotMatch(html, /Fonte do critério/);
  assert.match(html, /Fonte de dados: Open-Meteo/);
  assert.match(html, /Intensidade horária máxima prevista: 25 mm\/h/);
  assert.match(html, /Recomendações – Protocolo Meteorológico do COMPARTILHADO/);
  assert.match(assuntoAlerta(base), /CHUVA INTENSA — ALERTA — Rio de Janeiro\/RJ/);
});

test("aviso oficial mantém a fonte INMET e explica todos os riscos oficiais sem duplicar", () => {
  const report = relatorioBase();
  report.avisosInmet = [{
    descricao: "Tempestade",
    severidade: "Perigo",
    inicio: "14:00",
    fim: "18:00",
    riscos: ["Chuva entre 30 e 60 mm/h.", "Ventos intensos de 60 a 100 km/h."],
    instrucoes: ["Busque abrigo."],
  }];
  const oficial = detectarAlertasGraves(report).find((a) => a.naturezaDado === "Aviso oficial");
  assert.equal(oficial.fonteDados, "INMET");
  const html = renderAlertEmailHtml({
    cidade: { nome: "Rio de Janeiro", uf: "RJ" },
    report: { dataFormatadaCurta: "28/09/2026", horaConsulta: "15:00", ventoPorPeriodo: [] },
    alertas: [oficial],
  });
  assert.match(html, /TEMPESTADE COM RAIOS — ALERTA/);
  assert.match(html, /MUDANÇA DE AVISO OFICIAL INMET · NOVO ALERTA/);
  assert.match(html, /Classificação:<\/strong> ALERTA/);
  assert.match(html, /Instruções oficiais:/);
  assert.match(html, /Motivo do aviso:.*Chuva entre 30 e 60 mm\/h\. Ventos intensos de 60 a 100 km\/h\./);
  assert.match(html, /Fonte de dados: INMET/);
  assert.equal((html.match(/Chuva entre 30 e 60 mm\/h/g) || []).length, 1);
});

test("normalização oficial isolada não renderiza Alerta CIM", () => {
  const html = renderAlertEmailHtml({
    cidade: { nome: "Rio de Janeiro", uf: "RJ" },
    report: { dataFormatadaCurta: "30/09/2026", horaConsulta: "15:00", ventoPorPeriodo: [] },
    alertas: [{
      tipo: "Chuvas Intensas",
      assinatura: "inmet:chuva",
      naturezaDado: "Aviso oficial",
      fonteDados: "INMET",
      grauAnterior: "ALERTA",
      grau: "NORMAL",
      gravidade: "normal",
      motivo: "normalizou",
      detalhe: "O aviso oficial não consta mais entre os avisos ativos do INMET para esta base.",
    }],
  });

  assert.equal(html, "");
});

test("e-mail de alerta mostra identidade CIM e cor do grau comunicado", () => {
  const cores = [
    ["NORMAL", "normal", "#2E7D32"],
    ["ATENÇÃO", "atencao", "#FBC02D"],
    ["ALERTA", "alto", "#EF6C00"],
    ["EMERGÊNCIA", "severo", "#C62828"],
  ];
  for (const [grau, gravidade, cor] of cores) {
    const html = renderAlertEmailHtml({
      cidade: { nome: "Rio de Janeiro", uf: "RJ" },
      report: { dataFormatadaCurta: "28/09/2026", horaConsulta: "15:00", ventoPorPeriodo: [], condicaoGeral: "Nublado" },
      alertas: [{ tipo: "Vento", grau, gravidade, janela: "Tarde", fonteDados: "Open-Meteo" }],
    });
    if (grau === "NORMAL") {
      assert.equal(html, "");
      continue;
    }
    assert.match(html, new RegExp(cor));
    assert.match(html, /CIM/);
    assert.match(html, /Centro Integrado<br>de Monitoramento/);
    assert.match(html, /COMPARTILHADO/);
    assert.match(html, /background:#047C3E/);
    assert.match(html, /Fonte de dados: Open-Meteo/);
    assert.doesNotMatch(html, /Fonte do critério|Fonte do dado/);
  }
});
