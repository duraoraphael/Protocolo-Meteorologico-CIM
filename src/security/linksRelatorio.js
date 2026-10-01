// Links temporários para baixar PDFs de /relatorios (V-07).
//
// Cada geração pelo painel cria um token aleatório de 256 bits, válido por
// 24 h e só para aquele arquivo. Os tokens ficam em memória: um reinício do
// servidor invalida os links (quem tem a senha continua podendo baixar).
const crypto = require("node:crypto");

const VALIDADE_PADRAO_MS = 24 * 60 * 60 * 1000;
const MAX_TOKENS_PADRAO = 5000;

function criarLinksRelatorio({ validadeMs = VALIDADE_PADRAO_MS, maxTokens = MAX_TOKENS_PADRAO, agora = Date.now } = {}) {
  const tokens = new Map(); // token -> { arquivo, expira }

  function limparExpirados() {
    const t = agora();
    for (const [token, registro] of tokens) if (registro.expira <= t) tokens.delete(token);
  }

  function gerar(arquivo) {
    limparExpirados();
    // Limite de memória: descarta os mais antigos (Map mantém a ordem de inserção).
    while (tokens.size >= maxTokens) tokens.delete(tokens.keys().next().value);
    const token = crypto.randomBytes(32).toString("base64url");
    const expira = agora() + validadeMs;
    tokens.set(token, { arquivo, expira });
    return { token, expiraEmISO: new Date(expira).toISOString() };
  }

  function valido(token, arquivo) {
    if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token)) return false;
    const registro = tokens.get(token);
    if (!registro) return false;
    if (registro.expira <= agora()) {
      tokens.delete(token);
      return false;
    }
    return registro.arquivo === arquivo;
  }

  return { gerar, valido, get tamanho() { return tokens.size; } };
}

/** Senha enviada por HTTP Basic (usuário é ignorado), ou undefined. */
function senhaDoBasicAuth(req) {
  const cab = req.headers?.authorization;
  if (typeof cab !== "string" || cab.length > 2048) return undefined;
  const m = /^Basic\s+([A-Za-z0-9+/=]+)$/i.exec(cab.trim());
  if (!m) return undefined;
  const decodificado = Buffer.from(m[1], "base64").toString("utf8");
  const i = decodificado.indexOf(":");
  return i >= 0 ? decodificado.slice(i + 1) : undefined;
}

module.exports = { criarLinksRelatorio, senhaDoBasicAuth, VALIDADE_PADRAO_MS };
