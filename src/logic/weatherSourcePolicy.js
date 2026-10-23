const FONTE_OPEN_METEO = "Open-Meteo — previsão meteorológica";
const FONTE_INMET_PREVISAO = "INMET — previsão oficial";
const FONTE_INMET_OBSERVACAO = "INMET — estação automática";
const INDISPONIVEL = "Informação indisponível";
const DISTANCIA_MAXIMA_TERMO_KM = 50;

const numero = (valor) => Number.isFinite(valor) ? valor : null;
const fonteObservacao = (observacao) => observacao?.estacao?.codigo
  ? `${FONTE_INMET_OBSERVACAO} (${observacao.estacao.codigo})`
  : observacao ? FONTE_INMET_OBSERVACAO : null;

function registrar(diagnosticos, logger, indicador, fonte = FONTE_OPEN_METEO, motivo = "A Open-Meteo não publicou valor numérico válido para este indicador.") {
  diagnosticos.push({ indicador, fontePrioritaria: fonte, fonteUtilizada: INDISPONIVEL, motivo });
  logger?.warn?.(`[INFORMAÇÃO INDISPONÍVEL] ${indicador}: ${motivo}`);
}

function aplicarPoliticaFontes({ base, cidade, openMeteo, inmetObservacao, fontesPorCampo, logger = console }) {
  const diagnosticos = [];
  const chaves = ["manha", "tarde", "noite"];

  for (const campo of ["precipitacaoTotalMm", "precipitacaoHorariaMaxMm", "probabilidadeChuvaMax"]) {
    base[campo] = numero(openMeteo?.[campo]);
    fontesPorCampo[campo] = Number.isFinite(base[campo]) ? FONTE_OPEN_METEO : INDISPONIVEL;
    if (!Number.isFinite(base[campo])) registrar(diagnosticos, logger, campo);
  }
  base.condicaoGeral = openMeteo?.condicaoGeral || null;
  base.temTempestadeHoje = typeof openMeteo?.temTempestadeHoje === "boolean" ? openMeteo.temTempestadeHoje : null;
  base.atual = { ...(openMeteo?.atual || { fonte: INDISPONIVEL, previsao: true }) };
  fontesPorCampo.condicaoGeral = base.condicaoGeral ? FONTE_OPEN_METEO : INDISPONIVEL;
  fontesPorCampo.temTempestadeHoje = typeof base.temTempestadeHoje === "boolean" ? FONTE_OPEN_METEO : INDISPONIVEL;
  fontesPorCampo.atual = openMeteo?.atual ? FONTE_OPEN_METEO : INDISPONIVEL;

  base.rajadaMaxKmh = numero(openMeteo?.rajadaMaxKmh);
  fontesPorCampo.rajadaMaxKmh = Number.isFinite(base.rajadaMaxKmh) ? FONTE_OPEN_METEO : INDISPONIVEL;
  fontesPorCampo.rajadaPrevistaKmh = fontesPorCampo.rajadaMaxKmh;
  for (const chave of chaves) {
    const origem = openMeteo?.periodos?.[chave];
    const destino = base.periodos?.[chave] || {};
    base.periodos[chave] = Object.assign(destino, origem || {}, { rajadaMaxKmh: numero(origem?.rajadaMaxKmh) });
    for (const campo of ["direcao", "intensidadeVento", "velocidadeMediaKmh", "velocidadeMaxKmh", "precipitacaoMm", "precipitacaoHorariaMaxMm", "probabilidadeChuva"]) {
      const valor = destino[campo];
      const disponivel = campo === "direcao" || campo === "intensidadeVento"
        ? Boolean(valor && valor !== "—" && valor !== "Sem dado")
        : Number.isFinite(valor);
      fontesPorCampo[`periodos.${chave}.${campo}`] = disponivel ? FONTE_OPEN_METEO : INDISPONIVEL;
    }
    fontesPorCampo[`periodos.${chave}.rajadaMaxKmh`] = Number.isFinite(destino.rajadaMaxKmh) ? FONTE_OPEN_METEO : INDISPONIVEL;
  }

  // Uma resposta de cache ou uma medição antiga não pode parecer atual.
  const observacaoAtual = inmetObservacao?.status === "operacional" && !inmetObservacao.observacao?.desatualizado;
  const estacao = inmetObservacao?.observacao?.estacao;
  const representativa = Number.isFinite(estacao?.distanciaKm) && estacao.distanciaKm <= DISTANCIA_MAXIMA_TERMO_KM &&
    (!cidade?.uf || estacao.uf === cidade.uf);
  const agregado = observacaoAtual ? inmetObservacao.agregado : null;
  const agregadoTermo = representativa ? agregado : null;
  const fonteObservada = agregado ? fonteObservacao(inmetObservacao.observacao) : null;
  base.temperaturaObservadaMinC = numero(agregadoTermo?.temperaturaMinC);
  base.temperaturaObservadaMaxC = numero(agregadoTermo?.temperaturaMaxC);
  base.umidadeObservadaMinPct = numero(agregadoTermo?.umidadeMinPct);
  base.umidadeObservadaMaxPct = numero(agregadoTermo?.umidadeMaxPct);
  const motivoInmet = !observacaoAtual
    ? "Sem observação INMET atualizada."
    : !representativa ? `Estação INMET ${estacao?.codigo || "desconhecida"} distante ou fora da UF da base.`
      : "Sem leitura INMET válida para o período local.";
  for (const [campo, observado] of Object.entries({
    tempMin: "temperaturaObservadaMinC", tempMax: "temperaturaObservadaMaxC",
    umidadeMin: "umidadeObservadaMinPct", umidadeMax: "umidadeObservadaMaxPct",
  })) {
    base[campo] = base[observado];
    fontesPorCampo[campo] = Number.isFinite(base[campo]) && fonteObservada ? fonteObservada : INDISPONIVEL;
    if (!Number.isFinite(base[campo])) registrar(diagnosticos, logger, campo, FONTE_INMET_OBSERVACAO, motivoInmet);
  }
  base.temperaturaAtualC = numero(agregadoTermo?.temperaturaAtualC);
  base.umidadeAtualPct = numero(agregadoTermo?.umidadeAtualPct);
  base.atual.temperaturaC = base.temperaturaAtualC;
  base.atual.umidadePct = base.umidadeAtualPct;
  base.atual.temperaturaUmidadeTipoDado = fonteObservada ? "observado" : "indisponivel";
  base.atual.temperaturaUmidadeMedidoEm = fonteObservada ? inmetObservacao.observacao.medidoEm : null;
  for (const campo of ["temperaturaAtualC", "umidadeAtualPct"]) {
    fontesPorCampo[campo] = Number.isFinite(base[campo]) && fonteObservada ? fonteObservada : INDISPONIVEL;
  }
  fontesPorCampo["atual.temperaturaC"] = fontesPorCampo.temperaturaAtualC;
  fontesPorCampo["atual.umidadePct"] = fontesPorCampo.umidadeAtualPct;
  base.precipitacaoDiariaMm = numero(agregado?.precipitacaoTotalMm);
  const ultimaHora = Array.isArray(agregado?.chuvaPorHora) ? agregado.chuvaPorHora.filter((i) => Number.isFinite(i?.precipitacaoMm)).at(-1) : null;
  base.precipitacaoHoraMm = numero(ultimaHora?.precipitacaoMm);
  base.precipitacaoHoraReferencia = ultimaHora?.intervalo || null;
  base.precipitacaoHoraMedidaEm = ultimaHora?.medidoEm || null;
  base.precipitacaoUltimas24hMm = numero(agregado?.precipitacaoUltimas24hMm);
  base.precipitacaoPeriodoMm = numero(agregado?.precipitacaoPeriodoMm);
  base.rajadaObservadaMaxKmh = numero(agregado?.rajadaMaxKmh);
  base.coberturaObservacoesInmet = agregado?.cobertura || { amostras: 0, parcial: true };
  base.coberturaTemperaturaObservada = agregadoTermo?.coberturaTemperatura || { amostras: 0, horasEsperadas: agregado?.coberturaTemperatura?.horasEsperadas || 0, parcial: true };
  base.coberturaUmidadeObservada = agregadoTermo?.coberturaUmidade || { amostras: 0, horasEsperadas: agregado?.coberturaUmidade?.horasEsperadas || 0, parcial: true };
  base.coberturaChuva24h = agregado?.coberturaUltimas24h || { amostras: 0, horasEsperadas: 24, parcial: true };
  base.coberturaChuvaPeriodo = agregado?.coberturaPeriodo || { amostras: 0, horasEsperadas: 0, parcial: true };
  const estimativa = openMeteo?.estimativaChuva;
  base.chuvaEstimadaDiaMm = numero(estimativa?.diaMm);
  base.chuvaEstimadaHoraMm = numero(estimativa?.ultimaHoraMm);
  base.chuvaEstimada24hMm = numero(estimativa?.ultimas24hMm);
  base.chuvaEstimadaReferencia = estimativa?.referenciaEm || null;
  base.chuvaEstimadaHoraReferencia = estimativa?.ultimaHoraReferencia || null;
  base.coberturaChuvaEstimadaDia = estimativa?.coberturaDia || null;
  base.coberturaChuvaEstimada24h = estimativa?.cobertura24h || null;
  base.chuvaEstimadaMotivoIndisponibilidade = estimativa?.motivoIndisponibilidade ||
    (!openMeteo ? "Open-Meteo Weather Forecast API indisponível." : "Sem precipitação histórica válida na janela.");
  for (const campo of ["chuvaEstimadaDiaMm", "chuvaEstimadaHoraMm", "chuvaEstimada24hMm"]) {
    fontesPorCampo[campo] = Number.isFinite(base[campo]) ? "Open-Meteo — estimativa de modelo" : INDISPONIVEL;
  }
  for (const campo of ["temperaturaObservadaMinC", "temperaturaObservadaMaxC", "umidadeObservadaMinPct", "umidadeObservadaMaxPct", "precipitacaoDiariaMm", "precipitacaoHoraMm", "precipitacaoUltimas24hMm", "precipitacaoPeriodoMm", "rajadaObservadaMaxKmh"]) {
    fontesPorCampo[campo] = Number.isFinite(base[campo]) && fonteObservada ? fonteObservada : INDISPONIVEL;
  }
  return { diagnosticos };
}

module.exports = { aplicarPoliticaFontes, FONTE_OPEN_METEO, FONTE_INMET_PREVISAO, FONTE_INMET_OBSERVACAO, INDISPONIVEL, DISTANCIA_MAXIMA_TERMO_KM };
