const { registrarDocumentoOperacional } = require("../../src/logic/documentProvenance");

function registrarOperacionalTeste(documento, opcoes = {}) {
  documento.cidade = documento.cidade || {};
  if (!documento.cidade.chave) documento.cidade.chave = "base_teste_controlada";
  if (!documento.geradoEmISO) documento.geradoEmISO = "2026-10-13T12:00:00.000Z";
  documento.fontesPorCampo = documento.fontesPorCampo || {};
  for (const campo of ["tempMin", "tempMax", "umidadeMin", "umidadeMax", "rajadaMaxKmh", "precipitacaoTotalMm"]) {
    if (!Number.isFinite(documento[campo])) documento[campo] = 0;
    if (Number.isFinite(documento[campo]) && !documento.fontesPorCampo[campo]) {
      documento.fontesPorCampo[campo] = "Open-Meteo";
    }
  }
  return registrarDocumentoOperacional(documento, {
    fontes: ["Open-Meteo"],
    ...opcoes,
  });
}

module.exports = { registrarOperacionalTeste };
