// Códigos de tempo WMO usados pela Open-Meteo, em um único lugar para que o
// informativo diário e o relatório semanal falem a mesma língua.
//
// Duas grafias por código: a completa (informativo diário, onde há espaço) e
// a curta (tabela semanal, onde a célula é estreita).

const WMO = {
  0: { completa: "Céu limpo", curta: "Sol", icone: "☀️" },
  1: { completa: "Predomínio de sol, poucas nuvens", curta: "Sol c/ nuvens", icone: "🌤️" },
  2: { completa: "Parcialmente nublado", curta: "Parc. nublado", icone: "⛅" },
  3: { completa: "Nublado a encoberto", curta: "Nublado", icone: "☁️" },
  45: { completa: "Névoa", curta: "Névoa", icone: "🌫️" },
  48: { completa: "Névoa com formação de geada", curta: "Névoa/geada", icone: "🌫️" },
  51: { completa: "Garoa fraca", curta: "Garoa fraca", icone: "🌦️" },
  53: { completa: "Garoa moderada", curta: "Garoa", icone: "🌦️" },
  55: { completa: "Garoa intensa", curta: "Garoa intensa", icone: "🌧️" },
  56: { completa: "Garoa congelante fraca", curta: "Garoa congelante", icone: "🌧️" },
  57: { completa: "Garoa congelante intensa", curta: "Garoa congelante", icone: "🌧️" },
  61: { completa: "Chuva fraca", curta: "Chuva fraca", icone: "🌦️" },
  63: { completa: "Chuva moderada", curta: "Chuva", icone: "🌧️" },
  65: { completa: "Chuva forte", curta: "Chuva forte", icone: "🌧️" },
  66: { completa: "Chuva congelante fraca", curta: "Chuva congelante", icone: "🌧️" },
  67: { completa: "Chuva congelante forte", curta: "Chuva congelante", icone: "🌧️" },
  71: { completa: "Neve fraca", curta: "Neve fraca", icone: "🌨️" },
  73: { completa: "Neve moderada", curta: "Neve", icone: "🌨️" },
  75: { completa: "Neve forte", curta: "Neve forte", icone: "🌨️" },
  77: { completa: "Grãos de neve", curta: "Grãos de neve", icone: "🌨️" },
  80: { completa: "Pancadas de chuva fracas e isoladas", curta: "Pancadas isoladas", icone: "🌦️" },
  81: { completa: "Pancadas de chuva moderadas", curta: "Pancadas", icone: "🌧️" },
  82: { completa: "Pancadas de chuva fortes/violentas", curta: "Pancadas fortes", icone: "⛈️" },
  85: { completa: "Pancadas de neve fracas", curta: "Pancadas de neve", icone: "🌨️" },
  86: { completa: "Pancadas de neve fortes", curta: "Pancadas de neve", icone: "🌨️" },
  95: { completa: "Trovoada", curta: "Trovoada", icone: "⛈️" },
  96: { completa: "Trovoada com granizo fraco", curta: "Trovoada/granizo", icone: "⛈️" },
  99: { completa: "Trovoada com granizo forte", curta: "Trovoada/granizo", icone: "⛈️" },
};

// Códigos que caracterizam tempestade com atividade elétrica.
const CODIGOS_TEMPESTADE = new Set([95, 96, 99]);

function descreverCodigo(codigo) {
  return WMO[codigo]?.completa || "Condição indisponível";
}

function descreverCodigoSemanal(codigo) {
  return WMO[codigo]?.curta || "—";
}

function iconeCodigo(codigo) {
  return WMO[codigo]?.icone || "❓";
}

module.exports = { WMO, CODIGOS_TEMPESTADE, descreverCodigo, descreverCodigoSemanal, iconeCodigo };
