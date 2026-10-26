const { calorPorData, dataLocal } = require("./calorPorData");
const INDISPONIVEL = "Informação indisponível";

function criarIndicadoresSnapshot(relatorio) {
  const calorHoje = calorPorData(relatorio.climaSaude,
    dataLocal(relatorio.geradoEmISO || Date.now(), relatorio.cidade?.fuso));
  const ciclo = relatorio.snapshotId;
  const localidade = relatorio.cidade.chave;
  const consultadoEm = relatorio.geradoEmISO;
  const observacao = relatorio.inmetObservacao?.observacao;
  const observadoEm = observacao?.medidoEm || null;
  const previsaoEm = relatorio.openMeteo?.dataReferencia || null;
  const previsaoInmetEm = relatorio.inmetPrevisao?.data || null;
  const fonteCampo = relatorio.fontesPorCampo || {};
  const referenciaPrevisao = (campo) => fonteCampo[campo]?.includes("INMET") ? previsaoInmetEm : previsaoEm;

  function indicador(nome, valor, unidade, fonteEsperada, fonteReal, referenciaEm, status = null) {
    const valido = typeof valor === "number" ? Number.isFinite(valor)
      : typeof valor === "string" ? Boolean(valor.trim()) : Array.isArray(valor);
    const fonte = valido && fonteReal && fonteReal !== INDISPONIVEL ? fonteReal : fonteEsperada;
    return {
      localidade, indicador: nome, valor: valido ? valor : null, unidade,
      fonte, referenciaEm: valido ? referenciaEm : null, consultadoEm,
      statusValidacao: valido ? status || (typeof fonte === "string" && fonte.includes("cache recente") ? "degradado" : "operacional") : "indisponivel",
      cicloId: ciclo,
    };
  }

  const statusObservado = relatorio.atual?.statusObservacao === "degradado" ? "degradado" : "operacional";
  const fonteObservada = relatorio.atual?.fonte;
  const temperaturaObservada = relatorio.atual?.fonteTemperatura?.includes("INMET") ? relatorio.atual?.temperaturaC : null;
  const umidadeObservada = relatorio.atual?.fonteUmidade?.includes("INMET") ? relatorio.atual?.umidadePct : null;
  const statusAtual = (fonte) => fonte?.includes("Open-Meteo") ? "modelado" : statusObservado;
  const indicadores = {
    temperaturaObservada: indicador("temperaturaObservada", temperaturaObservada, "°C", "INMET — estação automática", relatorio.atual?.fonteTemperatura || fonteObservada, relatorio.atual?.horarioTemperatura || observadoEm, statusObservado),
    umidadeObservada: indicador("umidadeObservada", umidadeObservada, "%", "INMET — estação automática", relatorio.atual?.fonteUmidade || fonteObservada, relatorio.atual?.horarioUmidade || observadoEm, statusObservado),
    temperaturaAtual: indicador("temperaturaAtual", relatorio.atual?.temperaturaC, "°C", "Informação indisponível", relatorio.atual?.fonteTemperatura, relatorio.atual?.horarioTemperatura, statusAtual(relatorio.atual?.fonteTemperatura)),
    umidadeAtual: indicador("umidadeAtual", relatorio.atual?.umidadePct, "%", "Informação indisponível", relatorio.atual?.fonteUmidade, relatorio.atual?.horarioUmidade, statusAtual(relatorio.atual?.fonteUmidade)),
    temperaturaMinPrevista: indicador("temperaturaMinPrevista", relatorio.tempMin, "°C", "INMET — previsão oficial", fonteCampo.tempMin, referenciaPrevisao("tempMin")),
    temperaturaMaxPrevista: indicador("temperaturaMaxPrevista", relatorio.tempMax, "°C", "INMET — previsão oficial", fonteCampo.tempMax, referenciaPrevisao("tempMax")),
    umidadeMinPrevista: indicador("umidadeMinPrevista", relatorio.umidadeMin, "%", "INMET — previsão oficial", fonteCampo.umidadeMin, referenciaPrevisao("umidadeMin")),
    umidadeMaxPrevista: indicador("umidadeMaxPrevista", relatorio.umidadeMax, "%", "INMET — previsão oficial", fonteCampo.umidadeMax, referenciaPrevisao("umidadeMax")),
    rajadaPrevista: indicador("rajadaPrevista", relatorio.rajadaPrevistaKmh, "km/h", "Open-Meteo — previsão meteorológica", fonteCampo.rajadaMaxKmh, relatorio.rajadaPrevistaReferencia?.rajadaPrevistaEm || null),
    probabilidadeChuva: indicador("probabilidadeChuva", relatorio.probabilidadeChuvaPrevista, "%", "Open-Meteo — previsão meteorológica", fonteCampo.probabilidadeChuvaPrevista, previsaoEm),
    probabilidadeChuvaDiaria: indicador("probabilidadeChuvaDiaria", relatorio.probabilidadeChuvaDiariaPct, "%", "Open-Meteo — previsão meteorológica", fonteCampo.probabilidadeChuvaMax, previsaoEm),
    chuvaPrevistaDia: indicador("chuvaPrevistaDia", relatorio.precipitacaoPrevistaDiaMm, "mm", "Open-Meteo — previsão meteorológica", fonteCampo.precipitacaoPrevistaDiaMm, previsaoEm),
    chuvaPrevistaJanela: indicador("chuvaPrevistaJanela", relatorio.precipitacaoJanelaMm, "mm", "Open-Meteo — previsão meteorológica", fonteCampo.precipitacaoJanelaMm, previsaoEm),
    chuvaAcumuladaEstimada: indicador("chuvaAcumuladaEstimada", relatorio.precipitacaoAcumuladaEstimadaMm, "mm", "Open-Meteo — previsão meteorológica", fonteCampo.precipitacaoAcumuladaEstimadaMm, previsaoEm),
    qualidadeAr: indicador("qualidadeAr", relatorio.qualidadeAr?.usAqi, "US AQI", "Open-Meteo Air Quality / CAMS", fonteCampo["ar.usAqi"], relatorio.qualidadeAr?.referenciaEm || null),
    qualidadeArClassificacao: indicador("qualidadeArClassificacao", Number.isFinite(relatorio.qualidadeAr?.usAqi)
      ? relatorio.qualidadeAr?.classificacao?.nivel : null, null, "Open-Meteo Air Quality / CAMS",
      fonteCampo["ar.usAqi"], relatorio.qualidadeAr?.referenciaEm || null),
    condicaoGeral: indicador("condicaoGeral", fonteCampo.condicaoGeral === INDISPONIVEL ? null : relatorio.condicaoGeral, null, "INMET — previsão oficial", fonteCampo.condicaoGeral, referenciaPrevisao("condicaoGeral")),
    indiceUv: indicador("indiceUv", relatorio.indiceUv?.status === "operacional" ? relatorio.indiceUv.valorAtual : null, "índice UV", "Open-Meteo Air Quality / CAMS", relatorio.indiceUv?.fonte, relatorio.indiceUv?.referenciaEm || null),
    avisosOficiais: indicador("avisosOficiais", relatorio.avisosInmetStatus === "operacional" ? relatorio.avisosInmet : null, null, "INMET — avisos oficiais", "INMET — avisos oficiais", consultadoEm),
    excessoCalor: indicador("excessoCalor", calorHoje?.rotulo || null, null, "Clima e Saúde — Ministério da Saúde", "Clima e Saúde — Ministério da Saúde", calorHoje ? relatorio.climaSaude?.dados?.dataConsulta || null : null),
  };
  return indicadores;
}

module.exports = { criarIndicadoresSnapshot };
