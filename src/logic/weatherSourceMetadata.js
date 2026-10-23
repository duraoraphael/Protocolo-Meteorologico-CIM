function registroFonte({ fonte, instanteMedicao = null, ultimaAtualizacao = null, localidade = null, estacao = null, natureza, status, detalhe = null, unidadeOriginal = null, conversao = null }) {
  return {
    fonte, instanteMedicao, ultimaAtualizacao, localidade, estacao, natureza, status,
    ...(detalhe ? { detalhe } : {}),
    ...(unidadeOriginal ? { unidadeOriginal } : {}),
    ...(conversao ? { conversao } : {}),
  };
}

function metadadosMeteorologicos({ cidade, inmetObservacao, inmetPrevisao, openMeteo, rajadaPrioritaria, oceanopVento, geradoEm }) {
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
  const observado = (disponivel, detalhe) => registroFonte({
    fonte: "INMET — estação automática",
    instanteMedicao: observacao?.medidoEm || null,
    ultimaAtualizacao: observacao?.atualizadoEm || geradoEm || null,
    localidade: observacao?.estacao?.nome || localidade,
    estacao: observacao?.estacao?.codigo || null,
    natureza: "observado",
    status: disponivel ? (inmetObservacao?.status || "operacional") : "indisponivel",
    detalhe,
  });
  const prioridadeRajada = rajadaPrioritaria || oceanopVento;
  return {
    temperatura: previsto(periodos.some((p) => Number.isFinite(p?.tempMin) || Number.isFinite(p?.tempMax)), "Mínima e máxima previstas para o dia."),
    umidade: previsto(periodos.some((p) => Number.isFinite(p?.umidadeMin) || Number.isFinite(p?.umidadeMax)), "Mínima e máxima previstas para o dia."),
    chuva: previsto(Number.isFinite(openMeteo?.precipitacaoTotalMm), "Chuva prevista para a janela operacional."),
    chuvaPrevista: previsto(periodos.some((p) => Number.isFinite(p?.precipitacaoMm)), "Acumulado numérico previsto para o período."),
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
