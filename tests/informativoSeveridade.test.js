const test = require("node:test");
const assert = require("node:assert/strict");

const {
  classificarCondicoesMeteorologicas,
} = require("../src/logic/inmetAlertRules");
const {
  avaliarRiscos,
  recomendacoesDeslocamento,
  recomendacoesEdificacao,
} = require("../src/logic/riskEngine");
const brand = require("../src/render/brand");
const { renderPdfHtml } = require("../src/render/pdfTemplate");
const { renderEmailHtml } = require("../src/render/emailTemplate");
const { recomendacoes } = require("../src/logic/inmetAlertRules");
const { carregarPainel } = require("./helpers/fakeDom");

function conferir(casos, criarEntrada) {
  for (const [valor, grau, cor] of casos) {
    const resultado = classificarCondicoesMeteorologicas(criarEntrada(valor));
    assert.equal(resultado.grau, grau, `grau para ${valor}`);
    assert.equal(brand.statusVisual(resultado.grau).cor, cor, `cor para ${valor}`);
  }
}

function consolidado({ rajadaKmh = 0, chuvaHorariaMmH = 0, chuvaDiariaMm = 0 } = {}) {
  return {
    tempMax: 25,
    umidadeMin: 50,
    rajadaMaxKmh: rajadaKmh,
    precipitacaoHorariaMaxMm: chuvaHorariaMmH,
    precipitacaoTotalMm: chuvaDiariaMm,
    temTempestadeHoje: false,
    periodos: {
      manha: { periodo: "Manhã", rajadaMaxKmh: rajadaKmh, precipitacaoHorariaMaxMm: chuvaHorariaMmH, tempestade: false },
      tarde: { periodo: "Tarde", rajadaMaxKmh: 0, precipitacaoHorariaMaxMm: 0, tempestade: false },
      noite: { periodo: "Noite", rajadaMaxKmh: 0, precipitacaoHorariaMaxMm: 0, tempestade: false },
    },
    avisosInmet: [],
    mar: null,
    qualidadeAr: null,
  };
}

function relatorioRenderizado(entrada) {
  const riscos = avaliarRiscos(consolidado(entrada));
  return {
    cidade: { nome: "Rio de Janeiro", uf: "RJ", chave: "rio_de_janeiro" },
    dataFormatadaLonga: "sexta-feira, 25 de setembro de 2026",
    dataFormatadaCurta: "25/09/2026",
    horaConsulta: "13:00",
    condicaoGeral: "Parcialmente nublado",
    tempMin: 20,
    tempMax: 27,
    umidadeMin: 50,
    umidadeMax: 90,
    precipitacaoTotalMm: entrada.chuvaDiariaMm,
    tabelaTemperaturaUmidade: [],
    ventoPorPeriodo: [{ periodo: "Manhã", direcao: "NE", intensidade: "Moderado", rajadaMaxKmh: entrada.rajadaKmh, referenciaInmet: null }],
    chuvaPorPeriodo: [{ periodo: "Manhã", probabilidade: 20, precipitacaoMm: entrada.chuvaDiariaMm, resumoInmet: null }],
    mar: null,
    qualidadeAr: null,
    eventoMaisRelevante: riscos.eventoMaisRelevante,
    severidade: riscos.severidade,
    avisosInmet: [],
    divergencias: [],
    avisosColeta: [],
    deslocamento: recomendacoesDeslocamento(riscos.categoriasAtivas),
    edificacao: recomendacoesEdificacao(riscos.categoriasAtivas),
    fontes: [],
    fontesAutomatizadas: [],
    fontesManuais: [],
  };
}

test("vento usa as fronteiras do protocolo e o mapa visual solicitado", () => {
  conferir([
    [25, "NORMAL", "#FBC02D"],
    [30, "ATENÇÃO", "#F57C00"],
    [36, "ATENÇÃO", "#F57C00"],
    [39.9, "ATENÇÃO", "#F57C00"],
    [40, "ALERTA", "#D32F2F"],
    [60, "ALERTA", "#D32F2F"],
    [60.1, "EMERGÊNCIA", "#B71C1C"],
  ], (rajadaKmh) => ({ rajadaKmh }));
});

test("chuva horária usa as fronteiras do protocolo e o mapa visual solicitado", () => {
  conferir([
    [15, "NORMAL", "#FBC02D"],
    [20, "ATENÇÃO", "#F57C00"],
    [29.9, "ATENÇÃO", "#F57C00"],
    [30, "ALERTA", "#D32F2F"],
    [60, "ALERTA", "#D32F2F"],
    [60.1, "EMERGÊNCIA", "#B71C1C"],
  ], (chuvaHorariaMmH) => ({ chuvaHorariaMmH }));
});

test("maior grau entre vento e chuva determina o status geral", () => {
  assert.equal(avaliarRiscos(consolidado({ rajadaKmh: 36, chuvaHorariaMmH: 15 })).severidade.grau, "ATENÇÃO");
  assert.equal(avaliarRiscos(consolidado({ rajadaKmh: 36, chuvaHorariaMmH: 40 })).severidade.grau, "ALERTA");
  assert.equal(avaliarRiscos(consolidado({ rajadaKmh: 61, chuvaHorariaMmH: 40 })).severidade.grau, "EMERGÊNCIA");
});

test("rajada de 36 km/h aparece como ATENÇÃO laranja em tela, PDF e e-mail", () => {
  const report = relatorioRenderizado({ rajadaKmh: 36, chuvaHorariaMmH: 15, chuvaDiariaMm: 0 });
  const pdf = renderPdfHtml(report);
  const email = renderEmailHtml(report);
  const tela = carregarPainel().executar("Dashboard.home")(report);

  assert.equal(report.severidade.grau, "ATENÇÃO");
  assert.equal(report.eventoMaisRelevante.titulo, "ATENÇÃO — VENTO");
  assert.deepEqual(report.eventoMaisRelevante.recomendacoes, ["Manter o monitoramento durante o dia."]);
  assert.match(pdf, /Recomendações - Protocolo Meteorológico do COMPARTILHADO/);
  assert.match(pdf, /class="evento-titulo"[^>]*>.*ATENÇÃO — VENTO/);
  assert.match(pdf, /font-size: 15pt/);
  assert.match(pdf, /padding: 18px 20px/);

  for (const html of [pdf, email]) {
    assert.match(html, /ATENÇÃO — VENTO/);
    assert.match(html, /#F57C00/);
    assert.match(html, /Manter o monitoramento durante o dia/);
    assert.doesNotMatch(html, /Não foi identificado evento climático extremo/);
    assert.doesNotMatch(html, /Sem risco meteorológico relevante identificado/);
  }

  assert.match(tela, /nivel-atencao/);
  assert.match(tela, /ATENÇÃO — VENTO/);
  assert.match(tela, /Manter o monitoramento durante o dia/);
  assert.doesNotMatch(tela, /Sem evento extremo identificado/);
});

test("vento e chuva simultâneos permanecem visíveis com a maior severidade", () => {
  const report = relatorioRenderizado({ rajadaKmh: 36, chuvaHorariaMmH: 40, chuvaDiariaMm: 0 });
  const pdf = renderPdfHtml(report);
  const email = renderEmailHtml(report);

  assert.equal(report.severidade.grau, "ALERTA");
  assert.match(pdf, /ALERTA — CHUVA INTENSA/);
  assert.match(pdf, /ATENÇÃO — VENTO/);
  assert.match(email, /ALERTA — CHUVA INTENSA/);
  assert.match(email, /ATENÇÃO — VENTO/);
});

test("estados NORMAL, ALERTA e EMERGÊNCIA mantêm cor e classe iguais nas saídas", () => {
  const casos = [
    { rajadaMaxKmh: 25, grau: "NORMAL", corPdf: "#2E7D32", corEmail: "#2E7D32", classe: "nivel-normal", titulo: "CONDIÇÃO NORMAL" },
    { rajadaMaxKmh: 45, grau: "ALERTA", corPdf: "#D32F2F", corEmail: "#D32F2F", classe: "nivel-alerta", titulo: "ALERTA — VENTO" },
    { rajadaMaxKmh: 65, grau: "EMERGÊNCIA", corPdf: "#B71C1C", corEmail: "#B71C1C", classe: "nivel-emergencia", titulo: "EMERGÊNCIA — VENTO" },
  ];

  for (const caso of casos) {
    const report = relatorioRenderizado({ rajadaKmh: caso.rajadaMaxKmh, chuvaHorariaMmH: 15, chuvaDiariaMm: 0 });
    const pdf = renderPdfHtml(report);
    const email = renderEmailHtml(report);
    const tela = carregarPainel().executar("Dashboard.home")(report);

    assert.equal(report.severidade.grau, caso.grau);
    assert.match(pdf, new RegExp(caso.titulo));
    assert.match(email, new RegExp(caso.titulo));
    assert.match(pdf, new RegExp(caso.corPdf));
    assert.match(email, new RegExp(caso.corEmail));
    assert.match(tela, new RegExp(caso.classe));
    assert.match(tela, new RegExp(caso.titulo));
    if (caso.grau !== "NORMAL") {
      assert.match(pdf, /class="evento-titulo"/);
      assert.match(pdf, /font-size: 15pt/);
      assert.match(pdf, /font-weight: 700/);
      assert.match(pdf, /margin: 0 0 12px 0/);
    }
  }
});

test("recomendações de chuva e vento acumulam os graus anteriores", () => {
  for (const fenomeno of ["chuva", "vento"]) {
    const atencao = recomendacoes(fenomeno, "ATENÇÃO");
    const alerta = recomendacoes(fenomeno, "ALERTA");
    const emergencia = recomendacoes(fenomeno, "EMERGÊNCIA");
    assert.deepEqual(alerta.slice(0, atencao.length), atencao);
    assert.deepEqual(emergencia.slice(0, alerta.length), alerta);
    assert.ok(emergencia.length > alerta.length);
  }
});

test("trovoada exige evidência específica, e seções de segurança ficam só no PDF", () => {
  const entrada = consolidado({ rajadaKmh: 46 });
  entrada.temTempestadeHoje = true;
  const semEvidencia = avaliarRiscos(entrada);
  assert.equal(semEvidencia.eventoMaisRelevante.tipo, "ventoForte");
  entrada.avisosInmet = [{ descricao: "Tempestade", severidade: "Perigo", inicio: "14:00", fim: "18:00", riscos: [] }];
  assert.equal(avaliarRiscos(entrada).severidade.eventos.some((e) => e.tipo === "raios"), false);
  entrada.periodos.tarde.tempestade = true;
  assert.equal(avaliarRiscos(entrada).severidade.eventos.some((e) => e.tipo === "raios"), true);

  const report = relatorioRenderizado({ rajadaKmh: 46, chuvaHorariaMmH: 0, chuvaDiariaMm: 0 });
  const pdf = renderPdfHtml(report);
  const email = renderEmailHtml(report);
  assert.match(pdf, /Centro Integrado de Monitoramento/);
  assert.match(pdf, /COMPARTILHADO/);
  assert.match(pdf, /Fonte de dados:/);
  assert.match(pdf, /Deslocamento/);
  assert.match(pdf, /Edificação/);
  assert.doesNotMatch(email, /Deslocamento|Edificação/);
});

test("rajada, fonte, recomendações e motivo oficial são consistentes em tela, PDF e e-mail", () => {
  const report = relatorioRenderizado({ rajadaKmh: 41, chuvaHorariaMmH: 0, chuvaDiariaMm: 0 });
  report.severidade.eventos[0].fonteDados = "Open-Meteo";
  report.avisosInmet = [{
    descricao: "Tempestade",
    severidade: "Perigo Potencial",
    inicio: "14:00",
    fim: "18:00",
    riscos: ["Chuva entre 20 e 30 mm/h.", "Ventos intensos entre 40 e 60 km/h."],
  }];
  const painel = carregarPainel();
  const tela = painel.executar("Dashboard.home")(report);
  const detalhes = painel.executar("Dashboard.details")(report, "monitoramento");
  const pdf = renderPdfHtml(report);
  const email = renderEmailHtml(report);
  for (const html of [tela, detalhes, pdf, email]) {
    assert.match(html, /Rajada prevista: 41 km\/h/);
    assert.match(html, /Fonte de dados: Open-Meteo/);
    assert.match(html, /Recomendações - Protocolo Meteorológico do COMPARTILHADO/);
    assert.doesNotMatch(html, /Rajada máxima prevista\/registrada|A condição atingiu|Fonte de critério/);
  }
  for (const html of [detalhes, pdf, email]) {
    assert.match(html, /Motivo do aviso:.*Chuva entre 20 e 30 mm\/h\. Ventos intensos entre 40 e 60 km\/h\./);
  }
  assert.match(detalhes, /Fonte de dados: INMET/);
  assert.match(pdf, /Fonte de dados:<\/strong> INMET/);
  assert.match(email, /Fonte: INMET/);
  assert.match(pdf, /class="header-logo-cim"/);
  assert.match(pdf, /alt="CIM — Centro Integrado de Monitoramento COMPARTILHADO"/);
  assert.match(pdf, /padding: 18px 20px/);
  assert.doesNotMatch(tela + detalhes + email, /Deslocamento|Edificação/);
  assert.match(pdf, /Deslocamento/);
  assert.match(pdf, /Edificação/);
});

test("indicadores exibem oito cards em dois grupos de quatro com chuva acumulada", () => {
  const report = relatorioRenderizado({ rajadaKmh: 30, chuvaHorariaMmH: 0, chuvaDiariaMm: 12.4 });
  const tela = carregarPainel().executar("Dashboard.home")(report);
  const inicioPrimeiro = tela.indexOf('<div class="metric-group"');
  const inicioSegundo = tela.indexOf('<div class="metric-group"', inicioPrimeiro + 1);
  const fimSegundo = tela.indexOf('</section>', inicioSegundo);
  assert.ok(inicioPrimeiro >= 0 && inicioSegundo > inicioPrimeiro);
  assert.deepEqual([
    (tela.slice(inicioPrimeiro, inicioSegundo).match(/<article class="card /g) || []).length,
    (tela.slice(inicioSegundo, fimSegundo).match(/<article class="card /g) || []).length,
  ], [4, 4]);
  assert.match(tela, /Chuva acumulada/);
  assert.match(tela, /12\.4 <small>mm<\/small>/);
  assert.match(tela, /Rajada prevista/);
});

test("card da tela exibe somente a classificação dinâmica da qualidade do ar", () => {
  const report = relatorioRenderizado({ rajadaKmh: 30, chuvaHorariaMmH: 0, chuvaDiariaMm: 0 });
  report.qualidadeAr = {
    pm25Medio: 31.7,
    pm25Periodo: "média diária",
    pm25Classificacao: { nivel: "Ruim" },
  };
  report.fontesPorCampo = { "ar.pm25Medio": "Open-Meteo Air Quality" };
  const tela = carregarPainel().executar("Dashboard.home")(report);
  assert.match(tela, /Qualidade do ar/);
  assert.match(tela, /class="valor">Ruim</);
  assert.doesNotMatch(tela, /Qualidade do ar \(PM2,5\)|31\.7 µg\/m³/);
  assert.match(tela, /Open-Meteo Air Quality/);
});

test("cabeçalho do PDF alinha CIM, título/data e Petrobras em três colunas", () => {
  const report = relatorioRenderizado({ rajadaKmh: 0, chuvaHorariaMmH: 0, chuvaDiariaMm: 0 });
  report.dataFormatadaLonga = "segunda-feira, 28 de setembro de 2026";
  const html = renderPdfHtml(report);
  const cim = html.indexOf('class="header-logo-cim"');
  const centro = html.indexOf('header-center"', cim);
  const petrobras = html.indexOf('class="header-logo-petrobras"', centro);
  assert.ok(cim >= 0 && centro > cim && petrobras > centro);
  assert.match(html, /class="header-tabela"/);
  assert.match(html, /\.header-tabela td \{[^}]*vertical-align: middle/);
  assert.match(html, /\.header \{[^}]*background: #047C3E[^}]*page-break-inside: avoid/s);
  assert.match(html, /<img src="data:image\/png;base64,[^"]+" alt="Petrobras"/);
  assert.doesNotMatch(html, /class="header-horario"/);
  assert.match(html, /<strong>Hora da consulta:<\/strong>/);
  assert.match(html, /Rio de Janeiro — RJ — segunda-feira, 28 de setembro de 2026/);
  assert.match(html, /class="divisor-amarelo"/);
});
