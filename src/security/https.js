// HTTPS direto no Node (V-03) e interface de escuta (V-14).
//
// HTTPS_PFX_PATH + HTTPS_PFX_SENHA definidas -> sobe https.createServer com o
// certificado .pfx (CA corporativa) em HTTPS_PORTA (padrão 3443) e mantém
// um listener HTTP em PORTA (padrão 3210) que só redireciona para HTTPS —
// assim o link antigo da TV (http://servidor:3210) continua funcionando.
// Só uma das duas definida -> erro de configuração (o servidor não sobe em
// HTTP achando que está protegido).
//
// HOST define a interface (ex.: 127.0.0.1 atrás de proxy reverso). Vazio =
// todas as interfaces (comportamento anterior).
const fs = require("node:fs");

function opcoesDeRede(env = process.env) {
  const host = (env.HOST || "").trim() || undefined;
  const caminhoPfx = (env.HTTPS_PFX_PATH || "").trim();
  const senhaPfx = env.HTTPS_PFX_SENHA;
  const temSenha = typeof senhaPfx === "string" && senhaPfx.length > 0;

  if (!caminhoPfx && !temSenha) return { modo: "http", host };
  if (!caminhoPfx || !temSenha) {
    return { modo: "erro", host, erro: "Para HTTPS defina HTTPS_PFX_PATH e HTTPS_PFX_SENHA juntas." };
  }
  const portaHttps = Number.parseInt(env.HTTPS_PORTA || "3443", 10);
  if (!Number.isInteger(portaHttps) || portaHttps < 1 || portaHttps > 65535) {
    return { modo: "erro", host, erro: "HTTPS_PORTA inválida." };
  }
  return { modo: "https", host, caminhoPfx, senhaPfx, portaHttps };
}

/** Lê o .pfx; em caso de falha devolve só o código do erro (sem a senha). */
function carregarPfx(caminho) {
  try {
    return { pfx: fs.readFileSync(caminho) };
  } catch (erro) {
    return { erro: `Não foi possível ler o certificado em HTTPS_PFX_PATH (${erro.code || "erro"}).` };
  }
}

const HOST_VALIDO = /^(?:\[[0-9a-f:.]+\]|[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?)$/i;

/**
 * Handler HTTP puro que responde 308 para a mesma URL em https.
 * `hostPublico` (HTTPS_HOST_PUBLICO) fixa o nome usado no redirecionamento;
 * sem ele, usa o Host da requisição (validado).
 */
function redirecionarParaHttps(portaHttps, hostPublico) {
  const sufixoPorta = portaHttps === 443 ? "" : `:${portaHttps}`;
  return function redirecionar(req, res) {
    const hostCabecalho = String(req.headers.host || "").trim();
    const nome = (hostPublico || hostCabecalho.replace(/:\d+$/, "")).trim();
    if (!HOST_VALIDO.test(nome)) {
      res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Host inválido.");
      return;
    }
    const caminho = typeof req.url === "string" && req.url.startsWith("/") && !req.url.startsWith("//") ? req.url : "/";
    res.writeHead(308, {
      Location: `https://${nome}${sufixoPorta}${caminho}`,
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end("Use HTTPS.");
  };
}

module.exports = { opcoesDeRede, carregarPfx, redirecionarParaHttps };
