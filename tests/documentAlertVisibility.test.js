const test = require("node:test");
const assert = require("node:assert/strict");
const cheerio = require("cheerio");

const {
  TIPOS_DOCUMENTO,
  deveExibirNoDocumento,
  tipoDocumentoDoRelatorio,
} = require("../src/logic/alertPresentation");
const { renderPdfHtml } = require("../src/render/pdfTemplate");
const { alertasCimExibiveis, renderAlertEmailHtml } = require("../src/render/alertEmailTemplate");
const { enviarAlertaPorEmail } = require("../src/email/sendAlert");

function report(extra = {}) {
  return {
    cidade: { nome: "Macaé", uf: "RJ" },
    dataFormatadaLonga: "quarta-feira, 7 de outubro de 2026",
    dataFormatadaCurta: "07/10/2026",
    horaConsulta: "12:34",
    condicaoGeral: "Parcialmente nublado",
    tempMin: 21,
    tempMax: 29,
    tabelaTemperaturaUmidade: [],
    ventoPorPeriodo: [],
    chuvaPorPeriodo: [],
    fontesPorCampo: {},
    mar: null,
    qualidadeAr: null,
    severidade: { grau: "NORMAL", eventos: [] },
    avisosInmet: [],
    divergencias: [],
    avisosColeta: [],
    fontesAutomatizadas: [],
    fontesManuais: [],
    deslocamento: { pedestres: [], transporte: [], condutores: [] },
    edificacao: [],
    ...extra,
  };
}

function evento(grau, tipo = "Vento") {
  return {
    tipo,
    fenomeno: tipo,
    grau,
    titulo: `${tipo.toUpperCase()} — ${grau}`,
    descricao: `Condição ${grau}`,
    fonteDados: "Open-Meteo",
    recomendacoes: grau === "NORMAL" ? [] : ["Orientação cadastrada."],
  };
}

test("tipo explícito do documento prevalece sobre horário de geração", () => {
  assert.equal(tipoDocumentoDoRelatorio({ tipoDocumento: TIPOS_DOCUMENTO.INFORMATIVO_05H }), TIPOS_DOCUMENTO.INFORMATIVO_05H);
  assert.equal(tipoDocumentoDoRelatorio({ tipoDocumento: TIPOS_DOCUMENTO.INFORMATIVO_15H }), TIPOS_DOCUMENTO.INFORMATIVO_15H);
  assert.equal(tipoDocumentoDoRelatorio({ tipoDocumento: TIPOS_DOCUMENTO.EXTRAORDINARIO, horarioAgendado: "05:00" }), TIPOS_DOCUMENTO.EXTRAORDINARIO);
  assert.equal(tipoDocumentoDoRelatorio({}), TIPOS_DOCUMENTO.EXTRAORDINARIO);
});

for (const tipoDocumento of [TIPOS_DOCUMENTO.INFORMATIVO_05H, TIPOS_DOCUMENTO.INFORMATIVO_15H]) {
  test(`${tipoDocumento}: NORMAL, ATENÇÃO, ALERTA e EMERGÊNCIA são elegíveis`, () => {
    for (const nivel of ["NORMAL", "ATENÇÃO", "ALERTA", "EMERGÊNCIA"]) {
      assert.equal(deveExibirNoDocumento({ nivel, tipoDocumento }), true, nivel);
    }
  });
}

for (const tipoDocumento of [TIPOS_DOCUMENTO.EXTRAORDINARIO, TIPOS_DOCUMENTO.ALERTA_CIM]) {
  test(`${tipoDocumento}: somente ATENÇÃO, ALERTA e EMERGÊNCIA são elegíveis`, () => {
    assert.equal(deveExibirNoDocumento({ nivel: "Normal", tipoDocumento }), false);
    for (const nivel of ["Atenção", "Alerta", "Emergencial", "Emergência"]) {
      assert.equal(deveExibirNoDocumento({ nivel, tipoDocumento }), true, nivel);
    }
  });
}

test("PDF extraordinário com tudo NORMAL não cria cards nem placeholders de alerta", () => {
  const html = renderPdfHtml(report({
    tipoDocumento: TIPOS_DOCUMENTO.EXTRAORDINARIO,
    severidade: { grau: "NORMAL", eventos: [evento("NORMAL")] },
    climaSaude: { status: "operacional", dados: { nivel: { grau: "NORMAL" } } },
    avisosInmet: [{ descricao: "Sem perigo", severidade: "Normal", instrucoes: [] }],
  }));
  const $ = cheerio.load(html);
  assert.equal($(".card-alerta").length, 0);
  assert.doesNotMatch(html, /Não há recomendações cadastradas|CONDIÇÕES METEOROLÓGICAS — NORMAL/);
});

test("PDF extraordinário remove todos os cards, inclusive ATENÇÃO ou superior", () => {
  const html = renderPdfHtml(report({
    tipoDocumento: TIPOS_DOCUMENTO.EXTRAORDINARIO,
    severidade: { grau: "ALERTA", eventos: [evento("NORMAL", "Calor"), evento("ATENÇÃO"), evento("ALERTA", "Chuva intensa")] },
  }));
  assert.doesNotMatch(html, /CALOR — NORMAL|VENTO — ATENÇÃO|CHUVA INTENSA — ALERTA|class="card-alerta"/);
});

test("Alerta CIM misto filtra NORMAL antes de montar os cards", () => {
  const alertas = [evento("NORMAL", "Calor"), evento("ATENÇÃO"), evento("EMERGÊNCIA", "Chuva intensa")];
  assert.deepEqual(alertasCimExibiveis(alertas).map((a) => a.grau).sort(), ["ATENÇÃO", "EMERGÊNCIA"]);
  const html = renderAlertEmailHtml({ cidade: report().cidade, report: report(), alertas });
  assert.doesNotMatch(html, /CALOR — NORMAL/);
  assert.match(html, /VENTO — ATENÇÃO/);
  assert.match(html, /CHUVA INTENSA — EMERGÊNCIA/);
});

test("Alerta CIM ordena EMERGÊNCIA, ALERTA e ATENÇÃO; PDF omite os cards", () => {
  const alertas = [
    evento("ALERTA", "Vento"),
    evento("ATENCAO", "Tempestade"),
    evento("ATENÇÃO", "Chuva"),
    evento("EMERGENCIA", "Calor"),
  ];
  const esperado = ["Calor", "Vento", "Tempestade", "Chuva"];
  assert.deepEqual(alertasCimExibiveis(alertas).map((a) => a.tipo), esperado);

  const html = renderPdfHtml(report({
    tipoDocumento: TIPOS_DOCUMENTO.EXTRAORDINARIO,
    severidade: { grau: "EMERGÊNCIA", eventos: alertas },
  }));
  assert.doesNotMatch(html, /class="card-alerta"|CALOR \/ RISCO À SAÚDE — EMERGÊNCIA|VENTO — ALERTA/);
});

test("PDF programado também omite todos os cards de alerta", () => {
  const alertas = [
    evento("EMERGÊNCIA", "Calor"),
    evento("NORMAL", "Umidade"),
    evento("ALERTA", "Vento"),
    evento("ATENÇÃO", "Chuva"),
  ];
  const html = renderPdfHtml(report({
    tipoDocumento: TIPOS_DOCUMENTO.INFORMATIVO_05H,
    horarioAgendado: "05:00",
    severidade: { grau: "EMERGÊNCIA", eventos: alertas },
  }));
  assert.doesNotMatch(html, /class="card-alerta"|CALOR \/ RISCO À SAÚDE — EMERGÊNCIA|VENTO — ALERTA|CHUVA INTENSA — ATENÇÃO|UMIDADE — NORMAL/);
});

test("Alerta CIM apenas NORMAL é suprimido antes de destinatários e SMTP", async () => {
  const base = { chave: "base_sem_destinatario", cidade: report().cidade, report: report(), alertas: [evento("NORMAL")] };
  assert.equal(renderAlertEmailHtml(base), "");
  assert.deepEqual(await enviarAlertaPorEmail(base), {
    messageId: null,
    destinatarios: [],
    ignorado: true,
    motivo: "sem-alerta-relevante",
  });
});
