const PROTOCOLO_POR_GRAU = Object.freeze({
  "ATENÇÃO": "P1",
  ALERTA: "P2",
  "EMERGÊNCIA": "P3",
});

const RECOMENDACOES_POR_PROTOCOLO = Object.freeze({
  P1: Object.freeze([
    "Reforçar a hidratação.",
    "Realizar pausas em sombra ou ambiente climatizado.",
    "Realizar ajuste do horário das atividades com exposição, priorizando períodos mais cedo ou mais tarde.",
  ]),
  P2: Object.freeze([
    "Impor pausas adicionais e rodízio em atividades essenciais.",
    "Paralisar atividades não essenciais, conforme protocolo operacional.",
    "Limitar tarefas pesadas.",
    "Ampliar a vigilância.",
    "Disponibilizar água e local de recuperação.",
    "Disponibilizar protetor solar e intensificar seu uso.",
    "Preparar a equipe de saúde para eventual aumento da demanda de atendimento.",
  ]),
  P3: Object.freeze([
    "Cessar trabalho externo.",
    "Remover pessoas para ambiente climatizado.",
    "Providenciar assistência médica imediata e remoção conforme PRE, quando necessário.",
  ]),
});

function recomendacoesPorProtocolo(protocolo) {
  const niveis = ["P1", "P2", "P3"];
  const indice = niveis.indexOf(protocolo);
  if (indice < 0) return [];
  return niveis.slice(0, indice + 1).flatMap((nivel) => RECOMENDACOES_POR_PROTOCOLO[nivel]);
}

function recomendacoesProtecao(grau) {
  return recomendacoesPorProtocolo(PROTOCOLO_POR_GRAU[grau]);
}

module.exports = {
  PROTOCOLO_POR_GRAU,
  RECOMENDACOES_POR_PROTOCOLO,
  recomendacoesPorProtocolo,
  recomendacoesProtecao,
};
