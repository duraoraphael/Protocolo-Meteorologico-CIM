// Senha operacional do painel (V-02).
//
// - Não existe mais valor padrão: sem DASHBOARD_PASSWORD válida o servidor
//   não inicia.
// - A comparação é feita em tempo constante sobre o hash SHA-256 das duas
//   senhas (os hashes têm sempre 32 bytes, então timingSafeEqual não vaza o
//   tamanho da senha esperada).
const crypto = require("node:crypto");

const SENHA_MIN_CARACTERES = 12;
// Valores que já foram públicos (código, README, .env.example) e portanto
// nunca podem ser aceitos, em qualquer combinação de maiúsculas/minúsculas.
const SENHAS_PROIBIDAS = new Set(["marciana"]);
const SENHA_MAX_RECEBIDA = 1024;

/** Devolve a descrição do problema da senha configurada, ou null se estiver ok. */
function problemaSenhaConfigurada(senha) {
  if (typeof senha !== "string" || senha.length === 0) {
    return "DASHBOARD_PASSWORD não está definida.";
  }
  if (senha.length < SENHA_MIN_CARACTERES) {
    return `DASHBOARD_PASSWORD precisa ter pelo menos ${SENHA_MIN_CARACTERES} caracteres.`;
  }
  if (SENHAS_PROIBIDAS.has(senha.trim().toLowerCase())) {
    return "DASHBOARD_PASSWORD usa um valor padrão público e precisa ser trocada.";
  }
  return null;
}

function sha256(valor) {
  return crypto.createHash("sha256").update(valor, "utf8").digest();
}

/** Cria uma função (senhaRecebida) => boolean que compara em tempo constante. */
function criarComparadorSenha(senhaEsperada) {
  const problema = problemaSenhaConfigurada(senhaEsperada);
  if (problema) throw new Error(problema);
  const hashEsperado = sha256(senhaEsperada);
  return function senhaConfere(recebida) {
    if (typeof recebida !== "string" || recebida.length === 0 || recebida.length > SENHA_MAX_RECEBIDA) {
      return false;
    }
    return crypto.timingSafeEqual(sha256(recebida), hashEsperado);
  };
}

module.exports = { problemaSenhaConfigurada, criarComparadorSenha, SENHA_MIN_CARACTERES };
