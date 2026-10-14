const { CIDADES } = require("./cities");

// COR-RIO é uma base lógica de distribuição. Ela não pertence a CIDADES
// porque não representa uma localidade meteorológica e nunca deve entrar nas
// rotinas de coleta, painel ou geração de informativos municipais.
const BASE_COR_RIO = "cor_rio";

const BASES_DISTRIBUICAO = Object.freeze({
  ...Object.fromEntries(Object.entries(CIDADES).map(([chave, cidade]) => [
    chave,
    Object.freeze({ chave, nome: cidade.nome, uf: cidade.uf, tipo: "informativo" }),
  ])),
  [BASE_COR_RIO]: Object.freeze({
    chave: BASE_COR_RIO,
    nome: "COR-RIO",
    uf: "RJ",
    tipo: "aviso_cor_rio",
  }),
});

function baseDistribuicaoExiste(chave) {
  return typeof chave === "string" && Object.hasOwn(BASES_DISTRIBUICAO, chave);
}

function getBaseDistribuicao(chave) {
  if (!baseDistribuicaoExiste(chave)) {
    throw Object.assign(new Error("Base inválida."), {
      status: 400,
      publico: true,
      code: "BASE_INVALIDA",
    });
  }
  return BASES_DISTRIBUICAO[chave];
}

module.exports = {
  BASE_COR_RIO,
  BASES_DISTRIBUICAO,
  baseDistribuicaoExiste,
  getBaseDistribuicao,
};
