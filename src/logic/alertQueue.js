const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const ARQUIVO_FILA = process.env.ALERTAS_FILA_ARQUIVO || path.join(__dirname, "..", "..", "data", "alertas-fila.json");
const LOCK_EXPIRA_MS = 5 * 60 * 1000;

function estadoVazio() {
  return { versao: 1, eventos: {} };
}

function carregarFila(arquivo = ARQUIVO_FILA) {
  try {
    const dados = JSON.parse(fs.readFileSync(arquivo, "utf8"));
    return dados?.versao === 1 && dados.eventos && typeof dados.eventos === "object" ? dados : estadoVazio();
  } catch (erro) {
    if (erro.code === "ENOENT") return estadoVazio();
    throw new Error(`Fila de alertas ilegível; envio suspenso para evitar duplicidade: ${erro.message}`, { cause: erro });
  }
}

function salvarFila(fila, arquivo = ARQUIVO_FILA) {
  fs.mkdirSync(path.dirname(arquivo), { recursive: true });
  const temporario = `${arquivo}.${process.pid}.tmp`;
  fs.writeFileSync(temporario, JSON.stringify(fila, null, 2), "utf8");
  fs.renameSync(temporario, arquivo);
}

function comTrava(arquivo, executar) {
  fs.mkdirSync(path.dirname(arquivo), { recursive: true });
  const lock = `${arquivo}.lock`;
  let descritor;
  try {
    try {
      descritor = fs.openSync(lock, "wx");
    } catch (erro) {
      if (erro.code !== "EEXIST") throw erro;
      const idade = Date.now() - fs.statSync(lock).mtimeMs;
      if (idade <= LOCK_EXPIRA_MS) return { adquirido: false };
      fs.unlinkSync(lock);
      descritor = fs.openSync(lock, "wx");
    }
    return { adquirido: true, resultado: executar() };
  } finally {
    if (descritor !== undefined) fs.closeSync(descritor);
    if (descritor !== undefined) {
      try { fs.unlinkSync(lock); } catch (erro) { if (erro.code !== "ENOENT") throw erro; }
    }
  }
}

function idEvento(base) {
  const partes = (base.alertas || []).map((alerta) => alerta.fingerprint || [
    alerta.assinatura, alerta.grau, alerta.motivo, alerta.janela,
  ].join("|")).sort();
  return crypto.createHash("sha256").update(`${base.chave}|${partes.join("||")}`).digest("hex");
}

function prioridade(base) {
  const pesos = { normal: 0, atencao: 1, alto: 2, severo: 3 };
  return Math.max(0, ...(base.alertas || []).map((alerta) => pesos[alerta.gravidade] || 0));
}

function enfileirar(base, destinatarios, { arquivo = ARQUIVO_FILA, agora = new Date() } = {}) {
  const id = idEvento(base);
  const trava = comTrava(arquivo, () => {
    const fila = carregarFila(arquivo);
    if (!fila.eventos[id]) {
      fila.eventos[id] = {
        id,
        base: base.chave,
        cidade: base.cidade?.nome || base.chave,
        uf: base.cidade?.uf || null,
        fenomenos: (base.alertas || []).map((alerta) => alerta.tipo),
        severidade: (base.alertas || []).map((alerta) => alerta.grau),
        transicoes: (base.alertas || []).map((alerta) => ({
          assinatura: alerta.assinatura || null,
          fenomeno: alerta.tipo || alerta.assinatura || null,
          severidadeAnterior: alerta.grauAnterior || null,
          severidadeAtual: alerta.grau || null,
          tipoAlteracao: alerta.motivo || null,
          fonteMeteorologica: alerta.fonteDados || alerta.origem || null,
          periodoReferencia: alerta.janela || null,
          naturezaDado: alerta.naturezaDado || null,
          fingerprint: alerta.fingerprint || null,
        })),
        destinatarios: [...new Set(destinatarios || [])],
        prioridade: prioridade(base),
        detectadoEm: agora.toISOString(),
        status: "pendente",
        tentativas: 0,
        proximaTentativaEm: null,
        enviadoEm: null,
        messageId: null,
        ultimoErro: null,
      };
      salvarFila(fila, arquivo);
    }
    return fila.eventos[id];
  });
  return { id, ...(trava.adquirido ? trava.resultado : { status: "ocupado" }) };
}

function assumir(id, { arquivo = ARQUIVO_FILA, agora = new Date() } = {}) {
  const trava = comTrava(arquivo, () => {
    const fila = carregarFila(arquivo);
    const evento = fila.eventos[id];
    if (!evento || evento.status === "enviado") return null;
    const agoraMs = agora.getTime();
    const processandoExpirado = evento.status === "processando" &&
      (!evento.leaseAte || Date.parse(evento.leaseAte) <= agoraMs);
    if (evento.status === "processando" && !processandoExpirado) return null;
    if (evento.proximaTentativaEm && Date.parse(evento.proximaTentativaEm) > agoraMs) return null;
    evento.status = "processando";
    evento.tentativas += 1;
    evento.leaseAte = new Date(agoraMs + LOCK_EXPIRA_MS).toISOString();
    evento.ultimaTentativaEm = agora.toISOString();
    salvarFila(fila, arquivo);
    return { ...evento };
  });
  return trava.adquirido ? trava.resultado : null;
}

function marcarEnviado(id, envio, { arquivo = ARQUIVO_FILA, agora = new Date() } = {}) {
  return comTrava(arquivo, () => {
    const fila = carregarFila(arquivo);
    const evento = fila.eventos[id];
    if (!evento) return null;
    Object.assign(evento, {
      status: "enviado", enviadoEm: agora.toISOString(), messageId: envio?.messageId || null,
      leaseAte: null, proximaTentativaEm: null, ultimoErro: null,
    });
    salvarFila(fila, arquivo);
    return { ...evento };
  }).resultado || null;
}

function marcarFalha(id, erro, { arquivo = ARQUIVO_FILA, agora = new Date() } = {}) {
  return comTrava(arquivo, () => {
    const fila = carregarFila(arquivo);
    const evento = fila.eventos[id];
    if (!evento) return null;
    const atrasoMinutos = Math.min(60, 2 ** Math.max(0, evento.tentativas - 1) * 5);
    Object.assign(evento, {
      status: "pendente", leaseAte: null,
      proximaTentativaEm: new Date(agora.getTime() + atrasoMinutos * 60_000).toISOString(),
      ultimoErro: String(erro?.message || erro || "Falha desconhecida").slice(0, 500),
    });
    salvarFila(fila, arquivo);
    return { ...evento };
  }).resultado || null;
}

module.exports = {
  ARQUIVO_FILA,
  carregarFila,
  enfileirar,
  assumir,
  marcarEnviado,
  marcarFalha,
  idEvento,
};
