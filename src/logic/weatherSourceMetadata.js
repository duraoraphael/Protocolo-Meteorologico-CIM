function registroFonte({ fonte, instanteMedicao = null, ultimaAtualizacao = null, localidade = null, estacao = null, natureza, status, detalhe = null, unidadeOriginal = null, conversao = null }) {
  return {
    fonte, instanteMedicao, ultimaAtualizacao, localidade, estacao, natureza, status,
    ...(detalhe ? { detalhe } : {}),
    ...(unidadeOriginal ? { unidadeOriginal } : {}),
    ...(conversao ? { conversao } : {}),
  };
}

function metadadosMeteorologicos({ cidade, inmetObservacao, inmetPrevisao, openMeteo, base, fontesPorCampo = {}, rajadaPrioritaria, geradoEm }) {
  const observacao = inmetObservacao?.observacao;
  const localidade = `${cidade.nome}/${cidade.uf}`;
  const chavesPeriodo = ["manha", "tarde", "noite"];
  const fontePeriodos = (campo) => [...new Set(chavesPeriodo
    .map((chave) => fontesPorCampo[`periodos.${chave}.${campo}`])
    .filter((fonte) => fonte && fonte !== "Informação indisponível"))].join(" / ") || "Informação indisponível";
  const previsto = (campo, disponivel, detalhe) => registroFonte({
    fonte: fontesPorCampo[campo] || "Informação indisponível",
    instanteMedicao: fontesPorCampo[campo]?.includes("INMET")
      ? inmetPrevisao?.data || null : openMeteo?.dataReferencia || null,
    ultimaAtualizacao: geradoEm || null,
    localidade,
    natureza: "previsto",
    status: disponivel ? "operacional" : "indisponivel",
    detalhe: disponivel ? detalhe : `${detalhe} Informação indisponível na fonte autorizada.`,
  });
  const previsaoComFonte = (campo, disponivel, detalhe) => {
    const fonte = fontesPorCampo[campo] || "Informação indisponível";
    return registroFonte({
      fonte, instanteMedicao: fonte.includes("INMET") ? inmetPrevisao?.data || null : openMeteo?.dataReferencia || null,
      ultimaAtualizacao: geradoEm || null, localidade, natureza: "previsto",
      status: disponivel ? "operacional" : "indisponivel", detalhe,
    });
  };
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
  const prioridadeRajada = rajadaPrioritaria;
  return {
    temperatura: previsaoComFonte("tempMin", Number.isFinite(base?.tempMin) && Number.isFinite(base?.tempMax), "Mínima e máxima previstas para o dia."),
    umidade: previsaoComFonte("umidadeMin", Number.isFinite(base?.umidadeMin) && Number.isFinite(base?.umidadeMax), "Mínima e máxima previstas para o dia."),
    chuva: previsto("precipitacaoTotalMm", Number.isFinite(base?.precipitacaoTotalMm), "Precipitação diária prevista pela Open-Meteo."),
    chuvaPrevista: registroFonte({
      fonte: fontePeriodos("precipitacaoMm"), instanteMedicao: inmetPrevisao?.data || openMeteo?.dataReferencia || null,
      ultimaAtualizacao: geradoEm || null, localidade, natureza: "previsto",
      status: ["manha", "tarde", "noite"].some((chave) => Number.isFinite(base?.periodos?.[chave]?.precipitacaoMm)) ? "operacional" : "indisponivel",
      detalhe: "Soma dos acumulados horários previstos no período; cada valor representa a hora anterior.",
    }),
    chuvaObservada: observado(Number.isFinite(observacao?.chuvaUltimaHoraMm), "Chuva horária medida pela estação selecionada."),
    vento: registroFonte({
      fonte: fontePeriodos("velocidadeMediaKmh"), instanteMedicao: inmetPrevisao?.data || openMeteo?.dataReferencia || null,
      ultimaAtualizacao: geradoEm || null, localidade, natureza: "previsto",
      status: chavesPeriodo.some((chave) => Number.isFinite(base?.periodos?.[chave]?.velocidadeMediaKmh)) ? "operacional" : "indisponivel",
      detalhe: "Velocidade prevista para os períodos locais; direção e intensidade textuais são registradas separadamente.",
    }),
    rajadaPrevista: Number.isFinite(prioridadeRajada?.rajadaMaxKmh)
      ? registroFonte({
        fonte: prioridadeRajada.fonte || "Open-Meteo — previsão meteorológica",
        instanteMedicao: prioridadeRajada.rajadaPrevistaEm || null,
        ultimaAtualizacao: prioridadeRajada.dataEscrita || geradoEm || null,
        localidade: prioridadeRajada.local || localidade,
        natureza: "previsto",
        status: "operacional",
        detalhe: "Rajada máxima prevista para a base consultada.",
        unidadeOriginal: prioridadeRajada.unidadeOriginal || null,
        conversao: prioridadeRajada.unidadeOriginal && prioridadeRajada.unidadeOriginal !== "km/h" ? "normalizada para km/h" : null,
      })
      : registroFonte({
        fonte: "Open-Meteo — previsão meteorológica",
        instanteMedicao: null,
        ultimaAtualizacao: geradoEm || null,
        localidade,
        natureza: "previsto",
        status: "indisponivel",
        detalhe: "Rajada prevista indisponível na Open-Meteo.",
      }),
    ventoObservado: observado([observacao?.ventoVelocidadeKmh, observacao?.ventoDirecaoGraus, observacao?.rajadaKmh].some(Number.isFinite), "Vento observado; velocidades normalizadas de m/s para km/h."),
    previsaoTextual: registroFonte({
      fonte: "INMET — previsão oficial", instanteMedicao: inmetPrevisao?.data || null,
      ultimaAtualizacao: geradoEm || null, localidade, natureza: "previsto",
      status: inmetPrevisao ? "operacional" : "indisponivel",
      detalhe: "Contexto textual municipal publicado pelo INMET.",
    }),
    condicaoGeral: previsaoComFonte("condicaoGeral", Boolean(base?.condicaoGeral), "Condição geral prevista."),
  };
}

module.exports = { registroFonte, metadadosMeteorologicos };
