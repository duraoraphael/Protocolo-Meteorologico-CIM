const crypto = require("crypto");

const registros = new WeakMap();
const FONTE_PROIBIDA = /\bsimula(?:cao|ção|do|da|dos|das)?\b/i;

class ErroProcedencia extends Error {
  constructor(message, code = "PROVENANCE_REJECTED") {
    super(message);
    this.name = "ErroProcedencia";
    this.code = code;
  }
}

function hashMetadados(metadados) {
  return crypto.createHash("sha256").update(JSON.stringify(metadados)).digest("hex");
}

function conteudoVerificavel(documento) {
  return {
    cidade: documento?.cidade?.chave || documento?.cidade || null,
    geradoEmISO: documento?.geradoEmISO || null,
    tipoDocumento: documento?.tipoDocumento || documento?.tipo || null,
    valoresCriticos: {
      tempMin: documento?.tempMin,
      tempMax: documento?.tempMax,
      umidadeMin: documento?.umidadeMin,
      umidadeMax: documento?.umidadeMax,
      rajadaMaxKmh: documento?.rajadaMaxKmh,
      precipitacaoTotalMm: documento?.precipitacaoTotalMm,
    },
    fontesPorCampo: documento?.fontesPorCampo || null,
    previsaoDias: documento?.previsaoDias || null,
    previsaoProximosDias: documento?.previsaoProximosDias || null,
    ventoPorPeriodo: documento?.ventoPorPeriodo || null,
    chuvaPorPeriodo: documento?.chuvaPorPeriodo || null,
    chuvaPorHora: documento?.chuvaPorHora || null,
    mar: documento?.mar || null,
    qualidadeAr: documento?.qualidadeAr || null,
    climaSaude: documento?.climaSaude || null,
    avisosInmet: documento?.avisosInmet || null,
    severidade: documento?.severidade || null,
    monitorSecas: documento?.monitorSecas || null,
    corRio: documento?.corRio || null,
    bases: documento?.bases || null,
  };
}

function hashConteudo(documento) {
  return hashMetadados(conteudoVerificavel(documento));
}

function nomesFontes(documento) {
  return [...new Set([
    ...(documento?.fontesAutomatizadas || []).map((fonte) => fonte?.nome),
    ...(documento?.fontes || []).map((fonte) => fonte?.nome),
    ...Object.values(documento?.fontesPorCampo || {}),
  ].filter((fonte) => typeof fonte === "string" && fonte.trim() && fonte !== "Indisponível"))];
}

function metadadosBase(documento, opcoes = {}) {
  const fontes = [...new Set((opcoes.fontes || nomesFontes(documento)).filter(Boolean))];
  const localidade = opcoes.localidade
    || documento?.cidade?.chave
    || (documento?.tipo === "semanal" ? "multiplas-bases" : null);
  const dataReferencia = opcoes.dataReferencia
    || documento?.geradoEmISO
    || documento?.dataReferenciaISO
    || null;
  return {
    conjuntoId: crypto.randomUUID(),
    tipoDocumento: opcoes.tipo || documento?.tipoDocumento || documento?.tipo || "meteorologico",
    ambienteOrigem: opcoes.ambienteOrigem || "operacional",
    simulado: Boolean(opcoes.simulado),
    localidade,
    dataReferencia,
    consultadoEm: opcoes.consultadoEm || documento?.geradoEmISO || new Date().toISOString(),
    fontes,
    conteudoHash: hashConteudo(documento),
  };
}

function fixarRegistro(documento, metadados) {
  if (!documento || typeof documento !== "object") {
    throw new ErroProcedencia("Documento meteorológico inválido.", "INVALID_DOCUMENT");
  }
  const existente = registros.get(documento);
  if (existente) {
    if (existente.simulado !== metadados.simulado) {
      throw new ErroProcedencia("A natureza do documento não pode ser reclassificada.", "IMMUTABLE_ORIGIN");
    }
    return documento;
  }
  const integridade = hashMetadados(metadados);
  const registro = Object.freeze({ ...metadados, integridade });
  registros.set(documento, registro);
  documento.procedencia = registro;
  if (registro.simulado) documento.simulado = true;
  return documento;
}

function registrarDocumentoOperacional(documento, opcoes = {}) {
  if (documento?.simulado || documento?.procedencia?.simulado) {
    throw new ErroProcedencia("Documento marcado como simulação não pode ser promovido a operacional.", "SIMULATION_LOCKED");
  }
  const metadados = metadadosBase(documento, { ...opcoes, ambienteOrigem: "operacional", simulado: false });
  if (!metadados.localidade || !Number.isFinite(Date.parse(metadados.dataReferencia || ""))) {
    throw new ErroProcedencia("Documento sem localidade ou data de referência verificável.", "INCOMPLETE_PROVENANCE");
  }
  if (!metadados.fontes.length || metadados.fontes.some((fonte) => FONTE_PROIBIDA.test(fonte))) {
    throw new ErroProcedencia("Documento sem fonte operacional válida ou com fonte removida.", "INVALID_SOURCE");
  }
  return fixarRegistro(documento, metadados);
}

function marcarDocumentoSimulado(documento, opcoes = {}) {
  return fixarRegistro(documento, metadadosBase(documento, {
    ...opcoes,
    ambienteOrigem: "teste",
    simulado: true,
    fontes: opcoes.fontes || ["Dados artificiais de teste"],
    dataReferencia: opcoes.dataReferencia || documento?.geradoEmISO || new Date().toISOString(),
    localidade: opcoes.localidade || documento?.cidade?.chave || documento?.cidade?.nome || "cenario-de-teste",
  }));
}

function atualizarAssinaturaDocumentoOperacional(documento) {
  const existente = registros.get(documento);
  if (!existente || existente.simulado || existente.ambienteOrigem !== "operacional") {
    throw new ErroProcedencia("Somente documento operacional registrado pode concluir a composição.", "INVALID_RESEAL");
  }
  const { integridade: _integridade, conteudoHash: _conteudoHash, ...base } = existente;
  const metadados = { ...base, conteudoHash: hashConteudo(documento) };
  const registro = Object.freeze({ ...metadados, integridade: hashMetadados(metadados) });
  registros.set(documento, registro);
  documento.procedencia = registro;
  return documento;
}

function validarFontesDosCampos(documento, { exigirCamposCriticos = false } = {}) {
  if (documento?.tipo === "semanal" || documento?.tipoDocumento === "AVISO_COR_RIO") return;
  const fontes = documento?.fontesPorCampo;
  if (!fontes || typeof fontes !== "object") {
    throw new ErroProcedencia("Relatório meteorológico sem rastreabilidade por campo.", "MISSING_FIELD_SOURCES");
  }
  const campos = ["tempMin", "tempMax", "umidadeMin", "umidadeMax", "rajadaMaxKmh", "precipitacaoTotalMm"];
  for (const campo of campos) {
    if (!Number.isFinite(documento[campo])) {
      if (exigirCamposCriticos) {
        throw new ErroProcedencia(`Campo crítico indisponível: ${campo}.`, "CRITICAL_DATA_UNAVAILABLE");
      }
      continue;
    }
    const fonte = fontes[campo];
    if (!fonte || fonte === "Indisponível" || FONTE_PROIBIDA.test(fonte)) {
      throw new ErroProcedencia(`Campo operacional sem fonte verificável: ${campo}.`, "UNTRACEABLE_FIELD");
    }
  }
}

function validarDocumentoOperacional(documento, finalidade = "operação", opcoes = {}) {
  const registro = registros.get(documento);
  if (!registro) {
    throw new ErroProcedencia(`Documento sem registro interno de procedência; ${finalidade} bloqueada.`, "UNREGISTERED_DOCUMENT");
  }
  if (registro.simulado || documento?.simulado || documento?.procedencia?.simulado) {
    throw new ErroProcedencia(`Documento simulado; ${finalidade} bloqueada.`, "SIMULATED_DOCUMENT");
  }
  const { integridade, ...semIntegridade } = registro;
  if (documento.procedencia !== registro || hashMetadados(semIntegridade) !== integridade) {
    throw new ErroProcedencia(`Metadados de procedência alterados; ${finalidade} bloqueada.`, "PROVENANCE_TAMPERED");
  }
  if (hashConteudo(documento) !== registro.conteudoHash) {
    throw new ErroProcedencia(`Conteúdo meteorológico alterado após a validação; ${finalidade} bloqueada.`, "CONTENT_TAMPERED");
  }
  if (registro.ambienteOrigem !== "operacional" || !registro.fontes.length || registro.fontes.some((fonte) => FONTE_PROIBIDA.test(fonte))) {
    throw new ErroProcedencia(`Fonte ou ambiente de origem inválido; ${finalidade} bloqueada.`, "INVALID_ORIGIN");
  }
  validarFontesDosCampos(documento, opcoes);
  return registro;
}

function documentoEhSimulado(documento) {
  return Boolean(registros.get(documento)?.simulado || documento?.simulado || documento?.procedencia?.simulado);
}

module.exports = {
  ErroProcedencia,
  registrarDocumentoOperacional,
  marcarDocumentoSimulado,
  atualizarAssinaturaDocumentoOperacional,
  validarDocumentoOperacional,
  documentoEhSimulado,
};
