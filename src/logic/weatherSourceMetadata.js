function registroFonte({
  fonte,
  instanteMedicao = null,
  ultimaAtualizacao = null,
  localidade = null,
  estacao = null,
  natureza,
  status,
  detalhe = null,
}) {
  return {
    fonte,
    instanteMedicao,
    ultimaAtualizacao,
    localidade,
    estacao,
    natureza,
    status,
    ...(detalhe ? { detalhe } : {}),
  };
}

function metadadosMeteorologicos({ cidade, climaSaude, inmetObservacao, inmetPrevisao, openMeteo, geradoEm }) {
  const observacao = inmetObservacao?.observacao;
  const localidade = `${cidade.nome}/${cidade.uf}`;
  const metadadoInmet = (indicadorDisponivel) => registroFonte({
    fonte: "INMET — estação automática",
    instanteMedicao: observacao?.medidoEm || null,
    ultimaAtualizacao: observacao?.atualizadoEm || geradoEm || null,
    localidade: observacao?.estacao?.nome || localidade,
    estacao: observacao?.estacao?.codigo || null,
    natureza: "observado",
    status: indicadorDisponivel ? (observacao?.status || inmetObservacao?.status || "operacional") : "indisponivel",
    detalhe: indicadorDisponivel
      ? `Distância da base: ${Number.isFinite(observacao?.estacao?.distanciaKm) ? `${observacao.estacao.distanciaKm} km` : "não informada"}.`
      : inmetObservacao?.mensagem || "Indicador não publicado na observação atual.",
  });
  const metadadoPrevisao = (indicadorDisponivel, detalhe) => registroFonte({
    fonte: "INMET — previsão oficial",
    instanteMedicao: inmetPrevisao?.data || null,
    ultimaAtualizacao: geradoEm || null,
    localidade,
    natureza: "previsto",
    status: indicadorDisponivel ? "operacional" : "indisponivel",
    detalhe,
  });
  const metadadoPrevisaoComFallback = (inmetDisponivel, complementoDisponivel, detalhe) => registroFonte({
    fonte: inmetDisponivel ? "INMET — previsão oficial" : complementoDisponivel ? "Open-Meteo — previsão complementar" : "Indisponível",
    instanteMedicao: inmetDisponivel ? inmetPrevisao?.data || null : openMeteo?.dataReferencia || null,
    ultimaAtualizacao: geradoEm || null,
    localidade,
    natureza: "previsto",
    status: inmetDisponivel || complementoDisponivel ? "operacional" : "indisponivel",
    detalhe: inmetDisponivel ? detalhe : complementoDisponivel
      ? `${detalhe} O INMET não publicou o valor numérico; utilizado complemento identificado da Open-Meteo.`
      : `${detalhe} Campo ausente nas fontes prioritária e complementar.`,
  });
  const periodosPrevisao = Object.values(inmetPrevisao?.periodos || {});
  const temperaturaPrevista = periodosPrevisao.some((periodo) =>
    Number.isFinite(periodo?.tempMin) || Number.isFinite(periodo?.tempMax));
  const umidadePrevista = periodosPrevisao.some((periodo) =>
    Number.isFinite(periodo?.umidadeMin) || Number.isFinite(periodo?.umidadeMax));
  const rajadaPrevista = periodosPrevisao.some((periodo) => Number.isFinite(periodo?.rajadaMaxKmh));
  const chuvaPrevista = periodosPrevisao.some((periodo) => Number.isFinite(periodo?.precipitacaoMm));
  const periodosComplementares = Object.values(openMeteo?.periodosDiaCompleto || openMeteo?.periodos || {});
  const rajadaComplementar = periodosComplementares.some((periodo) => Number.isFinite(periodo?.rajadaMaxKmh));
  const chuvaComplementar = periodosComplementares.some((periodo) => Number.isFinite(periodo?.precipitacaoMm));
  const ventoComplementar = periodosComplementares.some((periodo) =>
    Boolean(periodo?.direcao && periodo.direcao !== "—") ||
    Number.isFinite(periodo?.velocidadeMediaKmh) ||
    Number.isFinite(periodo?.rajadaMaxKmh));
  const ventoInmetDisponivel = periodosPrevisao.some((periodo) =>
    Boolean(periodo?.direcaoVento || periodo?.intensidadeVento) ||
    Number.isFinite(periodo?.velocidadeMediaKmh) ||
    Number.isFinite(periodo?.rajadaMaxKmh));
  const chuvaInmetDisponivel = periodosPrevisao.some((periodo) => Boolean(periodo?.resumo));

  return {
    temperatura: metadadoPrevisaoComFallback(temperaturaPrevista, Number.isFinite(openMeteo?.tempMin) || Number.isFinite(openMeteo?.tempMax), "Mínima e máxima previstas para o dia."),
    umidade: metadadoPrevisaoComFallback(umidadePrevista, Number.isFinite(openMeteo?.umidadeMin) || Number.isFinite(openMeteo?.umidadeMax), "Mínima e máxima previstas para o dia."),
    chuva: metadadoPrevisao(chuvaInmetDisponivel, chuvaPrevista
      ? "Resumo, acumulado e probabilidade publicados pela previsão municipal do INMET."
      : "Resumo textual oficial do INMET disponível; acumulado e probabilidade permanecem indisponíveis quando não publicados numericamente."),
    chuvaPrevista: metadadoPrevisaoComFallback(chuvaPrevista, chuvaComplementar,
      "Acumulado numérico previsto para o período."),
    chuvaObservada: metadadoInmet(Number.isFinite(observacao?.chuvaUltimaHoraMm)),
    vento: metadadoPrevisaoComFallback(ventoInmetDisponivel, ventoComplementar,
      "Direção, intensidade e valores numéricos previstos para o vento."),
    rajadaPrevista: metadadoPrevisaoComFallback(rajadaPrevista, rajadaComplementar,
      "Rajada máxima numérica prevista."),
    ventoObservado: metadadoInmet([observacao?.ventoVelocidadeKmh, observacao?.ventoDirecaoGraus, observacao?.rajadaKmh].some(Number.isFinite)),
    previsaoTextual: registroFonte({
      fonte: inmetPrevisao ? "INMET — previsão oficial" : openMeteo ? "Open-Meteo — previsão complementar" : "Indisponível",
      instanteMedicao: inmetPrevisao?.data || openMeteo?.dataReferencia || null,
      ultimaAtualizacao: geradoEm || null,
      localidade,
      natureza: "previsto",
      status: inmetPrevisao ? "operacional" : "indisponivel",
    }),
    condicaoGeral: registroFonte({
      fonte: "INMET — previsão oficial",
      instanteMedicao: inmetPrevisao?.data || null,
      ultimaAtualizacao: geradoEm || null,
      localidade,
      natureza: "previsto",
      status: inmetPrevisao || openMeteo ? "operacional" : "indisponivel",
      detalhe: inmetPrevisao ? "Resumo textual municipal publicado pelo INMET." : "Condição prevista pela fonte complementar; INMET indisponível nesta coleta.",
    }),
  };
}

module.exports = { registroFonte, metadadosMeteorologicos };
