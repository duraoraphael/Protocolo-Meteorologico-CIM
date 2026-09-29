const fs = require("node:fs");
const path = require("node:path");

const ARQUIVO = path.join(__dirname, "..", "..", "data", "relatorios-agendados.json");

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
    geradoEmISO: report.geradoEmISO,
  };
}

function compararComManha(anterior, atual) {
  if (!anterior) return ["Relatório das 05:00 indisponível para comparação nesta base."];
  const mudancas = [];
  for (const [campo, nome] of [["grau", "Grau geral"], ["vento", "Gatilho de vento"], ["chuva", "Gatilho de chuva"]]) {
    if (anterior[campo] !== atual[campo]) mudancas.push(`${nome}: ${anterior[campo]} → ${atual[campo]}.`);
  }
  for (const [campo, nome, unidade] of [["rajadaMaxKmh", "Rajada prevista", "km/h"], ["precipitacaoTotalMm", "Chuva acumulada prevista", "mm"]]) {
    if (Number.isFinite(anterior[campo]) && Number.isFinite(atual[campo]) && anterior[campo] !== atual[campo]) {
      mudancas.push(`${nome} (previsão das 05:00 → previsão das 15:00): ${anterior[campo]} ${unidade} → ${atual[campo]} ${unidade}.`);
    }
  }
  const antes = anterior.fenomenos || [];
  const agora = atual.fenomenos || [];
  for (const fenomeno of agora.filter((valor) => !antes.includes(valor))) mudancas.push(`Novo enquadramento: ${fenomeno}.`);
  for (const fenomeno of antes.filter((valor) => !agora.includes(valor))) mudancas.push(`Enquadramento anterior encerrado: ${fenomeno}.`);
  return mudancas.length ? mudancas : ["Sem mudança relevante em relação ao relatório das 05:00."];
}

module.exports = { ARQUIVO, dataBrasilia, lerEstado, gravarEstado, resumo, compararComManha };
