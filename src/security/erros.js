// Tratamento final de erros e 404 da API (V-09).
//
// Nunca devolve stack trace, caminhos ou mensagens internas ao cliente —
// inclusive para JSON malformado (400) e corpo acima do limite (413), que
// antes caíam no handler padrão do Express. O detalhe vai só para o console.
// O corpo da requisição nunca é registrado (pode conter a senha).

const MENSAGENS = {
  400: "Requisição inválida.",
  401: "Não autorizado.",
  403: "Acesso negado.",
  404: "Não encontrado.",
  405: "Método não permitido.",
  413: "Requisição muito grande.",
  415: "Tipo de conteúdo não suportado.",
};

function statusDoErro(erro) {
  const s = Number(erro && (erro.status || erro.statusCode));
  return Number.isInteger(s) && s >= 400 && s <= 599 ? s : 500;
}

function naoEncontrado(req, res) {
  res.status(404).json({ ok: false, erro: MENSAGENS[404] });
}

// eslint-disable-next-line no-unused-vars
function tratadorDeErros(erro, req, res, next) {
  const status = statusDoErro(erro);
  if (status >= 500) {
    console.error(`[CIM] Erro interno em ${req.method} ${req.path}:`, erro);
  } else {
    // Só metadados: a mensagem de SyntaxError do JSON cita trechos do corpo.
    console.error(`[CIM] Requisição rejeitada (${status}) em ${req.method} ${req.path}: ${erro?.type || erro?.name || "erro"}`);
  }
  if (res.headersSent) {
    res.end();
    return;
  }
  res.status(status).json({ ok: false, erro: MENSAGENS[status] || "Erro interno." });
}

module.exports = { tratadorDeErros, naoEncontrado, statusDoErro };
