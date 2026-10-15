const FONTE_INMET_PREVISAO = "INMET — previsão oficial";
const FONTE_INMET_OBSERVACAO = "INMET — estação automática";
const FONTE_OPEN_METEO = "Open-Meteo — previsão complementar";

function diaBrasilia(valor) {
  if (!Number.isFinite(Date.parse(valor || ""))) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(valor));
}

function valorNumerico(valor) {
  return Number.isFinite(valor) ? valor : null;
}

function registrarIndisponibilidade(lista, logger, indicador, fontePrioritaria, motivo) {
  const diagnostico = { indicador, fontePrioritaria, fonteUtilizada: "Indisponível", motivo };
  lista.push(diagnostico);
  logger?.log?.(`[FONTE INDISPONÍVEL] ${indicador}: ${motivo}`);
}

function escolherPrevisao(prioritario, complementar) {
  if (Number.isFinite(prioritario)) return { valor: prioritario, fonte: FONTE_INMET_PREVISAO };
  if (Number.isFinite(complementar)) return { valor: complementar, fonte: FONTE_OPEN_METEO };
  return { valor: null, fonte: "Indisponível" };
}

function escolherSomenteInmet(valor) {
  return Number.isFinite(valor)
    ? { valor, fonte: FONTE_INMET_PREVISAO }
    : { valor: null, fonte: "Indisponível" };
}

function resumoIndicaTempestade(resumo) {
  return /tempestade|trovoad|raios?|granizo/i.test(String(resumo || ""));
}

function registrarComplemento(lista, logger, indicador) {
  const motivo = "O INMET não publicou valor numérico para este campo; utilizado o valor válido da previsão complementar, sem atribuí-lo ao INMET.";
  lista.push({ indicador, fontePrioritaria: FONTE_INMET_PREVISAO, fonteUtilizada: FONTE_OPEN_METEO, motivo });
  logger?.log?.(`[FONTE COMPLEMENTAR] ${indicador}: ${FONTE_OPEN_METEO}`);
}

function fonteObservacaoInmet(observacao) {
  return observacao
    ? `${FONTE_INMET_OBSERVACAO}${observacao.desatualizado ? " — dado armazenado/desatualizado" : " — observado"}`
    : null;
}

function extremosPrevistos(inmetPrevisao, campo, operacao) {
  const dia = (inmetPrevisao?.dias || []).find((item) => item?.dataBr === inmetPrevisao?.data);
  if (Number.isFinite(dia?.[campo])) return dia[campo];
  const valores = Object.values(inmetPrevisao?.periodos || {})
    .map((periodo) => periodo?.[campo])
    .filter(Number.isFinite);
  return valores.length ? Math[operacao](...valores) : null;
}

function aplicarTemperaturaUmidadeInmet({ base, openMeteo, inmetPrevisao, inmetObservacao, fontesPorCampo, diagnosticos, logger }) {
  const agregado = inmetObservacao?.agregado;
  const observacao = inmetObservacao?.observacao;
  const fonteObservada = fonteObservacaoInmet(observacao);
  const campos = [
    ["tempMin", "temperatura mínima prevista", extremosPrevistos(inmetPrevisao, "tempMin", "min"), openMeteo?.tempMin],
    ["tempMax", "temperatura máxima prevista", extremosPrevistos(inmetPrevisao, "tempMax", "max"), openMeteo?.tempMax],
    ["umidadeMin", "umidade relativa mínima prevista", extremosPrevistos(inmetPrevisao, "umidadeMin", "min"), openMeteo?.umidadeMin],
    ["umidadeMax", "umidade relativa máxima prevista", extremosPrevistos(inmetPrevisao, "umidadeMax", "max"), openMeteo?.umidadeMax],
  ];
  for (const [campo, indicador, valorInmet, valorComplementar] of campos) {
    const escolhido = escolherPrevisao(valorInmet, valorComplementar);
    base[campo] = escolhido.valor;
    fontesPorCampo[campo] = escolhido.fonte;
    if (escolhido.fonte === FONTE_OPEN_METEO) registrarComplemento(diagnosticos, logger, indicador);
    if (base[campo] === null) {
      registrarIndisponibilidade(
        diagnosticos,
        logger,
        indicador,
        FONTE_INMET_PREVISAO,
        "Nem a previsão municipal do INMET nem a previsão complementar retornaram um valor numérico válido para o campo."
      );
    }
  }

  // Os extremos da estação são horários e só representam as amostras já
  // armazenadas. Permanecem disponíveis para auditoria, mas nunca substituem
  // a mínima/máxima diária prevista no campo principal do informativo.
  base.temperaturaObservadaMinC = valorNumerico(agregado?.temperaturaMinC);
  base.temperaturaObservadaMaxC = valorNumerico(agregado?.temperaturaMaxC);
  base.umidadeObservadaMinPct = valorNumerico(agregado?.umidadeMinPct);
  base.umidadeObservadaMaxPct = valorNumerico(agregado?.umidadeMaxPct);
  base.coberturaTemperaturaObservada = agregado?.coberturaTemperatura || { amostras: 0, horasEsperadas: 0, parcial: true };
  base.coberturaUmidadeObservada = agregado?.coberturaUmidade || { amostras: 0, horasEsperadas: 0, parcial: true };
  for (const campo of ["temperaturaObservadaMinC", "temperaturaObservadaMaxC", "umidadeObservadaMinPct", "umidadeObservadaMaxPct"]) {
    fontesPorCampo[campo] = Number.isFinite(base[campo]) && fonteObservada ? fonteObservada : "Indisponível";
  }

  for (const chave of ["manha", "tarde", "noite"]) {
    const periodo = base.periodos?.[chave];
    if (!periodo) continue;
    const previsto = inmetPrevisao?.periodos?.[chave];
    const complementar = (openMeteo?.periodosDiaCompleto || openMeteo?.periodos)?.[chave];
    for (const campo of ["tempMin", "tempMax", "umidadeMin", "umidadeMax"]) {
      const escolhido = escolherPrevisao(previsto?.[campo], complementar?.[campo]);
      periodo[campo] = escolhido.valor;
      fontesPorCampo[`periodos.${chave}.${campo}`] = escolhido.fonte;
    }
  }

  if (base.atual || observacao) {
    const fonteCondicao = base.atual?.fonte || (inmetPrevisao ? FONTE_INMET_PREVISAO : openMeteo ? FONTE_OPEN_METEO : "Indisponível");
    const fonteAtual = observacao && base.atual?.condicao
      ? `${FONTE_INMET_OBSERVACAO} — observado (temperatura/umidade) / ${fonteCondicao} (condição)`
      : fonteObservada || fonteCondicao;
    base.atual = {
      ...(base.atual || {}),
      temperaturaC: valorNumerico(observacao?.temperaturaAtualC),
      umidadePct: valorNumerico(observacao?.umidadeAtualPct),
      horario: observacao?.medidoEm || base.atual?.horario || null,
      observado: Boolean(observacao),
      fonte: fonteAtual,
    };
    fontesPorCampo.atual = fonteAtual;
  }
}

function aplicarChuvaVentoInmet({ base, openMeteo, inmetPrevisao, inmetObservacao, fontesPorCampo, diagnosticos, logger }) {
  const agregado = inmetObservacao?.agregado;
  const observacao = inmetObservacao?.observacao;
  const fonteObservada = fonteObservacaoInmet(observacao);
  const chaves = ["manha", "tarde", "noite"];

  for (const chave of chaves) {
    const periodo = base.periodos?.[chave];
    if (!periodo) continue;
    const previsto = inmetPrevisao?.periodos?.[chave];
    const complementar = (openMeteo?.periodosDiaCompleto || openMeteo?.periodos)?.[chave];
    const observado = agregado?.periodos?.[chave];

    // A tabela operacional é de previsão. Observações da estação permanecem
    // em campos próprios para monitoramento interno e nunca ocupam uma coluna
    // rotulada como prevista.
    const direcaoComplementar = complementar?.direcao && complementar.direcao !== "—" ? complementar.direcao : null;
    const intensidadeComplementar = complementar?.intensidadeVento && complementar.intensidadeVento !== "Sem dado"
      ? complementar.intensidadeVento
      : null;
    periodo.direcao = previsto?.direcaoVento || direcaoComplementar || "—";
    periodo.intensidadeVento = previsto?.intensidadeVento || intensidadeComplementar || "—";
    const velocidadeMedia = escolherPrevisao(previsto?.velocidadeMediaKmh, complementar?.velocidadeMediaKmh);
    const rajada = escolherPrevisao(previsto?.rajadaMaxKmh, complementar?.rajadaMaxKmh);
    const precipitacao = escolherPrevisao(previsto?.precipitacaoMm, complementar?.precipitacaoMm);
    const precipitacaoHoraria = escolherPrevisao(previsto?.precipitacaoHorariaMaxMm, complementar?.precipitacaoHorariaMaxMm);
    const probabilidade = escolherPrevisao(previsto?.probabilidadeChuva, complementar?.probabilidadeChuva);
    periodo.velocidadeMediaKmh = velocidadeMedia.valor;
    periodo.velocidadeMaxKmh = null;
    periodo.rajadaMaxKmh = rajada.valor;
    periodo.rajadaObservadaMaxKmh = valorNumerico(observado?.rajadaMaxKmh);
    periodo.precipitacaoMm = precipitacao.valor;
    periodo.precipitacaoHorariaMaxMm = precipitacaoHoraria.valor;
    periodo.probabilidadeChuva = probabilidade.valor;
    periodo.tempestade = previsto?.resumo
      ? resumoIndicaTempestade(previsto.resumo)
      : typeof complementar?.tempestade === "boolean" ? complementar.tempestade : null;
    periodo.tipoDado = previsto || complementar?.disponivel ? "previsto" : "indisponivel";
    periodo.medidoEm = null;

    fontesPorCampo[`periodos.${chave}.direcao`] = previsto?.direcaoVento
      ? FONTE_INMET_PREVISAO
      : direcaoComplementar ? FONTE_OPEN_METEO : "Indisponível";
    fontesPorCampo[`periodos.${chave}.intensidadeVento`] = previsto?.intensidadeVento
      ? FONTE_INMET_PREVISAO
      : intensidadeComplementar ? FONTE_OPEN_METEO : "Indisponível";
    fontesPorCampo[`periodos.${chave}.velocidadeMediaKmh`] = velocidadeMedia.fonte;
    fontesPorCampo[`periodos.${chave}.velocidadeMaxKmh`] = "Indisponível";
    fontesPorCampo[`periodos.${chave}.rajadaMaxKmh`] = rajada.fonte;
    fontesPorCampo[`periodos.${chave}.rajadaObservadaMaxKmh`] = Number.isFinite(periodo.rajadaObservadaMaxKmh) && fonteObservada ? fonteObservada : "Indisponível";
    fontesPorCampo[`periodos.${chave}.precipitacaoMm`] = precipitacao.fonte;
    fontesPorCampo[`periodos.${chave}.precipitacaoHorariaMaxMm`] = precipitacaoHoraria.fonte;
    fontesPorCampo[`periodos.${chave}.probabilidadeChuva`] = probabilidade.fonte;
    for (const [indicador, escolhido] of [
      [`velocidade média prevista (${chave})`, velocidadeMedia],
      [`rajada prevista (${chave})`, rajada],
      [`chuva prevista (${chave})`, precipitacao],
      [`intensidade horária de chuva prevista (${chave})`, precipitacaoHoraria],
      [`probabilidade de chuva (${chave})`, probabilidade],
    ]) {
      if (escolhido.fonte === FONTE_OPEN_METEO) {
        registrarComplemento(diagnosticos, logger, indicador);
      } else if (escolhido.fonte === "Indisponível") {
        registrarIndisponibilidade(
          diagnosticos,
          logger,
          indicador,
          FONTE_INMET_PREVISAO,
          "Nem o produto municipal do INMET nem a previsão complementar da Open-Meteo publicaram valor numérico válido para este campo."
        );
      }
    }
  }

  const somaPrevista = chaves.map((chave) => base.periodos?.[chave]?.precipitacaoMm);
  base.precipitacaoTotalMm = somaPrevista.length && somaPrevista.every(Number.isFinite)
    ? Math.round(somaPrevista.reduce((soma, valor) => soma + valor, 0) * 10) / 10
    : null;
  base.precipitacaoDiariaMm = valorNumerico(agregado?.precipitacaoTotalMm);
  const ultimaHoraComChuva = Array.isArray(agregado?.chuvaPorHora)
    ? agregado.chuvaPorHora.filter((item) => Number.isFinite(item?.precipitacaoMm)).at(-1)
    : null;
  base.precipitacaoHoraMm = valorNumerico(ultimaHoraComChuva?.precipitacaoMm);
  base.precipitacaoHoraReferencia = ultimaHoraComChuva?.intervalo || null;
  base.precipitacaoHoraMedidaEm = ultimaHoraComChuva?.medidoEm || null;
  base.precipitacaoUltimas24hMm = valorNumerico(agregado?.precipitacaoUltimas24hMm);
  base.precipitacaoPeriodoMm = valorNumerico(agregado?.precipitacaoPeriodoMm);
  base.precipitacaoHorariaMaxMm = (() => {
    const valores = chaves.map((chave) => base.periodos?.[chave]?.precipitacaoHorariaMaxMm).filter(Number.isFinite);
    return valores.length ? Math.max(...valores) : null;
  })();
  const rajadasPrevistas = chaves
    .map((chave) => base.periodos?.[chave]?.rajadaMaxKmh)
    .filter(Number.isFinite);
  base.rajadaMaxKmh = rajadasPrevistas.length ? Math.max(...rajadasPrevistas) : null;
  base.rajadaObservadaMaxKmh = valorNumerico(agregado?.rajadaMaxKmh);
  const probabilidades = chaves.map((chave) => base.periodos?.[chave]?.probabilidadeChuva).filter(Number.isFinite);
  base.probabilidadeChuvaMax = probabilidades.length ? Math.max(...probabilidades) : null;
  const resumosInmet = Object.values(inmetPrevisao?.periodos || {}).map((periodo) => periodo?.resumo).filter(Boolean);
  const tempestadeComplementar = typeof openMeteo?.temTempestadeHoje === "boolean"
    ? openMeteo.temTempestadeHoje
    : (() => {
      const valores = chaves.map((chave) => (openMeteo?.periodosDiaCompleto || openMeteo?.periodos)?.[chave]?.tempestade)
        .filter((valor) => typeof valor === "boolean");
      return valores.length ? valores.some(Boolean) : null;
    })();
  base.temTempestadeHoje = resumosInmet.length
    ? resumosInmet.some(resumoIndicaTempestade)
    : tempestadeComplementar;
  base.coberturaObservacoesInmet = agregado?.cobertura || { amostras: 0, parcial: true };
  base.coberturaChuva24h = agregado?.coberturaUltimas24h || { amostras: 0, horasEsperadas: 24, parcial: true };
  base.coberturaChuvaPeriodo = agregado?.coberturaPeriodo || { amostras: 0, horasEsperadas: 0, parcial: true };

  for (const campo of ["precipitacaoDiariaMm", "precipitacaoHoraMm", "precipitacaoUltimas24hMm", "precipitacaoPeriodoMm", "rajadaObservadaMaxKmh"]) {
    fontesPorCampo[campo] = Number.isFinite(base[campo]) && fonteObservada ? fonteObservada : "Indisponível";
  }
  const fonteAgregada = (campo) => {
    const fontes = chaves.map((chave) => fontesPorCampo[`periodos.${chave}.${campo}`]).filter((fonte) => fonte && fonte !== "Indisponível");
    if (!fontes.length) return "Indisponível";
    return [...new Set(fontes)].join(" / ");
  };
  fontesPorCampo.precipitacaoTotalMm = Number.isFinite(base.precipitacaoTotalMm)
    ? fonteAgregada("precipitacaoMm")
    : "Indisponível";
  fontesPorCampo.precipitacaoHorariaMaxMm = Number.isFinite(base.precipitacaoHorariaMaxMm) ? fonteAgregada("precipitacaoHorariaMaxMm") : "Indisponível";
  fontesPorCampo.rajadaMaxKmh = Number.isFinite(base.rajadaMaxKmh) ? fonteAgregada("rajadaMaxKmh") : "Indisponível";
  fontesPorCampo.probabilidadeChuvaMax = Number.isFinite(base.probabilidadeChuvaMax) ? fonteAgregada("probabilidadeChuva") : "Indisponível";
  fontesPorCampo.temTempestadeHoje = typeof base.temTempestadeHoje !== "boolean"
    ? "Indisponível"
    : resumosInmet.length ? FONTE_INMET_PREVISAO : FONTE_OPEN_METEO;
  fontesPorCampo.rajadaPrevistaKmh = fontesPorCampo.rajadaMaxKmh;

  if (!observacao) {
    for (const indicador of ["chuva observada", "velocidade/direção do vento e rajada medidas pela estação"]) {
      registrarIndisponibilidade(
        diagnosticos,
        logger,
        indicador,
        FONTE_INMET_OBSERVACAO,
        "A API oficial do INMET não retornou uma observação válida e não existe outro provedor autorizado para este indicador."
      );
    }
  }
}

/**
 * Política obrigatória de fontes:
 * - vento, rajada e chuva previstos priorizam a previsão municipal INMET;
 * - quando um campo numérico não é publicado pelo INMET, a Open-Meteo pode
 *   complementá-lo, sempre identificada como fonte complementar;
 * - observações INMET permanecem separadas e nunca são tratadas como previsão.
 */
function aplicarPoliticaFontes({
  base,
  openMeteo,
  inmetPrevisao,
  inmetObservacao,
  fontesPorCampo,
  logger = console,
}) {
  const diagnosticos = [];
  aplicarTemperaturaUmidadeInmet({ base, openMeteo, inmetPrevisao, inmetObservacao, fontesPorCampo, diagnosticos, logger });
  aplicarChuvaVentoInmet({ base, openMeteo, inmetPrevisao, inmetObservacao, fontesPorCampo, diagnosticos, logger });
  return { diagnosticos };
}

module.exports = {
  aplicarPoliticaFontes,
  diaBrasilia,
  FONTE_INMET_PREVISAO,
  FONTE_INMET_OBSERVACAO,
  FONTE_OPEN_METEO,
};
