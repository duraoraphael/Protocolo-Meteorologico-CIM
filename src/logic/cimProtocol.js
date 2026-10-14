const DESCRICOES_NIVEL_CIM = Object.freeze({
  "ATENÇÃO": "Risco aumentado / preparação; ações preventivas e reforço de prontidão.",
  ALERTA: "Condição perigosa provável ou em evolução; restrições operacionais e preparação para evacuação ou abrigo.",
  "EMERGÊNCIA": "Condição perigosa instalada ou iminente; paralisações, evacuação ou abrigo, resposta de saúde e controle de acessos.",
});

const RESPONSABILIDADE_INSTALACOES = "Executar isolamento, evacuação e interdição; controlar acessos; apoiar o resgate e as pessoas vulneráveis.";

function descricaoNivelCim(grau) {
  return DESCRICOES_NIVEL_CIM[grau] || null;
}

module.exports = {
  DESCRICOES_NIVEL_CIM,
  RESPONSABILIDADE_INSTALACOES,
  descricaoNivelCim,
};
