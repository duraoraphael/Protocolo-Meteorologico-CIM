function registroFonte({ fonte, instanteMedicao = null, ultimaAtualizacao = null, localidade = null, estacao = null, natureza, status, detalhe = null, unidadeOriginal = null, conversao = null }) {
  return {
    fonte, instanteMedicao, ultimaAtualizacao, localidade, estacao, natureza, status,
    ...(detalhe ? { detalhe } : {}),
    ...(unidadeOriginal ? { unidadeOriginal } : {}),
    ...(conversao ? { conversao } : {}),
  };
}

function metadadosMeteorologicos({ cidade, inmetObservacao, inmetPrevisao, openMeteo, temperaturaObservada = [], umidadeObservada = [], coberturaTemperatura, coberturaUmidade, rajadaPrioritaria, oceanopVento, geradoEm }) {
  const observacao = inmetObservacao?.observacao;
  const localidade = `${cidade.nome}/${cidade.uf}`;
  const periodos = Object.values(openMeteo?.periodos || {});
  const previsto = (disponivel, detalhe) => registroFonte({
    fonte: "Open-Meteo — previsão meteorológica",
    instanteMedicao: openMeteo?.dataReferencia || null,
    ultimaAtualizacao: geradoEm || null,
    localidade,
    natureza: "previsto",
    status: disponivel ? "operacional" : "indisponivel",
    detalhe: disponivel ? detalhe : `${detalhe} Informação indisponível na fonte autorizada.`,
  });
  const observado = (disponivel, detalhe, cobertura) => registroFonte({
    fonte: "INMET — estação automática",
    instanteMedicao: observacao?.medidoEm || null,
    ultimaAtualizacao: observacao?.atualizadoEm || geradoEm || null,
    localidade: observacao?.estacao?.nome || localidade,
    estacao: observacao?.estacao?.codigo || null,
    natureza: "observado",
    status: inmetObservacao?.status === "degradado" || observacao?.desatualizado
      ? "desatualizado" : disponivel ? cobertura?.parcial ? "parcial" : "operacional" : "indisponivel",
    detalhe: cobertura?.parcial ? `${detalhe} Cobertura parcial: ${cobertura.amostras}/${cobertura.horasEsperadas} leituras.` : detalhe,
  });
  const prioridadeRajada = rajadaPrioritaria || oceanopVento;
  return {
    temperatura: observado(temperaturaObservada.some(Number.isFinite), "Mínima e máxima horárias observadas no dia civil local.", coberturaTemperatura),
    umidade: observado(umidadeObservada.some(Number.isFinite), "Mínima e máxima horárias observadas no dia civil local.", coberturaUmidade),
    chuva: previsto(Number.isFinite(openMeteo?.precipitacaoTotalMm), "Chuva prevista para a janela operacional."),
    chuvaPrevista: previsto(periodos.some((p) => Number.isFinite(p?.precipitacaoMm)), "Acumulado numérico previsto para o período."),
    chuvaEstimada: registroFonte({
      fonte: "Open-Meteo — estimativa de modelo",
      instanteMedicao: openMeteo?.estimativaChuva?.referenciaEm || null,
      ultimaAtualizacao: openMeteo?.estimativaChuva?.consultadoEm || geradoEm || null,
      localidade,
      natureza: "estimado",
      status: Number.isFinite(openMeteo?.estimativaChuva?.diaMm)
        ? openMeteo.estimativaChuva.coberturaDia?.parcial ? "parcial" : "operacional"
        : "indisponivel",
      detalhe: openMeteo?.estimativaChuva?.motivoIndisponibilidade ||
        "Acumulados históricos modelados, independentes da medição INMET.",
    }),
    chuvaObservada: observado(Number.isFinite(observacao?.chuvaUltimaHoraMm), "Chuva horária medida pela estação selecionada."),
    vento: previsto(periodos.some((p) => p?.direcao || p?.intensidadeVento || Number.isFinite(p?.velocidadeMediaKmh)), "Direção, intensidade e velocidade previstas."),
    rajadaPrevista: Number.isFinite(prioridadeRajada?.rajadaMaxKmh)
      ? registroFonte({
        fonte: prioridadeRajada.fonte || "Petrobras — OCEANOP",
        instanteMedicao: prioridadeRajada.rajadaPrevistaEm || null,
        ultimaAtualizacao: prioridadeRajada.dataEscrita || geradoEm || null,
        localidade: prioridadeRajada.local || localidade,
        natureza: "previsto",
        status: "operacional",
        detalhe: "Rajada máxima prevista para a base consultada.",
        unidadeOriginal: prioridadeRajada.unidadeOriginal || null,
        conversao: prioridadeRajada.unidadeOriginal && prioridadeRajada.unidadeOriginal !== "km/h" ? "normalizada para km/h" : null,
      })
      : previsto(periodos.some((p) => Number.isFinite(p?.rajadaMaxKmh)), "Rajada máxima numérica prevista."),
    ventoObservado: observado([observacao?.ventoVelocidadeKmh, observacao?.ventoDirecaoGraus, observacao?.rajadaKmh].some(Number.isFinite), "Vento observado; velocidades normalizadas de m/s para km/h."),
    previsaoTextual: registroFonte({
      fonte: "INMET — previsão oficial", instanteMedicao: inmetPrevisao?.data || null,
      ultimaAtualizacao: geradoEm || null, localidade, natureza: "previsto",
      status: inmetPrevisao ? "operacional" : "indisponivel",
      detalhe: "Contexto textual municipal publicado pelo INMET.",
    }),
    condicaoGeral: previsto(Boolean(openMeteo?.condicaoGeral), "Condição geral prevista."),
  };
}

module.exports = { registroFonte, metadadosMeteorologicos };
