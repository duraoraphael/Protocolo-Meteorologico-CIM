(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.WeatherFormat = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function numeroValido(valor) {
    if (valor === null || valor === undefined || valor === "") return null;
    const numero = Number(String(valor).trim().replace(",", "."));
    return Number.isFinite(numero) && numero >= 0 ? numero : null;
  }

  function formatarRajadaNumero(valorKmH, indisponivel = "Indisponível") {
    const numero = numeroValido(valorKmH);
    return numero === null ? indisponivel : String(Math.round(numero));
  }

  function formatarRajadaPrevista(valorKmH, indisponivel = "Indisponível") {
    const numero = numeroValido(valorKmH);
    return numero === null ? indisponivel : `${Math.round(numero)} km/h`;
  }

  return Object.freeze({ formatarRajadaNumero, formatarRajadaPrevista });
});
