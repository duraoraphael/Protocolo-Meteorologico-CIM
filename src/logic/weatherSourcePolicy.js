const FONTE_OPEN_METEO = "Open-Meteo — previsão meteorológica";
const FONTE_OCEANOP = "Petrobras — OCEANOP";
const FONTE_INMET_PREVISAO = "INMET — previsão oficial";
const FONTE_INMET_OBSERVACAO = "INMET — estação automática";
const INDISPONIVEL = "Informação indisponível";
const { resumoDiario } = require("./sectorWeatherContext");

// A fonte principal tem precedência; a previsão modelada é usada somente
// quando o produto principal não publicou um valor válido do mesmo indicador.
const PROPRIEDADE_INDICADORES = Object.freeze({
  temperaturaAtual: FONTE_INMET_OBSERVACAO,
  umidadeAtual: FONTE_INMET_OBSERVACAO,
  temperaturaPrevista: FONTE_INMET_PREVISAO,
  umidadePrevista: FONTE_INMET_PREVISAO,
  condicaoGeral: FONTE_INMET_PREVISAO,
  ventoPrevisto: FONTE_INMET_PREVISAO,
  rajadaPrevista: FONTE_OCEANOP,
  chuvaPrevista: FONTE_OPEN_METEO,
  probabilidadeChuva: FONTE_OPEN_METEO,
  chuvaAcumuladaEstimada: FONTE_OPEN_METEO,
  uvAtual: "Open-Meteo Air Quality",
  uvMaxPrevisto: FONTE_OPEN_METEO,
  qualidadeAr: "Open-Meteo Air Quality",
});

const numero = (valor) => Number.isFinite(valor) ? valor : null;
const fonteObservacao = (observacao) => observacao?.estacao?.codigo
  ? `${FONTE_INMET_OBSERVACAO} (${observacao.estacao.codigo})`
  : observacao ? FONTE_INMET_OBSERVACAO : null;

function registrar(diagnosticos, logger, indicador) {
  const motivo = "A Open-Meteo não publicou valor numérico válido para este indicador.";
  diagnosticos.push({ indicador, fontePrioritaria: FONTE_OPEN_METEO, fonteUtilizada: INDISPONIVEL, motivo });
  logger?.warn?.(`[INFORMAÇÃO INDISPONÍVEL] ${indicador}: ${motivo}`);
}

function aplicarPoliticaFontes({ base, openMeteo, inmetPrevisao, inmetObservacao, fontesPorCampo, cidade, agora = new Date(), logger = console }) {
  const diagnosticos = [];
  const chaves = ["manha", "tarde", "noite"];

  const diaInmet = inmetPrevisao?.dias?.find((dia) => dia.dataBr === inmetPrevisao.data);
  const previsaoNumerica = (min, max, limiteMin, limiteMax) =>
    Number.isFinite(min) && Number.isFinite(max) && min >= limiteMin && max <= limiteMax && min <= max;
  for (const [min, max, limiteMin, limiteMax] of [
    ["tempMin", "tempMax", -90, 60],
    ["umidadeMin", "umidadeMax", 0, 100],
  ]) {
    const origem = previsaoNumerica(diaInmet?.[min], diaInmet?.[max], limiteMin, limiteMax)
      ? { dados: diaInmet, fonte: FONTE_INMET_PREVISAO } : null;
    for (const campo of [min, max]) {
      base[campo] = origem?.dados[campo] ?? null;
      fontesPorCampo[campo] = origem?.fonte || INDISPONIVEL;
      if (!origem) diagnosticos.push({ indicador: campo, fontePrioritaria: FONTE_INMET_PREVISAO,
        fonteUtilizada: INDISPONIVEL, motivo: "INMET não publicou uma faixa diária válida." });
    }
  }
  for (const campo of ["precipitacaoHorariaMaxMm"]) {
    base[campo] = numero(openMeteo?.[campo]);
    fontesPorCampo[campo] = Number.isFinite(base[campo]) ? FONTE_OPEN_METEO : INDISPONIVEL;
    if (!Number.isFinite(base[campo])) registrar(diagnosticos, logger, campo);
  }
  const condicaoOficial = resumoDiario(inmetPrevisao);
  base.condicaoGeral = condicaoOficial || null;
  const fonteCondicao = condicaoOficial ? FONTE_INMET_PREVISAO : INDISPONIVEL;
  base.temTempestadeHoje = typeof openMeteo?.temTempestadeHoje === "boolean" ? openMeteo.temTempestadeHoje : null;
  const observacaoAtual = inmetObservacao?.observacao;
  const observacaoFresca = observacaoAtual
    && observacaoAtual.status !== "armazenado"
    && observacaoAtual.desatualizado !== true
    && (inmetObservacao.status === "operacional"
      || (inmetObservacao.status === "degradado" && observacaoAtual.status === "armazenado_recente"));
  const fonteAtual = observacaoAtual?.estacao?.codigo
    ? `${FONTE_INMET_OBSERVACAO} (${observacaoAtual.estacao.codigo})${observacaoAtual.status === "armazenado_recente" ? " — última observação válida armazenada" : ""}`
    : FONTE_INMET_OBSERVACAO;
  const valorNaFaixa = (valor, minimo, maximo) => Number.isFinite(valor) && valor >= minimo && valor <= maximo ? valor : null;
  const temperaturaInmet = observacaoFresca ? valorNaFaixa(observacaoAtual.temperaturaAtualC, -90, 60) : null;
  const umidadeInmet = observacaoFresca ? valorNaFaixa(observacaoAtual.umidadeAtualPct, 0, 100) : null;
  const temperaturaAtual = temperaturaInmet;
  const umidadeAtual = umidadeInmet;
  const fonteTemperatura = temperaturaInmet !== null ? fonteAtual : INDISPONIVEL;
  const fonteUmidade = umidadeInmet !== null ? fonteAtual : INDISPONIVEL;
  const usouInmet = fonteTemperatura === fonteAtual || fonteUmidade === fonteAtual;
  const fonteAtualCombinada = [...new Set([fonteTemperatura, fonteUmidade].filter((fonte) => fonte !== INDISPONIVEL))].join(" / ") || INDISPONIVEL;
  base.atual = {
    temperaturaC: temperaturaAtual,
    umidadePct: umidadeAtual,
    codigo: null,
    condicao: base.condicaoGeral || "Condição indisponível",
    dia: null,
    horario: usouInmet ? observacaoAtual.medidoEm : null,
    horarioTemperatura: temperaturaInmet !== null ? observacaoAtual.medidoEm : null,
    horarioUmidade: umidadeInmet !== null ? observacaoAtual.medidoEm : null,
    fonte: fonteAtualCombinada,
    fonteTemperatura,
    fonteUmidade,
    fonteCondicao,
    statusObservacao: usouInmet
      ? observacaoAtual.status === "armazenado_recente" ? "degradado" : "operacional"
      : observacaoAtual ? "desatualizado" : "indisponivel",
    motivoIndisponibilidade: usouInmet ? null : inmetObservacao?.mensagem
      || (observacaoAtual ? "A última observação INMET está desatualizada." : "O INMET não publicou uma observação atual válida."),
    previsao: false,
    estacao: usouInmet ? observacaoAtual.estacao : null,
  };
  fontesPorCampo.condicaoGeral = fonteCondicao;
  fontesPorCampo.temTempestadeHoje = typeof base.temTempestadeHoje === "boolean" ? FONTE_OPEN_METEO : INDISPONIVEL;
  fontesPorCampo.atual = fonteAtualCombinada;

  base.rajadaMaxKmh = null;
  fontesPorCampo.rajadaMaxKmh = INDISPONIVEL;
  fontesPorCampo.rajadaPrevistaKmh = INDISPONIVEL;
  for (const chave of chaves) {
    const modelo = openMeteo?.periodosDiaCompleto?.[chave] || openMeteo?.periodos?.[chave];
    const oficial = inmetPrevisao?.periodos?.[chave];
    const destino = base.periodos?.[chave] || {};
    Object.assign(destino, modelo || {}, { rajadaMaxKmh: null });
    const janelaOficial = { manha: "05h–12h", tarde: "12h–18h", noite: "18h–00h" }[chave];
    destino.janela = janelaOficial;
    destino.janelaModelo = modelo?.janela && modelo.janela !== janelaOficial ? modelo.janela : null;
    const escolher = (campo, valorOficial, valorModelo, minimo, maximo) => {
      const oficialValido = Number.isFinite(valorOficial) && valorOficial >= minimo && valorOficial <= maximo;
      const modeloValido = Number.isFinite(valorModelo) && valorModelo >= minimo && valorModelo <= maximo;
      destino[campo] = oficialValido ? valorOficial : modeloValido ? valorModelo : null;
      fontesPorCampo[`periodos.${chave}.${campo}`] = oficialValido ? FONTE_INMET_PREVISAO
        : modeloValido ? FONTE_OPEN_METEO : INDISPONIVEL;
      return fontesPorCampo[`periodos.${chave}.${campo}`];
    };
    const fonteVento = escolher("velocidadeMediaKmh", oficial?.velocidadeMediaKmh, modelo?.velocidadeMediaKmh, 0, 300);
    destino.velocidadeMaxKmh = fonteVento === FONTE_OPEN_METEO ? modelo?.velocidadeMaxKmh ?? null : null;
    fontesPorCampo[`periodos.${chave}.velocidadeMaxKmh`] = fonteVento === FONTE_OPEN_METEO ? FONTE_OPEN_METEO : INDISPONIVEL;
    destino.fonteVento = fonteVento;
    destino.intensidadeVento = fonteVento === FONTE_INMET_PREVISAO
      ? oficial?.intensidadeVento || "—" : fonteVento === FONTE_OPEN_METEO ? modelo?.intensidadeVento || "—"
        : oficial?.intensidadeVento || "—";
    destino.direcao = oficial?.direcaoVento || modelo?.direcao || "—";
    fontesPorCampo[`periodos.${chave}.intensidadeVento`] = fonteVento === INDISPONIVEL && oficial?.intensidadeVento
      ? FONTE_INMET_PREVISAO : fonteVento;
    fontesPorCampo[`periodos.${chave}.direcao`] = oficial?.direcaoVento ? FONTE_INMET_PREVISAO
      : modelo?.direcao && modelo.direcao !== "—" ? FONTE_OPEN_METEO : INDISPONIVEL;
    destino.precipitacaoMm = Number.isFinite(modelo?.precipitacaoMm) && modelo.precipitacaoMm >= 0
      ? modelo.precipitacaoMm : null;
    destino.fontePrecipitacao = Number.isFinite(destino.precipitacaoMm) ? FONTE_OPEN_METEO : INDISPONIVEL;
    fontesPorCampo[`periodos.${chave}.precipitacaoMm`] = destino.fontePrecipitacao;
    destino.probabilidadeChuva = Number.isFinite(modelo?.probabilidadeChuva)
      && modelo.probabilidadeChuva >= 0 && modelo.probabilidadeChuva <= 100
      ? modelo.probabilidadeChuva : null;
    destino.fonteProbabilidade = Number.isFinite(destino.probabilidadeChuva) ? FONTE_OPEN_METEO : INDISPONIVEL;
    fontesPorCampo[`periodos.${chave}.probabilidadeChuva`] = destino.fonteProbabilidade;
    const horarioFonte = (fonte) => fonte === FONTE_INMET_PREVISAO
      ? inmetPrevisao?.consultadoEm || null
      : fonte === FONTE_OPEN_METEO ? openMeteo?.consultadoEm || null : null;
    destino.referenciaVentoEm = horarioFonte(fonteVento);
    destino.referenciaPrecipitacaoEm = horarioFonte(destino.fontePrecipitacao);
    destino.referenciaProbabilidadeEm = horarioFonte(destino.fonteProbabilidade);
    destino.precipitacaoHorariaMaxMm = Number.isFinite(modelo?.precipitacaoHorariaMaxMm)
      ? modelo.precipitacaoHorariaMaxMm : null;
    fontesPorCampo[`periodos.${chave}.precipitacaoHorariaMaxMm`] = Number.isFinite(destino.precipitacaoHorariaMaxMm)
      ? FONTE_OPEN_METEO : INDISPONIVEL;
    destino.tipoDado = "previsao";
    destino.referenciaEm = fonteVento === FONTE_INMET_PREVISAO || destino.fontePrecipitacao === FONTE_INMET_PREVISAO
      || destino.fonteProbabilidade === FONTE_INMET_PREVISAO ? inmetPrevisao?.consultadoEm || null
      : openMeteo?.consultadoEm || null;
    base.periodos[chave] = destino;
    destino.rajadaMaxKmh = Number.isFinite(modelo?.rajadaMaxKmh) && modelo.rajadaMaxKmh >= 0
      ? modelo.rajadaMaxKmh : null;
    destino.fonteRajada = Number.isFinite(destino.rajadaMaxKmh) ? FONTE_OPEN_METEO : null;
    destino.rajadaPrevistaEm = Number.isFinite(destino.rajadaMaxKmh) ? modelo?.rajadaPrevistaEm || null : null;
    destino.periodoReferenciaRajada = Number.isFinite(destino.rajadaMaxKmh) ? modelo?.janela || null : null;
    fontesPorCampo[`periodos.${chave}.rajadaMaxKmh`] = Number.isFinite(destino.rajadaMaxKmh) ? FONTE_OPEN_METEO : INDISPONIVEL;
  }
  base.rajadaMaxKmh = Number.isFinite(openMeteo?.rajadaMaxKmh) ? openMeteo.rajadaMaxKmh : null;
  base.rajadaDiariaMaxKmh = Number.isFinite(openMeteo?.previsaoDias?.find((dia) => dia.data === openMeteo.dataReferencia)?.rajadaKmh)
    ? openMeteo.previsaoDias.find((dia) => dia.data === openMeteo.dataReferencia).rajadaKmh : null;
  base.rajadaPrioritariaReferencia = Number.isFinite(base.rajadaMaxKmh) ? {
    fonte: FONTE_OPEN_METEO, rajadaMaxKmh: base.rajadaMaxKmh,
    rajadaPrevistaEm: openMeteo.rajadaPrevistaEm || null,
    periodoReferencia: openMeteo.rajadaPeriodo || openMeteo.janelaHoje?.rotulo,
    local: cidade ? `${cidade.nome}/${cidade.uf}` : null, unidadeOriginal: "km/h",
  } : null;
  fontesPorCampo.rajadaMaxKmh = Number.isFinite(base.rajadaMaxKmh) ? FONTE_OPEN_METEO : INDISPONIVEL;
  fontesPorCampo.rajadaPrevistaKmh = fontesPorCampo.rajadaMaxKmh;
  base.precipitacaoJanelaMm = numero(openMeteo?.precipitacaoTotalMm);
  base.precipitacaoHorariaMaxMm = numero(openMeteo?.precipitacaoHorariaMaxMm);
  base.precipitacaoTotalMm = numero(openMeteo?.precipitacaoPrevistaDiaMm);
  fontesPorCampo.precipitacaoTotalMm = Number.isFinite(base.precipitacaoTotalMm) ? FONTE_OPEN_METEO : INDISPONIVEL;
  fontesPorCampo.precipitacaoJanelaMm = Number.isFinite(base.precipitacaoJanelaMm) ? FONTE_OPEN_METEO : INDISPONIVEL;
  fontesPorCampo.precipitacaoHorariaMaxMm = Number.isFinite(base.precipitacaoHorariaMaxMm) ? FONTE_OPEN_METEO : INDISPONIVEL;
  base.probabilidadeChuvaMax = numero(openMeteo?.probabilidadeChuvaDiariaPct);
  base.probabilidadeChuvaJanelaMax = numero(openMeteo?.probabilidadeChuvaMax);
  fontesPorCampo.probabilidadeChuvaMax = Number.isFinite(base.probabilidadeChuvaMax) ? FONTE_OPEN_METEO : INDISPONIVEL;
  fontesPorCampo.probabilidadeChuvaJanelaMax = Number.isFinite(base.probabilidadeChuvaJanelaMax) ? FONTE_OPEN_METEO : INDISPONIVEL;
  const diagnosticosIndicadores = openMeteo?.diagnosticosIndicadores || [];
  for (const [campo, valor] of [
    ["rajadaMaxKmh", base.rajadaMaxKmh],
    ["precipitacaoPrevistaDiaMm", base.precipitacaoTotalMm],
    ["precipitacaoJanelaMm", base.precipitacaoJanelaMm],
    ["probabilidadeChuvaDiariaPct", base.probabilidadeChuvaMax],
    ["probabilidadeChuvaJanelaMax", base.probabilidadeChuvaJanelaMax],
  ]) {
    if (Number.isFinite(valor)) continue;
    const origem = diagnosticosIndicadores.find((item) =>
      item.status === "indisponivel" && item.motivo)?.motivo;
    diagnosticos.push({
      indicador: campo,
      fontePrioritaria: "Open-Meteo",
      fonteUtilizada: INDISPONIVEL,
      motivo: origem || "A série Open-Meteo não publicou um valor numérico válido para o período solicitado.",
    });
  }

  const agregado = inmetObservacao?.agregado;
  const fonteObservada = fonteObservacao(inmetObservacao?.observacao);
  base.temperaturaObservadaMinC = numero(agregado?.temperaturaMinC);
  base.temperaturaObservadaMaxC = numero(agregado?.temperaturaMaxC);
  base.umidadeObservadaMinPct = numero(agregado?.umidadeMinPct);
  base.umidadeObservadaMaxPct = numero(agregado?.umidadeMaxPct);
  base.precipitacaoDiariaMm = numero(agregado?.precipitacaoTotalMm);
  base.precipitacaoAcumuladaEstimadaMm = numero(openMeteo?.precipitacaoAcumuladaEstimadaMm);
  base.precipitacaoAcumuladaEstimadaStatus = openMeteo?.precipitacaoAcumuladaEstimadaStatus || "indisponivel";
  base.precipitacaoAcumuladaEstimadaJanela = openMeteo?.precipitacaoAcumuladaEstimadaJanela || null;
  base.precipitacaoAcumuladaEstimadaCobertura = openMeteo?.precipitacaoAcumuladaEstimadaCobertura || null;
  base.precipitacaoAcumuladaEstimadaMotivo = openMeteo?.precipitacaoAcumuladaEstimadaMotivo || null;
  base.precipitacaoPrevistaDiaMm = numero(openMeteo?.precipitacaoPrevistaDiaMm);
  const ultimaHora = Array.isArray(agregado?.chuvaPorHora) ? agregado.chuvaPorHora.filter((i) => Number.isFinite(i?.precipitacaoMm)).at(-1) : null;
  base.precipitacaoHoraMm = numero(ultimaHora?.precipitacaoMm);
  base.precipitacaoHoraReferencia = ultimaHora?.intervalo || null;
  base.precipitacaoHoraMedidaEm = ultimaHora?.medidoEm || null;
  base.precipitacaoUltimas24hMm = numero(agregado?.precipitacaoUltimas24hMm);
  base.precipitacaoPeriodoMm = numero(agregado?.precipitacaoPeriodoMm);
  base.rajadaObservadaMaxKmh = numero(agregado?.rajadaMaxKmh);
  base.coberturaObservacoesInmet = agregado?.cobertura || { amostras: 0, parcial: true };
  base.coberturaTemperaturaObservada = agregado?.coberturaTemperatura || { amostras: 0, horasEsperadas: 0, parcial: true };
  base.coberturaUmidadeObservada = agregado?.coberturaUmidade || { amostras: 0, horasEsperadas: 0, parcial: true };
  base.coberturaChuva24h = agregado?.coberturaUltimas24h || { amostras: 0, horasEsperadas: 24, parcial: true };
  base.coberturaChuvaPeriodo = agregado?.coberturaPeriodo || { amostras: 0, horasEsperadas: 0, parcial: true };
  for (const campo of ["temperaturaObservadaMinC", "temperaturaObservadaMaxC", "umidadeObservadaMinPct", "umidadeObservadaMaxPct", "precipitacaoDiariaMm", "precipitacaoHoraMm", "precipitacaoUltimas24hMm", "precipitacaoPeriodoMm", "rajadaObservadaMaxKmh"]) {
    fontesPorCampo[campo] = Number.isFinite(base[campo]) && fonteObservada ? fonteObservada : INDISPONIVEL;
  }
  fontesPorCampo["atual.temperaturaC"] = fonteTemperatura;
  fontesPorCampo["atual.umidadePct"] = fonteUmidade;
  fontesPorCampo["atual.condicao"] = base.atual.fonteCondicao;
  fontesPorCampo.precipitacaoAcumuladaEstimadaMm = Number.isFinite(base.precipitacaoAcumuladaEstimadaMm)
    ? FONTE_OPEN_METEO : INDISPONIVEL;
  fontesPorCampo.precipitacaoPrevistaDiaMm = Number.isFinite(base.precipitacaoPrevistaDiaMm)
    ? FONTE_OPEN_METEO : INDISPONIVEL;
  return { diagnosticos };
}

function complementarRajadaPrevista({ base, openMeteo, fontesPorCampo, cidade }) {
  if (!openMeteo) {
    base.rajadaMaxKmh = null;
    fontesPorCampo.rajadaMaxKmh = INDISPONIVEL;
    fontesPorCampo.rajadaPrevistaKmh = INDISPONIVEL;
    return;
  }
  for (const chave of ["manha", "tarde", "noite"]) {
    const periodo = base.periodos?.[chave];
    const modelo = openMeteo.periodosDiaCompleto?.[chave] || openMeteo.periodos?.[chave];
    if (!periodo) continue;
    periodo.rajadaMaxKmh = Number.isFinite(modelo?.rajadaMaxKmh) ? modelo.rajadaMaxKmh : null;
    periodo.rajadaPrevistaEm = Number.isFinite(periodo.rajadaMaxKmh) ? modelo.rajadaPrevistaEm || null : null;
    periodo.fonteRajada = Number.isFinite(periodo.rajadaMaxKmh) ? FONTE_OPEN_METEO : null;
    periodo.localRajada = Number.isFinite(periodo.rajadaMaxKmh) ? `${cidade.nome}/${cidade.uf}` : null;
    periodo.periodoReferenciaRajada = Number.isFinite(periodo.rajadaMaxKmh) ? modelo.janela || null : null;
    fontesPorCampo[`periodos.${chave}.rajadaMaxKmh`] = Number.isFinite(periodo.rajadaMaxKmh) ? FONTE_OPEN_METEO : INDISPONIVEL;
  }
  const restanteDisponivel = Object.hasOwn(openMeteo, "rajadaRestanteMaxKmh");
  const rajada = restanteDisponivel ? openMeteo.rajadaRestanteMaxKmh : openMeteo.rajadaMaxKmh;
  base.rajadaMaxKmh = Number.isFinite(rajada) ? rajada : null;
  if (!Number.isFinite(base.rajadaMaxKmh)) {
    base.rajadaPrioritariaReferencia = null;
    fontesPorCampo.rajadaMaxKmh = INDISPONIVEL;
    fontesPorCampo.rajadaPrevistaKmh = INDISPONIVEL;
    return;
  }
  base.rajadaPrioritariaReferencia = {
    fonte: FONTE_OPEN_METEO,
    rajadaMaxKmh: rajada,
    rajadaPrevistaEm: restanteDisponivel ? openMeteo.rajadaRestantePrevistaEm : openMeteo.rajadaPrevistaEm,
    periodoReferencia: (restanteDisponivel ? openMeteo.rajadaRestantePeriodo : openMeteo.rajadaPeriodo) || openMeteo.janelaHoje?.rotulo,
    local: `${cidade.nome}/${cidade.uf}`,
    unidadeOriginal: "km/h",
  };
  fontesPorCampo.rajadaMaxKmh = FONTE_OPEN_METEO;
  fontesPorCampo.rajadaPrevistaKmh = FONTE_OPEN_METEO;
}

// A rajada prevista do OCEANOP (ponto da base) tem prioridade sobre a
// Open-Meteo, que permanece como contingência por período e no total.
function aplicarRajadaOceanop({ base, ventoOceanop, fontesPorCampo }) {
  if (!ventoOceanop) return;
  for (const chave of ["manha", "tarde", "noite"]) {
    const periodo = base.periodos?.[chave];
    const rajada = ventoOceanop[chave];
    if (!periodo || !Number.isFinite(rajada?.rajadaMaxKmh)) continue;
    periodo.rajadaMaxKmh = rajada.rajadaMaxKmh;
    periodo.rajadaPrevistaEm = rajada.rajadaPrevistaEm || null;
    periodo.fonteRajada = FONTE_OCEANOP;
    periodo.localRajada = rajada.local || null;
    periodo.periodoReferenciaRajada = rajada.periodoReferencia || null;
    fontesPorCampo[`periodos.${chave}.rajadaMaxKmh`] = FONTE_OCEANOP;
  }
  const resumo = ventoOceanop.resumo;
  if (!Number.isFinite(resumo?.rajadaMaxKmh)) return;
  base.rajadaMaxKmh = resumo.rajadaMaxKmh;
  base.rajadaPrioritariaReferencia = {
    fonte: FONTE_OCEANOP,
    rajadaMaxKmh: resumo.rajadaMaxKmh,
    rajadaPrevistaEm: resumo.rajadaPrevistaEm || null,
    periodoReferencia: resumo.periodoReferencia || null,
    local: resumo.local || null,
    unidadeOriginal: ventoOceanop.unidadeOriginal || null,
  };
  fontesPorCampo.rajadaMaxKmh = FONTE_OCEANOP;
  fontesPorCampo.rajadaPrevistaKmh = FONTE_OCEANOP;
}

module.exports = { aplicarPoliticaFontes, complementarRajadaPrevista, aplicarRajadaOceanop, PROPRIEDADE_INDICADORES, FONTE_OPEN_METEO, FONTE_OCEANOP, FONTE_INMET_PREVISAO, FONTE_INMET_OBSERVACAO, INDISPONIVEL };
