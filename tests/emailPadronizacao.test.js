const test = require("node:test");
const assert = require("node:assert/strict");
const cheerio = require("cheerio");

const { renderEmailHtml } = require("../src/render/emailTemplate");
const { renderAlertEmailHtml } = require("../src/render/alertEmailTemplate");
const { renderWeeklyEmailHtml } = require("../src/render/weeklyEmailTemplate");
const {
  interpretarMudanca,
  renderDailyChanges,
  renderStatusChangeCard,
} = require("../src/render/emailComponents");

function semImagens(html) {
  return html.replace(/src="data:[^"]+"/g, 'src="[imagem]"');
}

function removerImagens(html) {
  return html.replace(/<img\b[^>]*>/gi, "");
}

function textoComQuebras(elemento) {
  const copia = elemento.clone();
  copia.find("br").replaceWith(" ");
  return copia.text().replace(/\s+/g, " ").trim();
}

function validarCabecalho(html, titulo) {
  const $ = cheerio.load(html);
  const cabecalho = $('[data-email-header="true"]');
  const cim = cabecalho.find('[data-email-header-cim="true"]');
  const centro = cabecalho.find('[data-email-header-title="true"]');
  const petrobras = cabecalho.find('[data-email-header-petrobras="true"]');

  assert.equal(cabecalho.length, 1, "deve existir um único header compartilhado");
  assert.equal(cim.length, 1, "a coluna esquerda do CIM não pode ficar vazia");
  assert.equal(centro.length, 1);
  assert.equal(petrobras.length, 1);
  assert.match(textoComQuebras(cim), /^CIM Centro Integrado de Monitoramento COMPARTILHADO$/);
  assert.equal(cim.find("img").length, 0, "a identidade CIM deve ser HTML, não imagem");
  assert.match(centro.text(), new RegExp(titulo));
  assert.match(cabecalho.html(), /width="31%"[^>]*width:31%/);
  assert.match(cabecalho.html(), /width="47%"[^>]*width:47%/);
  assert.match(cabecalho.html(), /width="22%"[^>]*width:22%/);
  assert.match(html, /<span style="color:#ffffff;">C<\/span><span style="color:#FEBF0A;">I<\/span><span style="color:#ffffff;">M<\/span>/);
  assert.match(html, /border-left:2px solid #ffffff/);
  assert.match(html, /Centro Integrado<br>de Monitoramento<br><span[^>]*font-weight:normal[^>]*>COMPARTILHADO<\/span>/);
  assert.match(html, /data-email-header-stripe="true"[^>]*><td bgcolor="#FFCC00" style="height:4px;background:#FFCC00/);
  assert.match(html, /bgcolor="#047C3E" style="background:#047C3E/);
  // Título e local/data no mesmo eixo central; o horário fica só no corpo.
  assert.equal(centro.attr("align"), "center");
  assert.equal(centro.find('[data-email-header-local="true"]').length, 1);
  assert.doesNotMatch(centro.text(), /Horário de Brasília/);
  assert.match(html, /letter-spacing:-3px/);
  // Petrobras em cartão branco embutido na imagem (não em CSS), por Content-ID.
  assert.match(petrobras.html(), /<img src="cid:logo-petrobras-header@cim" width="150" height="39" alt="Petrobras"/);
  assert.doesNotMatch(petrobras.html(), /background|border:\s*[1-9]/);
  assert.doesNotMatch(cabecalho.html(), /src="data:|localhost|file:/);
}

function relatorioDiario(sobrescritas = {}) {
  return {
    cidade: { nome: "Rio de Janeiro", uf: "RJ" },
    dataFormatadaLonga: "quarta-feira, 30 de setembro de 2026",
    dataFormatadaCurta: "30/09/2026",
    horaConsulta: "15:00",
    tempMin: 20,
    tempMax: 29,
    umidadeMin: 50,
    umidadeMax: 90,
    precipitacaoTotalMm: 0,
    ventoPorPeriodo: [],
    qualidadeAr: null,
    mar: null,
    condicaoGeral: "Parcialmente nublado",
    severidade: { grau: "NORMAL", eventos: [] },
    avisosInmet: [],
    fontesPorCampo: {},
    ...sobrescritas,
  };
}

function relatorioSemanal() {
  return {
    alertas: [],
    basesOrdenadas: [],
    panoramaDias: [],
    periodoLabel: "30/09 a 06/10",
    dataGeracao: "30 de setembro de 2026",
    horaGeracao: "08:00",
    totalBases: 12,
    totalBasesCriticas: 0,
    totalBasesAtencao: 0,
    totalBasesNormais: 12,
    diaMaisCritico: null,
    rotulosDias: ["30/09", "01/10"],
  };
}

test("todos os tipos de e-mail reutilizam o cabeçalho institucional completo", () => {
  const diario = renderEmailHtml(relatorioDiario());
  const alerta = renderAlertEmailHtml({
    cidade: { nome: "Macaé", uf: "RJ" },
    report: { dataFormatadaCurta: "30/09/2026", horaConsulta: "15:10", ventoPorPeriodo: [] },
    alertas: [{ tipo: "Vento", grau: "ALERTA", fonteDados: "Open-Meteo" }],
  });
  const normalizacao = renderAlertEmailHtml({
    cidade: { nome: "Macaé", uf: "RJ" },
    report: { dataFormatadaCurta: "30/09/2026", horaConsulta: "15:10", ventoPorPeriodo: [] },
    alertas: [{ tipo: "Vento", grauAnterior: "ALERTA", grau: "NORMAL", motivo: "normalizou", fonteDados: "Open-Meteo" }],
  });
  const semanal = renderWeeklyEmailHtml(relatorioSemanal());

  for (const htmlOriginal of [diario, alerta, semanal]) {
    const html = semImagens(htmlOriginal);
    assert.match(html, /max-width:850px/);
  }
  validarCabecalho(diario, "INFORMATIVO METEOROLÓGICO");
  validarCabecalho(alerta, "ALERTA METEOROLÓGICO");
  assert.equal(normalizacao, "", "Alerta CIM somente com NORMAL não gera HTML vazio de conteúdo");
  validarCabecalho(semanal, "RELATÓRIO METEOROLÓGICO SEMANAL");
  assert.match(diario, /<img src="cid:logo-petrobras-header@cim"[^>]*alt="Petrobras"/);
});

test("identidade CIM permanece completa quando todas as imagens são bloqueadas", () => {
  const htmls = [
    renderEmailHtml(relatorioDiario()),
    renderAlertEmailHtml({
      cidade: { nome: "Macaé", uf: "RJ" },
      report: { dataFormatadaCurta: "30/09/2026", horaConsulta: "15:10", ventoPorPeriodo: [] },
      alertas: [{ tipo: "Vento", grau: "ALERTA", fonteDados: "Open-Meteo" }],
    }),
    renderWeeklyEmailHtml(relatorioSemanal()),
  ];

  for (const original of htmls) {
    const $ = cheerio.load(removerImagens(original));
    const esquerda = $('[data-email-header-cim="true"]');
    assert.equal(esquerda.length, 1);
    assert.notEqual(esquerda.text().trim(), "", "o lado esquerdo não pode ficar vazio");
    assert.match(textoComQuebras(esquerda), /^CIM Centro Integrado de Monitoramento COMPARTILHADO$/);
  }
});

test("normalização isolada não gera Alerta CIM nem estrutura vazia", () => {
  const html = semImagens(renderAlertEmailHtml({
    cidade: { nome: "Macaé", uf: "RJ" },
    report: { dataFormatadaCurta: "30/09/2026", horaConsulta: "15:10", ventoPorPeriodo: [] },
    alertas: [{ tipo: "Vento", grauAnterior: "ALERTA", grau: "NORMAL", motivo: "normalizou", fonteDados: "Open-Meteo" }],
  }));
  assert.equal(html, "");
});

test("todas as transições recebem classificação e cor pelo status de destino", () => {
  const casos = [
    ["NORMAL", "ATENÇÃO", "#FBC02D", "AGRAVAMENTO"],
    ["NORMAL", "ALERTA", "#EF6C00", "AGRAVAMENTO"],
    ["NORMAL", "EMERGÊNCIA", "#C62828", "AGRAVAMENTO"],
    ["ATENÇÃO", "ALERTA", "#EF6C00", "AGRAVAMENTO"],
    ["ATENÇÃO", "NORMAL", "#2E7D32", "NORMALIZAÇÃO"],
    ["ALERTA", "ATENÇÃO", "#FBC02D", "REDUÇÃO"],
    ["ALERTA", "NORMAL", "#2E7D32", "NORMALIZAÇÃO"],
    ["ALERTA", "EMERGÊNCIA", "#C62828", "AGRAVAMENTO"],
    ["EMERGÊNCIA", "ALERTA", "#EF6C00", "REDUÇÃO"],
    ["EMERGÊNCIA", "ATENÇÃO", "#FBC02D", "REDUÇÃO"],
    ["EMERGÊNCIA", "NORMAL", "#2E7D32", "NORMALIZAÇÃO"],
  ];

  for (const [anterior, atual, cor, classificacao] of casos) {
    const html = renderStatusChangeCard({ tipo: "Vento", grauAnterior: anterior, grau: atual });
    assert.match(html, new RegExp(cor));
    assert.match(html, new RegExp(classificacao));
    assert.ok(html.includes(`${anterior} → ${atual}`));
  }
});

test("mudanças diárias aceitam acentos e três formatos de seta", () => {
  for (const entrada of [
    "Gatilho de vento: NORMAL -> ATENCAO.",
    "Gatilho de vento: NORMAL --> ATENÇÃO.",
    "Gatilho de vento: NORMAL → ATENÇÃO.",
  ]) {
    const mudanca = interpretarMudanca(entrada);
    assert.equal(mudanca.tipo, "status");
    assert.equal(mudanca.grau, "ATENÇÃO");
    const html = renderDailyChanges([entrada]);
    assert.match(html, /NORMAL → ATENÇÃO/);
    assert.match(html, /#FBC02D/);
  }
});

test("mudança apenas numérica fica visível com aparência neutra", () => {
  const html = renderDailyChanges(["Rajada prevista: 35 km/h --> 48 km/h."]);
  assert.match(html, /35 km\/h → 48 km\/h/);
  assert.match(html, /ATUALIZAÇÃO DE PREVISÃO/);
  assert.match(html, /#607D8B/);
  assert.doesNotMatch(html, /AGRAVAMENTO|REDUÇÃO|NORMALIZAÇÃO/);
});

test("novo alerta é classificado e campos estruturados continuam escapados", () => {
  const html = renderStatusChangeCard({
    tipo: '<img src=x onerror="alert(1)">',
    grau: "ALERTA",
    detalhe: "Rajada < 48 & risco > 1",
    janela: "tarde --> noite",
    fonteDados: '<script>alert("x")</script>',
  });
  assert.match(html, /NOVO ALERTA/);
  assert.match(html, /#EF6C00/);
  assert.match(html, /&lt;IMG SRC=X ONERROR=&quot;ALERT\(1\)&quot;&gt;/);
  assert.match(html, /Rajada &lt; 48 &amp; risco &gt; 1/);
  assert.match(html, /&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>/i);
});

test("templates mantêm estrutura compatível sem script, flexbox, grid ou SVG inline", () => {
  const htmls = [
    renderEmailHtml(relatorioDiario({ mudancasDia: ["Gatilho de vento: NORMAL -> ALERTA."] })),
    renderAlertEmailHtml({
      cidade: { nome: "Macaé", uf: "RJ" },
      report: { dataFormatadaCurta: "30/09/2026", horaConsulta: "15:10", ventoPorPeriodo: [] },
      alertas: [{ tipo: "Vento", grauAnterior: "NORMAL", grau: "ALERTA", fonteDados: "Open-Meteo" }],
    }),
    renderWeeklyEmailHtml(relatorioSemanal()),
  ];
  for (const original of htmls) {
    const html = semImagens(original);
    assert.doesNotMatch(html, /<script\b|display\s*:\s*(?:flex|grid)|<svg\b/i);
    assert.match(html, /table role="presentation"/);
    for (const imagem of original.match(/<img\b[^>]*>/g) || []) {
      assert.match(imagem, /alt="[^"]+"/);
      assert.match(imagem, /width="\d+"/);
      assert.match(imagem, /height:auto/);
    }
  }
});
