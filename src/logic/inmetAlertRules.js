// Critérios operacionais de chuva intensa e vento solicitados com referência
// INMET. A fonte do dado numérico continua registrada separadamente, pois o
// endpoint de previsão do INMET usado pelo projeto não fornece chuva horária
// nem rajada numérica.

const GRAUS = Object.freeze({
  NORMAL: 0,
  "ATENÇÃO": 1,
  ALERTA: 2,
  "EMERGÊNCIA": 3,
});

const LIMITES_ALERTA_INMET = Object.freeze({
  chuvaHorariaMmH: Object.freeze({ atencao: 20, alerta: 30, emergenciaAcimaDe: 60 }),
  // O mínimo de 20 mm/dia preserva o limiar já utilizado pelo monitor.
  chuvaDiariaMm: Object.freeze({ atencao: 20, alerta: 50, emergenciaAcimaDe: 100 }),
  rajadaKmh: Object.freeze({ atencao: 30, alerta: 40, emergenciaAcimaDe: 60 }),
});

const RECOMENDACOES = Object.freeze({
  chuva: Object.freeze({
    "ATENÇÃO": Object.freeze([
      "Reforçar comunicação preventiva.",
      "Checar drenagem.",
      "Suspender preventivamente serviços em telhados, atividades em altura e serviços a céu aberto.",
      "Preparar abrigo interno.",
    ]),
    ALERTA: Object.freeze([
      "Suspender trabalho em altura e em telhados.",
      "Suspender atividades externas não essenciais.",
      "Controlar acesso a áreas alagáveis.",
      "Manter prontidão de saúde e equipes de contingência.",
    ]),
    "EMERGÊNCIA": Object.freeze([
      "Evacuar áreas vulneráveis.",
      "Isolar áreas com risco elétrico conforme procedimento local.",
    ]),
  }),
  vento: Object.freeze({
    "ATENÇÃO": Object.freeze([
      "Manter o monitoramento durante o dia.",
    ]),
    ALERTA: Object.freeze([
      "Paralisar atividades externas gerais, incluindo roçagem, capina, jardinagem, manutenção civil externa e obras civis.",
      "Suspender trabalho em altura e em telhados.",
      "Suspender içamentos.",
      "Suspender serviços a céu aberto.",
      "Interditar áreas sob risco de queda de objetos ou árvores.",
      "Intensificar o controle de quedas de objetos.",
      "Direcionar pessoas para áreas internas seguras.",
    ]),
    "EMERGÊNCIA": Object.freeze([
      "Evacuar áreas externas.",
      "Operar em modo de abrigo interno.",
      "Realizar controle de acessos.",
      "Realizar resposta a feridos, se houver.",
      "Considerar também as recomendações presentes no aviso do INMET, conforme a severidade.",
    ]),
  }),
});

function classificar(valor, limites) {
  if (!Number.isFinite(valor)) return "NORMAL";
  if (valor > limites.emergenciaAcimaDe) return "EMERGÊNCIA";
  if (valor >= limites.alerta) return "ALERTA";
  if (valor >= limites.atencao) return "ATENÇÃO";
  return "NORMAL";
}

function classificarChuvaHoraria(valorMmH) {
  return classificar(valorMmH, LIMITES_ALERTA_INMET.chuvaHorariaMmH);
}

function classificarChuvaDiaria(valorMm) {
  return classificar(valorMm, LIMITES_ALERTA_INMET.chuvaDiariaMm);
}

function classificarRajada(valorKmh) {
  return classificar(valorKmh, LIMITES_ALERTA_INMET.rajadaKmh);
}

function maiorGrau(...graus) {
  return graus.reduce(
    (maior, grau) => (GRAUS[grau] > GRAUS[maior] ? grau : maior),
    "NORMAL"
  );
}

function classificarChuva(intensidadeHorariaMmH, acumuladoDiarioMm) {
  const grauHorario = classificarChuvaHoraria(intensidadeHorariaMmH);
  const grauDiario = classificarChuvaDiaria(acumuladoDiarioMm);
  return {
    grau: maiorGrau(grauHorario, grauDiario),
    grauHorario,
    grauDiario,
  };
}

function recomendacoes(fenomeno, grau) {
  return [...(RECOMENDACOES[fenomeno]?.[grau] || [])];
}

module.exports = {
  GRAUS,
  LIMITES_ALERTA_INMET,
  classificarChuvaHoraria,
  classificarChuvaDiaria,
  classificarChuva,
  classificarRajada,
  maiorGrau,
  recomendacoes,
};
