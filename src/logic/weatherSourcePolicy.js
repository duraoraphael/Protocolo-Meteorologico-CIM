const FONTE_OPEN_METEO = "Open-Meteo — previsão meteorológica";
const FONTE_INMET_PREVISAO = "INMET — previsão oficial";
const FONTE_INMET_OBSERVACAO = "INMET — estação automática";
const INDISPONIVEL = "Informação indisponível";

const numero = (valor) => Number.isFinite(valor) ? valor : null;
const fonteObservacao = (observacao) => observacao?.estacao?.codigo
  ? `${FONTE_INMET_OBSERVACAO} (${observacao.estacao.codigo})`
  : observacao ? FONTE_INMET_OBSERVACAO : null;

function registrar(diagnosticos, logger, indicador) {
  const motivo = "A Open-Meteo não publicou valor numérico válido para este indicador.";
  diagnosticos.push({ indicador, fontePrioritaria: FONTE_OPEN_METEO, fonteUtilizada: INDISPONIVEL, motivo });
  logger?.warn?.(`[INFORMAÇÃO INDISPONÍVEL] ${indicador}: ${motivo}`);
}

function aplicarPoliticaFontes({ base, openMeteo, inmetObservacao, fontesPorCampo, logger = console }) {
  const diagnosticos = [];
  const chaves = ["manha", "tarde", "noite"];

  for (const campo of ["tempMin", "tempMax", "umidadeMin", "umidadeMax", "precipitacaoTotalMm", "precipitacaoHorariaMaxMm", "probabilidadeChuvaMax"]) {
    base[campo] = numero(openMeteo?.[campo]);
    fontesPorCampo[campo] = Number.isFinite(base[campo]) ? FONTE_OPEN_METEO : INDISPONIVEL;
    if (!Number.isFinite(base[campo])) registrar(diagnosticos, logger, campo);
  }
  base.condicaoGeral = openMeteo?.condicaoGeral || null;
  base.temTempestadeHoje = typeof openMeteo?.temTempestadeHoje === "boolean" ? openMeteo.temTempestadeHoje : null;
  base.atual = openMeteo?.atual || { fonte: INDISPONIVEL, previsao: true };
  fontesPorCampo.condicaoGeral = base.condicaoGeral ? FONTE_OPEN_METEO : INDISPONIVEL;
  fontesPorCampo.temTempestadeHoje = typeof base.temTempestadeHoje === "boolean" ? FONTE_OPEN_METEO : INDISPONIVEL;
  fontesPorCampo.atual = openMeteo?.atual ? FONTE_OPEN_METEO : INDISPONIVEL;

  base.rajadaMaxKmh = null;
  fontesPorCampo.rajadaMaxKmh = INDISPONIVEL;
  fontesPorCampo.rajadaPrevistaKmh = INDISPONIVEL;
  for (const chave of chaves) {
    const origem = openMeteo?.periodos?.[chave];
    const destino = base.periodos?.[chave] || {};
    base.periodos[chave] = Object.assign(destino, origem || {}, { rajadaMaxKmh: null });
    for (const campo of ["direcao", "intensidadeVento", "velocidadeMediaKmh", "velocidadeMaxKmh", "precipitacaoMm", "precipitacaoHorariaMaxMm", "probabilidadeChuva"]) {
      const valor = destino[campo];
      const disponivel = campo === "direcao" || campo === "intensidadeVento"
        ? Boolean(valor && valor !== "—" && valor !== "Sem dado")
        : Number.isFinite(valor);
      fontesPorCampo[`periodos.${chave}.${campo}`] = disponivel ? FONTE_OPEN_METEO : INDISPONIVEL;
    }
    fontesPorCampo[`periodos.${chave}.rajadaMaxKmh`] = INDISPONIVEL;
  }

  const agregado = inmetObservacao?.agregado;
  const fonteObservada = fonteObservacao(inmetObservacao?.observacao);
  base.temperaturaObservadaMinC = numero(agregado?.temperaturaMinC);
  base.temperaturaObservadaMaxC = numero(agregado?.temperaturaMaxC);
  base.umidadeObservadaMinPct = numero(agregado?.umidadeMinPct);
  base.umidadeObservadaMaxPct = numero(agregado?.umidadeMaxPct);
  base.precipitacaoDiariaMm = numero(agregado?.precipitacaoTotalMm);
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
  return { diagnosticos };
}

module.exports = { aplicarPoliticaFontes, FONTE_OPEN_METEO, FONTE_INMET_PREVISAO, FONTE_INMET_OBSERVACAO, INDISPONIVEL };
