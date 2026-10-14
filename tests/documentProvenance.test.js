const test = require("node:test");
const assert = require("node:assert/strict");

const {
  marcarDocumentoSimulado,
  registrarDocumentoOperacional,
  validarDocumentoOperacional,
} = require("../src/logic/documentProvenance");
const { renderEmailHtml } = require("../src/render/emailTemplate");
const { enviarRelatorioPorEmail } = require("../src/email/sendReport");

function documentoBase() {
  return {
    cidade: { chave: "rio_de_janeiro", nome: "Rio de Janeiro", uf: "RJ" },
    geradoEmISO: "2026-10-13T12:00:00.000Z",
    dataFormatadaLonga: "terça-feira, 13 de outubro de 2026",
    dataFormatadaCurta: "13/10/2026",
    horaConsulta: "09:00",
    nomeArquivoBase: "teste-procedencia",
    tempMin: 20,
    tempMax: 30,
    umidadeMin: 50,
    umidadeMax: 90,
    rajadaMaxKmh: 35,
    precipitacaoTotalMm: 4,
    fontesPorCampo: {
      tempMin: "Open-Meteo", tempMax: "Open-Meteo",
      umidadeMin: "Open-Meteo", umidadeMax: "Open-Meteo",
      rajadaMaxKmh: "Open-Meteo", precipitacaoTotalMm: "Open-Meteo",
    },
    fontesAutomatizadas: [{ nome: "Open-Meteo" }],
    tabelaTemperaturaUmidade: [], ventoPorPeriodo: [], chuvaPorPeriodo: [],
    qualidadeAr: null, mar: null, severidade: { grau: "NORMAL", eventos: [] }, avisosInmet: [],
  };
}

test("objeto não registrado é bloqueado antes do SMTP", async () => {
  await assert.rejects(
    enviarRelatorioPorEmail(documentoBase(), Buffer.from("pdf")),
    (erro) => erro.code === "UNREGISTERED_DOCUMENT"
  );
});

test("simulação permanece bloqueada mesmo após remover as marcações visíveis", () => {
  const documento = marcarDocumentoSimulado(documentoBase());
  assert.match(renderEmailHtml(documento), /SIMULAÇÃO — NÃO ENVIAR/);
  delete documento.simulado;
  delete documento.procedencia;
  assert.throws(
    () => validarDocumentoOperacional(documento, "envio"),
    (erro) => erro.code === "SIMULATED_DOCUMENT"
  );
  assert.throws(
    () => registrarDocumentoOperacional(documento, { fontes: ["Open-Meteo"] }),
    (erro) => erro.code === "IMMUTABLE_ORIGIN" || erro.code === "SIMULATION_LOCKED"
  );
});

test("clonar um relatório operacional não copia o selo interno", () => {
  const registrado = registrarDocumentoOperacional(documentoBase(), { fontes: ["Open-Meteo"] });
  validarDocumentoOperacional(registrado, "teste", { exigirCamposCriticos: true });
  assert.throws(
    () => validarDocumentoOperacional({ ...registrado }, "envio"),
    (erro) => erro.code === "UNREGISTERED_DOCUMENT"
  );
});

test("alterar valor meteorológico depois do registro invalida o documento", () => {
  const documento = registrarDocumentoOperacional(documentoBase(), { fontes: ["Open-Meteo"] });
  documento.tempMax = 99;
  assert.throws(
    () => validarDocumentoOperacional(documento, "envio", { exigirCamposCriticos: true }),
    (erro) => erro.code === "CONTENT_TAMPERED"
  );
});

test("campo numérico sem fonte verificável bloqueia publicação", () => {
  const documento = documentoBase();
  delete documento.fontesPorCampo.tempMax;
  registrarDocumentoOperacional(documento, { fontes: ["Open-Meteo"] });
  assert.throws(
    () => validarDocumentoOperacional(documento, "publicação", { exigirCamposCriticos: true }),
    (erro) => erro.code === "UNTRACEABLE_FIELD"
  );
});

test("ausência de variável crítica bloqueia documento operacional completo", () => {
  const documento = documentoBase();
  documento.rajadaMaxKmh = null;
  documento.fontesPorCampo.rajadaMaxKmh = "Indisponível";
  registrarDocumentoOperacional(documento, { fontes: ["Open-Meteo"] });
  assert.throws(
    () => validarDocumentoOperacional(documento, "publicação", { exigirCamposCriticos: true }),
    (erro) => erro.code === "CRITICAL_DATA_UNAVAILABLE"
  );
});
