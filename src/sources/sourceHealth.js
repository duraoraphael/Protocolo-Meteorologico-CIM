const { codigoOriginal, tipoErro } = require("./httpJsonClient");

const STATUS_FONTE = Object.freeze({
  OPERACIONAL: "operacional",
  DEGRADADO: "degradado",
  INDISPONIVEL: "indisponivel",
  NAO_CONFIGURADA: "nao_configurada",
  NAO_APLICAVEL: "nao_aplicavel",
});

function formatarDataBrasilia(valor) {
  if (!valor || !Number.isFinite(Date.parse(valor))) return null;
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(valor)).replace(",", "");
}

function criarHealthCheck(source, status, {
  checkedAt = new Date().toISOString(),
  lastSuccessAt = null,
  httpStatus = null,
  message,
  errorCode = null,
} = {}) {
  return { source, status, checkedAt, lastSuccessAt, httpStatus, message, errorCode };
}

function operacional(source, message, opcoes = {}) {
  const checkedAt = opcoes.checkedAt || new Date().toISOString();
  return criarHealthCheck(source, STATUS_FONTE.OPERACIONAL, {
    ...opcoes,
    checkedAt,
    lastSuccessAt: opcoes.lastSuccessAt || checkedAt,
    httpStatus: opcoes.httpStatus ?? 200,
    message,
  });
}

function indisponivel(source, erro, message = "Não foi possível atualizar esta fonte.", opcoes = {}) {
  return criarHealthCheck(source, STATUS_FONTE.INDISPONIVEL, {
    ...opcoes,
    message,
    httpStatus: erro?.httpStatus ?? opcoes.httpStatus ?? null,
    errorCode: erro?.code || codigoOriginal(erro) || tipoErro(erro),
  });
}

function degradado(source, erro, lastSuccessAt, opcoes = {}) {
  const data = formatarDataBrasilia(lastSuccessAt);
  return criarHealthCheck(source, STATUS_FONTE.DEGRADADO, {
    ...opcoes,
    lastSuccessAt,
    httpStatus: erro?.httpStatus ?? opcoes.httpStatus ?? null,
    errorCode: erro?.code || codigoOriginal(erro) || tipoErro(erro),
    message: data
      ? `Consulta atual indisponível. Utilizando última coleta válida de ${data}.`
      : "Consulta atual indisponível. Utilizando a última coleta válida armazenada.",
  });
}

function naoConfigurada(source, message) {
  return criarHealthCheck(source, STATUS_FONTE.NAO_CONFIGURADA, { message });
}

function naoAplicavel(source, message) {
  return criarHealthCheck(source, STATUS_FONTE.NAO_APLICAVEL, { message });
}

function paraMonitoramento(id, nome, health) {
  return {
    id,
    nome,
    ...health,
    detalhe: health.message,
  };
}

function registrarFalha(source, erro) {
  console.error(`[${source}][ERRO]`, {
    type: erro?.tipo || tipoErro(erro),
    code: erro?.code || codigoOriginal(erro),
    httpStatus: erro?.httpStatus ?? null,
    message: erro?.message || String(erro),
    cause: erro?.cause ? {
      name: erro.cause.name,
      code: codigoOriginal(erro.cause),
      message: erro.cause.message,
    } : null,
    stack: erro?.stack,
  });
}

module.exports = {
  STATUS_FONTE,
  criarHealthCheck,
  operacional,
  indisponivel,
  degradado,
  naoConfigurada,
  naoAplicavel,
  paraMonitoramento,
  formatarDataBrasilia,
  registrarFalha,
};
