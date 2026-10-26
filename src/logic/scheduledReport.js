const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const ARQUIVO = path.join(__dirname, "..", "..", "data", "relatorios-agendados.json");
const PASTA_TRAVAS = path.join(__dirname, "..", "..", "data", "travas-agendador");

function dataBrasilia(data = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(data);
}

function lerEstado() {
  try {
    const estado = JSON.parse(fs.readFileSync(ARQUIVO, "utf8"));
    if (!estado || typeof estado !== "object" || Array.isArray(estado)) throw new Error("Estado de agendamento inválido.");
    return estado;
  } catch (erro) {
    if (erro.code === "ENOENT") return {};
    throw erro;
  }
}

function gravarEstado(estado) {
  fs.mkdirSync(path.dirname(ARQUIVO), { recursive: true });
  const temporario = `${ARQUIVO}.${process.pid}.tmp`;
  fs.writeFileSync(temporario, JSON.stringify(estado, null, 2), "utf8");
  fs.renameSync(temporario, ARQUIVO);
}

function resumo(report) {
  return {
    grau: report.severidade?.grau || "NORMAL",
    vento: report.severidade?.vento?.grau || "NORMAL",
    chuva: report.severidade?.chuva?.grau || "NORMAL",
    fenomenos: (report.severidade?.eventos || []).map((evento) => evento.titulo),
    rajadaMaxKmh: report.rajadaMaxKmh,
    precipitacaoTotalMm: report.precipitacaoTotalMm,
    calor: report.climaSaude?.status === "operacional" ? report.climaSaude.dados?.nivel?.protocolo || "NORMAL" : null,
    geradoEmISO: report.geradoEmISO,
  };
}

function registroHistorico(report, enviadoEmISO = new Date().toISOString()) {
  return {
    enviadoEmISO,
    tipoDocumento: report.tipoDocumento || null,
    edicao: report.validadeInformativo ? { ...report.validadeInformativo } : null,
    resumo: resumo(report),
  };
}

// A criação exclusiva do arquivo é atômica também entre processos Node. A
// trava permanece após sucesso para que reinícios no mesmo dia não reenviem.
function adquirirExecucao(chave, { pasta = PASTA_TRAVAS, agora = new Date() } = {}) {
  fs.mkdirSync(pasta, { recursive: true });
  const hash = crypto.createHash("sha256").update(chave).digest("hex");
  const arquivo = path.join(pasta, `${hash}.lock`);
  const executionId = crypto.randomUUID();
  const registro = { chave, executionId, status: "em_andamento", iniciadoEmISO: agora.toISOString(), pid: process.pid };
  let descritor;
  try {
    descritor = fs.openSync(arquivo, "wx");
    fs.writeFileSync(descritor, JSON.stringify(registro, null, 2), "utf8");
    fs.closeSync(descritor);
  } catch (erro) {
    if (descritor !== undefined) try { fs.closeSync(descritor); } catch {}
    if (erro.code === "EEXIST") return { adquirida: false, arquivo, executionId: null };
    throw erro;
  }
  return {
    adquirida: true,
    arquivo,
    executionId,
    concluir(status, detalhe = null) {
      const final = { ...registro, status, detalhe, finalizadoEmISO: new Date().toISOString() };
      fs.writeFileSync(arquivo, JSON.stringify(final, null, 2), "utf8");
    },
    liberar() {
      try { fs.unlinkSync(arquivo); } catch (erro) { if (erro.code !== "ENOENT") throw erro; }
    },
  };
}

module.exports = { ARQUIVO, PASTA_TRAVAS, dataBrasilia, lerEstado, gravarEstado, resumo, registroHistorico, adquirirExecucao };
