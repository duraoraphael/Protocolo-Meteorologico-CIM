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
const { montarOcorrencias } = require("../src/logic/ocorrenciasPainel");
const { VISUAL_NIVEL } = require("../src/render/alertCards");

// Texto visível do documento (rótulos em <strong>, quebras de linha como espaço).
function textoPlano(html) {
  return html.replace(/<br\s*\/?>/g, " ").replace(/<[^>]+>/g, "").replace(/\s+/g, " ");
}

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
  const report = {
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
  report.ocorrencias = montarOcorrencias(report);
  return report;
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

test("rajada de 36 km/h aparece como ATENÇÃO em tela (laranja), PDF e e-mail (amarelo)", () => {
  const report = relatorioRenderizado({ rajadaKmh: 36, chuvaHorariaMmH: 15, chuvaDiariaMm: 0 });
  const pdf = renderPdfHtml(report);
  const email = renderEmailHtml(report);
  const tela = carregarPainel().executar("Dashboard.home")(report);

  assert.equal(report.severidade.grau, "ATENÇÃO");
  assert.equal(report.eventoMaisRelevante.titulo, "VENTO — ATENÇÃO");
  assert.deepEqual(report.eventoMaisRelevante.recomendacoes, ["Manter o monitoramento durante o dia."]);
  assert.match(pdf, /class="card-alerta-titulo"[^>]*>.*VENTO — ATENÇÃO/);
  assert.match(pdf, /class="card-alerta-rec-titulo"[^>]*>RECOMENDAÇÕES</);

  for (const html of [pdf, email]) {
    assert.match(html, /VENTO — ATENÇÃO/);
    assert.ok(html.includes(VISUAL_NIVEL["ATENÇÃO"].cor));
    assert.match(html, /RECOMENDAÇÕES/);
    assert.match(html, /Protocolo Meteorológico do COMPARTILHADO/);
    assert.match(html, /Manter o monitoramento durante o dia/);
    assert.doesNotMatch(html, /Não foi identificado evento climático extremo/);
    assert.doesNotMatch(html, /Sem risco meteorológico relevante identificado/);
  }

  // Painel: card compacto na cor de Atenção; recomendações ficam nos detalhes.
  assert.match(tela, /class="ocorrencia nivel-atencao"/);
  assert.match(tela, /aria-label="VENTO — ATENÇÃO"/);
  assert.doesNotMatch(tela, /Manter o monitoramento durante o dia/);
  assert.doesNotMatch(tela, /sem-ocorrencias/);
  const detalhe = carregarPainel().executar("Dashboard.details")(report, "ocorrencia:oc-1");
  assert.match(detalhe, /Manter o monitoramento durante o dia/);
  assert.match(detalhe, /Recomendações - Protocolo Meteorológico do COMPARTILHADO/);
});

test("vento e chuva simultâneos permanecem visíveis com a maior severidade", () => {
  const report = relatorioRenderizado({ rajadaKmh: 36, chuvaHorariaMmH: 40, chuvaDiariaMm: 0 });
  const pdf = renderPdfHtml(report);
  const email = renderEmailHtml(report);

  assert.equal(report.severidade.grau, "ALERTA");
  assert.match(pdf, /CHUVA INTENSA — ALERTA/);
  assert.match(pdf, /VENTO — ATENÇÃO/);
  assert.match(email, /CHUVA INTENSA — ALERTA/);
  assert.match(email, /VENTO — ATENÇÃO/);
});

test("NORMAL não gera card; ALERTA e EMERGÊNCIA mantêm cor e classe iguais nas saídas", () => {
  const casos = [
    { rajadaMaxKmh: 25, grau: "NORMAL", classe: "sem-ocorrencias", tela: "Nenhuma ocorrência ativa" },
    { rajadaMaxKmh: 45, grau: "ALERTA", classe: "ocorrencia nivel-alerta", titulo: "VENTO — ALERTA", tela: "VENTO — ALERTA" },
    { rajadaMaxKmh: 65, grau: "EMERGÊNCIA", classe: "ocorrencia nivel-emergencia", titulo: "VENTO — EMERGÊNCIA", tela: "VENTO — EMERGÊNCIA" },
  ];

  for (const caso of casos) {
    const report = relatorioRenderizado({ rajadaKmh: caso.rajadaMaxKmh, chuvaHorariaMmH: 15, chuvaDiariaMm: 0 });
    const pdf = renderPdfHtml(report);
    const email = renderEmailHtml(report);
    const tela = carregarPainel().executar("Dashboard.home")(report);

    assert.equal(report.severidade.grau, caso.grau);
    assert.match(tela, new RegExp(caso.classe));
    assert.match(tela, new RegExp(caso.tela));
    if (caso.grau === "NORMAL") {
      assert.doesNotMatch(pdf, /CONDIÇÕES METEOROLÓGICAS — NORMAL|class="card-alerta"/);
      assert.doesNotMatch(email, /CONDIÇÕES METEOROLÓGICAS — NORMAL/);
      assert.doesNotMatch(tela, /class="ocorrencia /, "sem cards vazios");
    } else {
      assert.match(pdf, new RegExp(caso.titulo));
      assert.match(email, new RegExp(caso.titulo));
      const v = VISUAL_NIVEL[caso.grau];
      assert.ok(pdf.includes(`data-nivel="${caso.grau}" style="border-color:${v.cor};background:${v.fundo};"`));
      assert.ok(email.includes(`background:${v.fundo};border:1.5px solid ${v.cor}`));
      assert.match(pdf, new RegExp(`class="card-alerta-titulo"[^>]*style="color:${v.texto};"`));
      assert.match(email, new RegExp(`data-alert-title="true" style="color:${v.texto};`));
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
  report.ocorrencias = montarOcorrencias(report);
  const painel = carregarPainel();
  const tela = painel.executar("Dashboard.home")(report);
  const detalhes = painel.executar("Dashboard.details")(report, "monitoramento");
  const idVento = report.ocorrencias.find((o) => o.fenomeno === "vento").id;
  const detalheVento = painel.executar("Dashboard.details")(report, `ocorrencia:${idVento}`);
  const pdf = renderPdfHtml(report);
  const email = renderEmailHtml(report);
  // Card compacto: valor, fonte e o texto oficial do aviso, sem encaminhamento genérico.
  assert.match(tela, /<dt>Rajada prevista<\/dt><dd>41 km\/h<\/dd>/);
  assert.match(tela, /Fonte: Open-Meteo/);
  assert.match(tela, /Chuva entre 20 e 30 mm\/h\. Ventos intensos entre 40 e 60 km\/h\./);
  assert.doesNotMatch(tela, /consulte o (texto|site|aviso)/i);
  assert.match(detalheVento, /Recomendações - Protocolo Meteorológico do COMPARTILHADO/);
  for (const html of [detalheVento, textoPlano(pdf), textoPlano(email)]) {
    assert.match(html, /Rajada prevista: 41 km\/h/);
    assert.match(html, /Fonte de dados: Open-Meteo/);
    assert.doesNotMatch(html, /Rajada máxima prevista\/registrada|A condição atingiu|Fonte de critério/);
  }
  for (const html of [pdf, email]) {
    assert.match(textoPlano(html), /RECOMENDAÇÕES Protocolo Meteorológico do COMPARTILHADO/);
  }
  for (const html of [detalhes, textoPlano(pdf), textoPlano(email)]) {
    assert.match(html, /Motivo do aviso:.*Chuva entre 20 e 30 mm\/h\. Ventos intensos entre 40 e 60 km\/h\./);
  }
  assert.match(detalhes, /Fonte de dados: INMET/);
  assert.match(pdf, /Fonte de dados:<\/strong> INMET/);
  assert.match(email, /Fonte de dados:<\/strong> INMET/);
  assert.match(pdf, /class="header-logo-cim"/);
  assert.match(pdf, /alt="CIM — Centro Integrado de Monitoramento COMPARTILHADO"/);
  assert.doesNotMatch(tela + detalhes + email, /Deslocamento|Edificação/);
  assert.match(pdf, /Deslocamento/);
  assert.match(pdf, /Edificação/);
});

test("indicadores ficam em uma grade única, com Calor e Saúde e mar só quando aplicável", () => {
  const report = relatorioRenderizado({ rajadaKmh: 30, chuvaHorariaMmH: 0, chuvaDiariaMm: 12.4 });
  const painel = carregarPainel();
  const grade = (html) => {
    const inicio = html.indexOf('<div class="grid-cards">');
    return html.slice(inicio, html.indexOf("</section>", inicio));
  };
  const tela = painel.executar("Dashboard.home")(report);
  assert.equal((grade(tela).match(/<article class="card /g) || []).length, 8);
  assert.match(grade(tela), /Calor e Saúde/);
  assert.doesNotMatch(tela, /Mar — altura máx\. de onda|Condições de mar por período/, "base sem mar não exibe indicadores marítimos");
  const costeira = { ...report, mar: { alturaMaxDiaM: 1.2, estadoMarDia: "Moderado", periodos: [] } };
  const telaCosteira = painel.executar("Dashboard.home")(costeira);
  assert.equal((grade(telaCosteira).match(/<article class="card /g) || []).length, 9);
  assert.match(telaCosteira, /Mar — altura máx\. de onda/);
  assert.match(telaCosteira, /Condições de mar por período/);
  assert.ok(tela.indexOf("grid-cards") < tela.indexOf("tables-grid"), "tabelas abaixo dos indicadores");
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
