function disponivel(valor) {
  return valor !== null && valor !== undefined && valor !== "" && valor !== "—";
}

function fonteDo(valor, fonte) {
  return disponivel(valor) ? fonte : "Indisponível";
}

/**
 * Registra a origem dos campos sem combinar modelos meteorológicos diferentes.
 * O valor permanece exatamente como foi normalizado pela fonte escolhida.
 */
function mapearFontesDoRelatorio(base, mar, qualidadeAr, fonteMeteorologica) {
  const fontesPorCampo = {};
  for (const campo of [
    "condicaoGeral",
    "tempMin",
    "tempMax",
    "umidadeMin",
    "umidadeMax",
    "rajadaMaxKmh",
    "rajadaObservadaMaxKmh",
    "precipitacaoTotalMm",
    "precipitacaoDiariaMm",
    "precipitacaoHoraMm",
    "precipitacaoHorariaMaxMm",
    "probabilidadeChuvaMax",
  ]) {
    fontesPorCampo[campo] = fonteDo(base?.[campo], fonteMeteorologica);
  }

  fontesPorCampo.temTempestadeHoje = typeof base?.temTempestadeHoje === "boolean"
    ? fonteMeteorologica
    : "Indisponível";

  for (const chave of ["manha", "tarde", "noite"]) {
    const periodo = base?.periodos?.[chave];
    for (const campo of ["direcao", "intensidadeVento", "velocidadeMediaKmh", "rajadaMaxKmh", "rajadaObservadaMaxKmh", "precipitacaoMm", "precipitacaoHorariaMaxMm", "probabilidadeChuva"]) {
      fontesPorCampo[`periodos.${chave}.${campo}`] = fonteDo(periodo?.[campo], fonteMeteorologica);
    }
  }

  const fonteMar = mar?.fonte || "Informação indisponível";
  fontesPorCampo["mar.alturaMaxDiaM"] = fonteDo(mar?.alturaMaxDiaM, fonteMar);
  fontesPorCampo["mar.temperaturaMarC"] = fonteDo(mar?.temperaturaMarC, fonteMar);

  const fonteAr = qualidadeAr?.fonte || "Informação indisponível";
  fontesPorCampo["ar.pm25Medio"] = fonteDo(qualidadeAr?.pm25Medio, fonteAr);
  fontesPorCampo["ar.pm10Medio"] = fonteDo(qualidadeAr?.pm10Medio, fonteAr);
  fontesPorCampo["ar.pm25"] = fonteDo(qualidadeAr?.pm25, fonteAr);
  fontesPorCampo["ar.pm10"] = fonteDo(qualidadeAr?.pm10, fonteAr);
  fontesPorCampo["ar.iqar"] = fonteDo(qualidadeAr?.iqar, fonteAr);
  fontesPorCampo["ar.usAqi"] = fonteDo(qualidadeAr?.usAqi, fonteAr);
  fontesPorCampo["ar.uvAtual"] = fonteDo(qualidadeAr?.uvAtual, qualidadeAr?.fonteUv || fonteAr);
  fontesPorCampo["ar.uvMax"] = fonteDo(qualidadeAr?.uvMax, "Open-Meteo — previsão meteorológica");
  fontesPorCampo.atual = fonteDo(base?.atual, base?.atual?.fonte || fonteMeteorologica);

  return {
    base,
    mar,
    qualidadeAr,
    atual: base?.atual || null,
    fontesPorCampo,
  };
}

module.exports = { mapearFontesDoRelatorio };
