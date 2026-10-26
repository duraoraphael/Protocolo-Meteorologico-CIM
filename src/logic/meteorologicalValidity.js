const ESTADOS = new Set(["observada", "prevista", "estimada", "indisponivel", "desatualizada"]);

function classificarDadosRelatorio(relatorio) {
  const fontes = relatorio.fontesPorCampo || {};
  const observacao = relatorio.inmetObservacao;
  const indiceAr = Number.isFinite(relatorio.qualidadeAr?.iqar)
    ? relatorio.qualidadeAr.iqar : relatorio.qualidadeAr?.usAqi;
  const fonteArPorCampo = fontes["ar.iqar"] || fontes["ar.usAqi"];
  const fonteIndiceAr = fonteArPorCampo && !/indisponível/i.test(fonteArPorCampo)
    ? fonteArPorCampo
    : relatorio.qualidadeAr?.fonte || fonteArPorCampo || "Indisponível";
  const atual = observacao?.status === "operacional" && !observacao.observacao?.desatualizado;
  const antiga = Boolean(observacao?.observacao) && !atual;
  const indicador = (campo, natureza, referenciaEm, { desatualizado = false, cobertura = null } = {}) => {
    const valor = relatorio[campo];
    const fonte = fontes[campo] || "Indisponível";
    const disponivel = Number.isFinite(valor);
    return {
      valor: disponivel ? valor : null,
      estado: disponivel ? natureza : desatualizado ? "desatualizada" : "indisponivel",
      fonte: disponivel ? fonte : "Indisponível",
      apiOrigem: disponivel ? fonte : null,
      modeloOuEstacao: !disponivel ? null : natureza === "observada"
        ? observacao?.observacao?.estacao?.codigo || null
        : /Open-Meteo/i.test(fonte) ? "Open-Meteo" : fonte,
      referenciaEm: disponivel ? referenciaEm || null : null,
      consultadoEm: relatorio.geradoEmISO || null,
      localidade: relatorio.cidade?.nome || null,
      coordenadas: { latitude: relatorio.cidade?.latitude ?? null, longitude: relatorio.cidade?.longitude ?? null },
      variavel: campo,
      unidade: campo.toLowerCase().includes("chuva") || campo.toLowerCase().includes("precipitacao") ? "mm"
        : campo.toLowerCase().includes("rajada") ? "km/h"
          : campo.toLowerCase().includes("umidade") ? "%"
            : campo.toLowerCase().includes("temp") ? "°C" : null,
      tipoDado: natureza,
      statusColeta: disponivel ? cobertura?.parcial ? "parcial" : "operacional" : "indisponivel",
      motivoIndisponibilidade: disponivel ? null : campo.startsWith("chuvaEstimada")
        ? relatorio.chuvaEstimadaMotivoIndisponibilidade || "Sem horas históricas válidas."
        : "Sem valor válido da fonte.",
      ...(cobertura ? { cobertura } : {}),
    };
  };
  const dados = {
    temperaturaMin: indicador("tempMin", "observada", observacao?.observacao?.medidoEm, { desatualizado: antiga, cobertura: relatorio.coberturaTemperaturaObservada }),
    temperaturaMax: indicador("tempMax", "observada", observacao?.observacao?.medidoEm, { desatualizado: antiga, cobertura: relatorio.coberturaTemperaturaObservada }),
    temperaturaAtual: indicador("temperaturaAtualC", "observada", observacao?.observacao?.medidoEm, { desatualizado: antiga }),
    umidadeMin: indicador("umidadeMin", "observada", observacao?.observacao?.medidoEm, { desatualizado: antiga, cobertura: relatorio.coberturaUmidadeObservada }),
    umidadeMax: indicador("umidadeMax", "observada", observacao?.observacao?.medidoEm, { desatualizado: antiga, cobertura: relatorio.coberturaUmidadeObservada }),
    umidadeAtual: indicador("umidadeAtualPct", "observada", observacao?.observacao?.medidoEm, { desatualizado: antiga }),
    chuvaObservadaDia: indicador("precipitacaoDiariaMm", "observada", observacao?.observacao?.medidoEm, { desatualizado: antiga, cobertura: relatorio.coberturaObservacoesInmet }),
    chuvaObservadaHora: indicador("precipitacaoHoraMm", "observada", relatorio.precipitacaoHoraMedidaEm, { desatualizado: antiga }),
    chuvaObservada24h: indicador("precipitacaoUltimas24hMm", "observada", observacao?.observacao?.medidoEm, { desatualizado: antiga, cobertura: relatorio.coberturaChuva24h }),
    chuvaPrevistaDia: indicador("chuvaPrevistaDiaMm", "prevista", relatorio.openMeteo?.dataReferencia),
    chuvaEstimadaDia: indicador("chuvaEstimadaDiaMm", "estimada", relatorio.chuvaEstimadaReferencia, { cobertura: relatorio.coberturaChuvaEstimadaDia }),
    chuvaEstimadaHora: indicador("chuvaEstimadaHoraMm", "estimada", relatorio.chuvaEstimadaHoraReferencia),
    chuvaEstimada24h: indicador("chuvaEstimada24hMm", "estimada", relatorio.chuvaEstimadaReferencia, { cobertura: relatorio.coberturaChuvaEstimada24h }),
    rajadaPrevista: indicador("rajadaMaxKmh", "prevista", relatorio.rajadaPrevistaReferencia?.rajadaPrevistaEm || relatorio.openMeteo?.dataReferencia),
    qualidadeAr: {
      valor: Number.isFinite(indiceAr) ? indiceAr : null,
      estado: Number.isFinite(indiceAr) ? "estimada" : "indisponivel",
      fonte: Number.isFinite(indiceAr) ? fonteIndiceAr : "Indisponível",
      referenciaEm: Number.isFinite(indiceAr) ? relatorio.qualidadeAr.referenciaEm : null,
    },
  };
  for (const periodo of relatorio.ventoPorPeriodo || []) {
    dados[`rajada${periodo.periodo}`] = {
      valor: Number.isFinite(periodo.rajadaMaxKmh) ? periodo.rajadaMaxKmh : null,
      estado: Number.isFinite(periodo.rajadaMaxKmh) ? "prevista" : "indisponivel",
      fonte: Number.isFinite(periodo.rajadaMaxKmh) ? periodo.fonteRajada : "Indisponível",
      referenciaEm: periodo.rajadaPrevistaEm || relatorio.openMeteo?.dataReferencia || null,
    };
  }
  return dados;
}

function validarDadosRelatorio(relatorio) {
  const dados = relatorio.classificacaoDados;
  if (!dados || typeof dados !== "object") throw new Error("Classificação meteorológica ausente.");
  const campos = {
    temperaturaMin: relatorio.tempMin,
    temperaturaMax: relatorio.tempMax,
    temperaturaAtual: relatorio.temperaturaAtualC,
    umidadeMin: relatorio.umidadeMin,
    umidadeMax: relatorio.umidadeMax,
    umidadeAtual: relatorio.umidadeAtualPct,
    chuvaObservadaDia: relatorio.precipitacaoDiariaMm,
    chuvaObservadaHora: relatorio.precipitacaoHoraMm,
    chuvaObservada24h: relatorio.precipitacaoUltimas24hMm,
    chuvaPrevistaDia: relatorio.chuvaPrevistaDiaMm,
    chuvaEstimadaDia: relatorio.chuvaEstimadaDiaMm,
    chuvaEstimadaHora: relatorio.chuvaEstimadaHoraMm,
    chuvaEstimada24h: relatorio.chuvaEstimada24hMm,
    rajadaPrevista: relatorio.rajadaMaxKmh,
    qualidadeAr: Number.isFinite(relatorio.qualidadeAr?.iqar) ? relatorio.qualidadeAr.iqar : relatorio.qualidadeAr?.usAqi,
  };
  for (const periodo of relatorio.ventoPorPeriodo || []) campos[`rajada${periodo.periodo}`] = periodo.rajadaMaxKmh;
  for (const [nome, valor] of Object.entries(campos)) {
    if (!dados[nome] || dados[nome].valor !== (Number.isFinite(valor) ? valor : null)) {
      throw new Error(`Classificação meteorológica divergente do relatório: ${nome}.`);
    }
  }
  for (const [nome, item] of Object.entries(dados)) {
    if (!ESTADOS.has(item?.estado)) throw new Error(`Estado meteorológico inválido: ${nome}.`);
    if (Number.isFinite(item.valor)) {
      if (["indisponivel", "desatualizada"].includes(item.estado) || !item.fonte || /indisponível/i.test(item.fonte)) {
        throw new Error(`Valor meteorológico sem procedência válida: ${nome}.`);
      }
    } else if (item.valor !== null || !["indisponivel", "desatualizada"].includes(item.estado)) {
      throw new Error(`Ausência meteorológica tratada como valor: ${nome}.`);
    }
  }
  if (relatorio.inmetObservacao?.status !== "operacional" || relatorio.inmetObservacao.observacao?.desatualizado) {
    for (const nome of ["temperaturaMin", "temperaturaMax", "temperaturaAtual", "umidadeMin", "umidadeMax", "umidadeAtual", "chuvaObservadaDia", "chuvaObservadaHora", "chuvaObservada24h"]) {
      if (Number.isFinite(dados[nome]?.valor)) throw new Error(`Medição INMET antiga não pode ser distribuída: ${nome}.`);
    }
  }
  return true;
}

module.exports = { classificarDadosRelatorio, validarDadosRelatorio };
