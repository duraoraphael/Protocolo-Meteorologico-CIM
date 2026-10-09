const FONTE_CLIMA_SAUDE = "Clima e Saúde — Ministério da Saúde";
const FONTE_OPEN_METEO = "Open-Meteo";
const FONTE_INMET = "INMET — previsão oficial";

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

function motivoClimaSaude(climaSaude, climaAtual, indicador) {
  if (!climaSaude?.dados) {
    return climaSaude?.status === "indisponivel"
      ? `Clima Saúde indisponível na coleta; ${indicador} não foi obtido na fonte prioritária.`
      : `Clima Saúde não possui cobertura configurada para ${indicador} nesta base.`;
  }
  if (!climaAtual) return `Clima Saúde não possuía atualização válida para a data do informativo (${indicador}).`;
  return `Clima Saúde não disponibilizou ${indicador} para a localidade e o período.`;
}

function registrarFallback(lista, logger, indicador, fontePrioritaria, fonteUtilizada, motivo) {
  const diagnostico = { indicador, fontePrioritaria, fonteUtilizada, motivo };
  lista.push(diagnostico);
  logger?.log?.(`[FALLBACK] ${indicador}: ${motivo} Fonte utilizada: ${fonteUtilizada}.`);
  return diagnostico;
}

function selecionar({
  indicador,
  prioritario,
  fontePrioritaria,
  alternativo,
  fonteAlternativa = FONTE_OPEN_METEO,
  motivo,
  diagnosticos,
  logger,
}) {
  const valorPrioritario = valorNumerico(prioritario);
  if (valorPrioritario !== null) return { valor: valorPrioritario, fonte: fontePrioritaria };
  const valorAlternativo = valorNumerico(alternativo);
  if (valorAlternativo !== null) {
    registrarFallback(diagnosticos, logger, indicador, fontePrioritaria, fonteAlternativa, motivo);
    return { valor: valorAlternativo, fonte: fonteAlternativa };
  }
  return { valor: null, fonte: "Indisponível" };
}

/**
 * Aplica a matriz de fontes por indicador sem promover estimativas numéricas
 * a avisos oficiais. A função altera `base` e `fontesPorCampo`, que já são os
 * objetos de trabalho exclusivos da montagem do relatório.
 */
function aplicarPoliticaFontes({
  base,
  openMeteo,
  inmetPrevisao,
  climaSaude,
  fontesPorCampo,
  agora = new Date(),
  logger = console,
}) {
  const diagnosticos = [];
  const hoje = diaBrasilia(agora instanceof Date ? agora.toISOString() : agora);
  const dadosClima = climaSaude?.dados || null;
  const diaDadosClima = dadosClima?.dataConsulta || diaBrasilia(dadosClima?.consultadoEm);
  const climaAtual = dadosClima && diaDadosClima === hoje ? dadosClima : null;

  const camposClima = [
    ["tempMin", "temperatura mínima", climaAtual?.temperatura?.minima, openMeteo?.tempMin],
    ["tempMax", "temperatura máxima", climaAtual?.temperatura?.maxima, openMeteo?.tempMax],
    ["umidadeMin", "umidade relativa mínima", climaAtual?.umidade?.minima, openMeteo?.umidadeMin],
    ["umidadeMax", "umidade relativa máxima", climaAtual?.umidade?.maxima, openMeteo?.umidadeMax],
  ];
  for (const [campo, indicador, prioritario, alternativo] of camposClima) {
    const escolha = selecionar({
      indicador,
      prioritario,
      fontePrioritaria: FONTE_CLIMA_SAUDE,
      alternativo,
      motivo: motivoClimaSaude(climaSaude, climaAtual, indicador),
      diagnosticos,
      logger,
    });
    base[campo] = escolha.valor;
    fontesPorCampo[campo] = escolha.fonte;
  }

  const chaves = ["manha", "tarde", "noite"];
  for (const chave of chaves) {
    const periodo = base.periodos?.[chave];
    if (!periodo) continue;
    const oficial = inmetPrevisao?.periodos?.[chave];
    const alternativo = openMeteo?.periodos?.[chave];

    const rajada = selecionar({
      indicador: `rajada prevista (${periodo.periodo || chave})`,
      prioritario: oficial?.rajadaMaxKmh,
      fontePrioritaria: FONTE_INMET,
      alternativo: alternativo?.rajadaMaxKmh,
      motivo: "INMET não disponibilizou previsão numérica de rajada para a base e o período.",
      diagnosticos,
      logger,
    });
    periodo.rajadaMaxKmh = rajada.valor;
    fontesPorCampo[`periodos.${chave}.rajadaMaxKmh`] = rajada.fonte;

    const chuva = selecionar({
      indicador: `chuva acumulada (${periodo.periodo || chave})`,
      prioritario: oficial?.precipitacaoMm,
      fontePrioritaria: FONTE_INMET,
      alternativo: alternativo?.precipitacaoMm,
      motivo: "INMET não disponibilizou volume numérico de chuva compatível para a base e o período.",
      diagnosticos,
      logger,
    });
    periodo.precipitacaoMm = chuva.valor;
    fontesPorCampo[`periodos.${chave}.precipitacaoMm`] = chuva.fonte;
  }

  const rajadas = chaves
    .map((chave) => base.periodos?.[chave]?.rajadaMaxKmh)
    .filter(Number.isFinite);
  base.rajadaMaxKmh = rajadas.length ? Math.max(...rajadas) : null;
  const fonteRajada = chaves
    .filter((chave) => base.periodos?.[chave]?.rajadaMaxKmh === base.rajadaMaxKmh)
    .map((chave) => fontesPorCampo[`periodos.${chave}.rajadaMaxKmh`])
    .find(Boolean);
  fontesPorCampo.rajadaMaxKmh = fonteRajada || "Indisponível";

  const chuvaDiaria = selecionar({
    indicador: "chuva acumulada diária",
    prioritario: inmetPrevisao?.precipitacaoDiariaMm,
    fontePrioritaria: FONTE_INMET,
    alternativo: openMeteo?.precipitacaoDiariaMm,
    motivo: "INMET não disponibilizou acumulado diário numérico compatível para a base e a data.",
    diagnosticos,
    logger,
  });
  base.precipitacaoDiariaMm = chuvaDiaria.valor;
  fontesPorCampo.precipitacaoDiariaMm = chuvaDiaria.fonte;

  if (openMeteo?.chuvaHoraria?.length) {
    registrarFallback(
      diagnosticos,
      logger,
      "chuva acumulada horária",
      FONTE_INMET,
      FONTE_OPEN_METEO,
      "INMET não disponibilizou série horária de volume de chuva para a base e a data."
    );
  }

  return { climaAtual, diagnosticos };
}

module.exports = {
  aplicarPoliticaFontes,
  diaBrasilia,
  FONTE_CLIMA_SAUDE,
  FONTE_OPEN_METEO,
  FONTE_INMET,
};
