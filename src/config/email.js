// INTERRUPTORES DOS E-MAILS AUTOMÁTICOS.
//
// false: bloqueia somente o fluxo correspondente.
// true:  permite o fluxo correspondente (respeitando também as opções do .env).
//
// O botão manual de gerar/enviar relatório não é afetado por esta opção.
const CONFIGURACAO_EMAIL = {
  relatorioDiarioAtivo: true,
  envioUnicoAgendadoAtivo: true,
  alertasAutomaticosAtivos: true,
};

function relatorioDiarioAtivo() {
  return CONFIGURACAO_EMAIL.relatorioDiarioAtivo === true;
}

function envioUnicoAgendadoAtivo() {
  return CONFIGURACAO_EMAIL.envioUnicoAgendadoAtivo === true;
}

function alertasAutomaticosAtivos() {
  return CONFIGURACAO_EMAIL.alertasAutomaticosAtivos === true;
}

module.exports = {
  CONFIGURACAO_EMAIL,
  relatorioDiarioAtivo,
  envioUnicoAgendadoAtivo,
  alertasAutomaticosAtivos,
};
