const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { formatarRajadaPrevista } = require("../../public/weather-format");

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

// Compara a edição das 15h com a edição inicial das 08h.
function compararComManha(anterior, atual, horarioAtual = "15:00") {
  if (!anterior) return ["Relatório das 08:00 indisponível para comparação nesta base."];
  const mudancas = [];
  for (const [campo, nome] of [["grau", "Grau geral"], ["vento", "Gatilho de vento"], ["chuva", "Gatilho de chuva"]]) {
    if (anterior[campo] !== atual[campo]) mudancas.push(`${nome}: ${anterior[campo]} → ${atual[campo]}.`);
  }
  if (anterior.calor && atual.calor && anterior.calor !== atual.calor) {
    const rotulo = { NORMAL: "NORMAL", P1: "ATENÇÃO P1", P2: "ALERTA P2", P3: "EMERGÊNCIA P3" };
    mudancas.push(`Calor / risco à saúde (EHF): ${rotulo[anterior.calor]} → ${rotulo[atual.calor]}.`);
  }
  for (const [campo, nome, unidade] of [["rajadaMaxKmh", "Rajada prevista", "km/h"], ["precipitacaoTotalMm", "Chuva prevista", "mm"]]) {
    if (Number.isFinite(anterior[campo]) && Number.isFinite(atual[campo]) && anterior[campo] !== atual[campo]) {
      const antes = campo === "rajadaMaxKmh" ? formatarRajadaPrevista(anterior[campo]) : `${anterior[campo]} ${unidade}`;
      const depois = campo === "rajadaMaxKmh" ? formatarRajadaPrevista(atual[campo]) : `${atual[campo]} ${unidade}`;
      mudancas.push(`${nome} (previsão das 08:00 → previsão das ${horarioAtual}): ${antes} → ${depois}.`);
    }
  }
  const antes = anterior.fenomenos || [];
  const agora = atual.fenomenos || [];
  for (const fenomeno of agora.filter((valor) => !antes.includes(valor))) mudancas.push(`Novo enquadramento: ${fenomeno}.`);
  for (const fenomeno of antes.filter((valor) => !agora.includes(valor))) mudancas.push(`Enquadramento anterior encerrado: ${fenomeno}.`);
  return mudancas.length ? mudancas : ["Sem mudança relevante em relação ao relatório das 08:00."];
}

module.exports = { ARQUIVO, PASTA_TRAVAS, dataBrasilia, lerEstado, gravarEstado, resumo, registroHistorico, adquirirExecucao, compararComManha };
