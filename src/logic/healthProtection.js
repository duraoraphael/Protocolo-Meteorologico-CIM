const { acumularRecomendacoes, acumularRecomendacoesPorNivel } = require("./recomendacoesCumulativas");

const PROTOCOLO_POR_GRAU = Object.freeze({
  "ATENÇÃO": "P1",
  ALERTA: "P2",
  "EMERGÊNCIA": "P3",
});

const RECOMENDACOES_POR_PROTOCOLO = Object.freeze({
  P1: Object.freeze([
    "Reforçar a hidratação.",
    "Realizar pausas em ambientes sombreados ou climatizados.",
    "Ajustar horários de atividades com exposição ao calor, antecipando ou postergando os trabalhos quando viável.",
  ]),
  P2: Object.freeze([
    "Impor pausas adicionais e rodízio em atividades essenciais.",
    "Paralisar atividades não essenciais.",
    "Limitar tarefas pesadas.",
    "Ampliar a vigilância das condições dos trabalhadores.",
    "Disponibilizar água e locais adequados de recuperação.",
    "Disponibilizar protetor solar e intensificar seu uso.",
    "Preparar a equipe de saúde para aumento da demanda de atendimento.",
  ]),
  P3: Object.freeze([
    "Cessar trabalhos externos conforme o protocolo de emergência.",
    "Remover pessoas para ambiente climatizado.",
    "Providenciar assistência médica imediata e remoção conforme PRE, quando necessário.",
  ]),
});

const CONFIG_CALOR = Object.freeze({
  calor: Object.freeze({
    "ATENÇÃO": RECOMENDACOES_POR_PROTOCOLO.P1,
    ALERTA: RECOMENDACOES_POR_PROTOCOLO.P2,
    "EMERGÊNCIA": RECOMENDACOES_POR_PROTOCOLO.P3,
  }),
});
const GRAU_POR_PROTOCOLO = Object.freeze({ P1: "ATENÇÃO", P2: "ALERTA", P3: "EMERGÊNCIA" });

function recomendacoesPorProtocolo(protocolo) {
  return acumularRecomendacoes("calor", GRAU_POR_PROTOCOLO[protocolo], CONFIG_CALOR);
}

function recomendacoesPorProtocoloEmNiveis(protocolo) {
  return acumularRecomendacoesPorNivel("calor", GRAU_POR_PROTOCOLO[protocolo], CONFIG_CALOR);
}

function recomendacoesProtecao(grau) {
  return recomendacoesPorProtocolo(PROTOCOLO_POR_GRAU[grau]);
}

module.exports = {
  PROTOCOLO_POR_GRAU,
  RECOMENDACOES_POR_PROTOCOLO,
  recomendacoesPorProtocolo,
  recomendacoesPorProtocoloEmNiveis,
  recomendacoesProtecao,
};
