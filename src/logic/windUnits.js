const FATORES_PARA_KMH = Object.freeze({
  "km/h": 1,
  kmh: 1,
  "km h-1": 1,
  "m/s": 3.6,
  "m s-1": 3.6,
  ms: 3.6,
  kt: 1.852,
  kts: 1.852,
  knot: 1.852,
  knots: 1.852,
  "nó": 1.852,
  "nós": 1.852,
});

function normalizarUnidadeVelocidade(unidade) {
  return String(unidade || "").trim().toLocaleLowerCase("pt-BR").replace(/\s+/g, " ");
}

function converterVelocidadeParaKmh(valor, unidade) {
  const numero = typeof valor === "string" && /^[+-]?\d+(?:[.,]\d+)?$/.test(valor.trim())
    ? Number(valor.trim().replace(",", "."))
    : valor;
  if (!Number.isFinite(numero)) return null;
  const fator = FATORES_PARA_KMH[normalizarUnidadeVelocidade(unidade)];
  return Number.isFinite(fator) ? numero * fator : null;
}

function unidadeVelocidadeSuportada(unidade) {
  return Object.hasOwn(FATORES_PARA_KMH, normalizarUnidadeVelocidade(unidade));
}

module.exports = {
  converterVelocidadeParaKmh,
  normalizarUnidadeVelocidade,
  unidadeVelocidadeSuportada,
};
