// Monta o relatório SEMANAL consolidado das bases do CIM (enviado às
// segundas de manhã).
//
// Diferença de propósito em relação ao informativo diário: o diário responde
// "o que fazer hoje"; o semanal responde "onde e quando a semana exige
// atenção", para que o CIM possa PLANEJAR — remanejar equipe, antecipar
// inspeção, reprogramar operação portuária.
//
// Por isso o relatório é organizado por RISCO, não por ordem alfabética de
// base: quem abre o e-mail na segunda de manhã precisa ver primeiro o que
// pode dar problema.

const { CIDADES, getCidade } = require("../config/cities");
const { buscarSemanaMarEmLote } = require("../sources/openMeteoSemanal");
const { buscarPrevisaoInmet, buscarAvisosInmet } = require("../sources/inmet");
const { LIMIARES } = require("./riskEngine");
const { registrarDocumentoOperacional } = require("./documentProvenance");
const { formatarRajadaPrevista } = require("../../public/weather-format");

// Níveis de severidade usados no relatório semanal. O número permite ordenar
// e escolher a cor; o rótulo aparece no documento.
const SEVERIDADE = {
  CRITICO: { nivel: 3, rotulo: "Crítico", cor: "#C0392B" },
  ATENCAO: { nivel: 2, rotulo: "Atenção", cor: "#E67E22" },
  NORMAL: { nivel: 1, rotulo: "Normal", cor: "#00843D" },
  INDISPONIVEL: { nivel: 0, rotulo: "Indisponível", cor: "#6B7280" },
};

const DIAS_SEMANA = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

function formatarDia(dataIso) {
  // dataIso vem como "2026-08-31" (já no fuso de São Paulo pela API).
  const [ano, mes, dia] = dataIso.split("-").map(Number);
  const d = new Date(ano, mes - 1, dia);
  const relatorio = {
    diaSemana: DIAS_SEMANA[d.getDay()],
    diaMes: `${String(dia).padStart(2, "0")}/${String(mes).padStart(2, "0")}`,
    ehFimDeSemana: d.getDay() === 0 || d.getDay() === 6,
  };
  return registrarDocumentoOperacional(relatorio, {
    tipo: "semanal",
    localidade: "multiplas-bases",
    fontes: ["INMET — previsão municipal", "Open-Meteo Marine", "INMET — avisos oficiais", "Clima e Saúde — UV indisponível"],
  });
}

/**
 * Classifica UM dia de UMA base, devolvendo os riscos encontrados.
 * Usa os mesmos limiares do motor diário (riskEngine) para que o semanal e o
 * diário nunca se contradigam.
 */
function avaliarDia(dia, mar) {
  const riscos = [];
  const dadosIncompletos = ![
    dia.codigoTempo,
    dia.precipitacaoMm,
    dia.probabilidadeChuva,
    dia.rajadaMaxKmh,
    dia.uvMax,
  ].every(Number.isFinite);

  if (dia.temMuitaChuva) {
    riscos.push({ tipo: "Tempestade", severidade: SEVERIDADE.CRITICO, detalhe: "Trovoada prevista" });
  }

  // Quem define a gravidade da chuva é o VOLUME, não a probabilidade: 100% de
  // chance de 3 mm é chuva fraca garantida, não evento crítico. A
  // probabilidade entra como confiança da previsão — um volume alto com
  // chance baixa ainda merece atenção, mas não o mesmo peso.
  const mm = dia.precipitacaoMm ?? 0;
  const prob = dia.probabilidadeChuva ?? 0;
  const contexto = `${mm} mm previstos (${prob}% de chance)`;

  if (mm >= LIMIARES.chuvaIntensaMm) {
    riscos.push({ tipo: "Chuva intensa", severidade: SEVERIDADE.CRITICO, detalhe: contexto });
  } else if (mm >= LIMIARES.chuvaModeradaMm) {
    riscos.push({ tipo: "Chuva", severidade: SEVERIDADE.ATENCAO, detalhe: contexto });
  } else if (mm >= 1 && prob >= LIMIARES.chuvaIntensaProb) {
    // Volume pequeno, mas praticamente certo: relevante para trabalho externo
    // e deslocamento, sem caracterizar evento severo.
    riscos.push({ tipo: "Chuva fraca", severidade: SEVERIDADE.ATENCAO, detalhe: contexto });
  }

  if (dia.rajadaMaxKmh >= LIMIARES.ventoForteKmh) {
    riscos.push({
      tipo: "Vento forte",
      severidade: SEVERIDADE.CRITICO,
      detalhe: `Rajadas de até ${formatarRajadaPrevista(dia.rajadaMaxKmh)}`,
    });
  } else if (dia.rajadaMaxKmh >= LIMIARES.ventoModeradoKmh) {
    riscos.push({
      tipo: "Vento moderado",
      severidade: SEVERIDADE.ATENCAO,
      detalhe: `Rajadas de até ${formatarRajadaPrevista(dia.rajadaMaxKmh)}`,
    });
  }

  if (dia.uvMax != null && dia.uvMax >= LIMIARES.uvExtremo) {
    riscos.push({
      tipo: "UV extremo",
      severidade: SEVERIDADE.CRITICO,
      detalhe: `Índice UV ${dia.uvMax}`,
    });
  } else if (dia.uvMax != null && dia.uvMax >= LIMIARES.uvMuitoAlto) {
    riscos.push({
      tipo: "UV muito alto",
      severidade: SEVERIDADE.ATENCAO,
      detalhe: `Índice UV ${dia.uvMax}`,
    });
  }

  if (mar?.alturaMaxM != null) {
    if (mar.alturaMaxM >= LIMIARES.marGrossoM) {
      riscos.push({
        tipo: "Mar grosso",
        severidade: SEVERIDADE.CRITICO,
        detalhe: `Ondas de até ${mar.alturaMaxM} m`,
      });
    } else if (mar.alturaMaxM >= LIMIARES.marModeradoM) {
      riscos.push({
        tipo: "Mar moderado",
        severidade: SEVERIDADE.ATENCAO,
        detalhe: `Ondas de até ${mar.alturaMaxM} m`,
      });
    }
  }

  const severidadeMax = riscos.reduce(
    (max, r) => (r.severidade.nivel > max.nivel ? r.severidade : max),
    dadosIncompletos ? SEVERIDADE.INDISPONIVEL : SEVERIDADE.NORMAL
  );

  return { riscos, severidade: severidadeMax, dadosIncompletos };
}

function montarBase(cidade, semana, semanaMar, avisosInmet, avisos) {
  const dias = semana.dias.map((diaOriginal, i) => {
    // O produto municipal do INMET fornece condição, temperatura e umidade.
    // Rajada, chuva/probabilidade e UV permanecem indisponíveis quando não
    // publicados pelas respectivas fontes obrigatórias.
    const dia = {
      ...diaOriginal,
      precipitacaoMm: diaOriginal.precipitacaoMm ?? null,
      probabilidadeChuva: diaOriginal.probabilidadeChuva ?? null,
      rajadaMaxKmh: diaOriginal.rajadaMaxKmh ?? null,
      uvMax: null,
      codigoTempo: null,
      temMuitaChuva: false,
    };
    const mar = semanaMar?.dias?.[i] || null;
    const { riscos, severidade, dadosIncompletos } = avaliarDia(dia, mar);
    return { ...dia, ...formatarDia(dia.data), mar, riscos, severidade, dadosIncompletos };
  });

  const diasCriticos = dias.filter((d) => d.severidade.nivel === 3);
  const diasAtencao = dias.filter((d) => d.severidade.nivel === 2);

  // Pontuação usada só para ordenar as bases no relatório: crítico pesa mais
  // que atenção, e dias mais próximos pesam mais que os do fim da semana.
  const pontuacaoRisco = dias.reduce((soma, d, i) => {
    const peso = 1 - i * 0.08;
    return soma + Math.max(0, d.severidade.nivel - 1) * peso;
  }, 0);

  const validos = (campo) => dias.map((dia) => campo(dia)).filter(Number.isFinite);
  const minimo = (valores) => valores.length ? Math.min(...valores) : null;
  const maximo = (valores) => valores.length ? Math.max(...valores) : null;
  const chuvas = validos((dia) => dia.precipitacaoMm);

  return {
    cidade,
    dias,
    avisosInmet,
    avisos,
    diasCriticos,
    diasAtencao,
    pontuacaoRisco: Math.round(pontuacaoRisco * 10) / 10,
    severidadeMax: dias.reduce(
      (max, d) => (d.severidade.nivel > max.nivel ? d.severidade : max),
      SEVERIDADE.INDISPONIVEL
    ),
    // Extremos da semana, para a linha-resumo de cada base.
    tempMinSemana: minimo(validos((dia) => dia.tempMin)),
    tempMaxSemana: maximo(validos((dia) => dia.tempMax)),
    chuvaTotalSemana: chuvas.length === dias.length
      ? Math.round(chuvas.reduce((soma, valor) => soma + valor, 0) * 10) / 10
      : null,
    rajadaMaxSemana: maximo(validos((dia) => dia.rajadaMaxKmh)),
    uvMaxSemana: maximo(validos((dia) => dia.uvMax)),
    ondaMaxSemana: semanaMar
      ? maximo(validos((dia) => dia.mar?.alturaMaxM))
      : null,
  };
}

/**
 * Monta o relatório semanal completo.
 * @param {object} opcoes
 * @param {string[]} [opcoes.bases] chaves das bases; padrão: todas
 * @param {number} [opcoes.dias=7] tamanho da janela
 */
async function montarRelatorioSemanal({ bases, dias: diasPrevisao = 7 } = {}) {
  const chaves = bases && bases.length ? bases : Object.keys(CIDADES);
  const cidades = chaves.map((c) => getCidade(c));

  // O semanal obedece à mesma matriz do informativo diário: previsão
  // meteorológica exclusivamente municipal do INMET. Falhas ficam isoladas
  // por base e não acionam fallback de outro provedor.
  const previsoes = [];
  for (const cidade of cidades) {
    try {
      const resposta = await buscarPrevisaoInmet(cidade.codigoIbge);
      previsoes.push({
        fonte: "INMET — previsão oficial",
        dias: (resposta.dias || []).slice(0, diasPrevisao).map((dia) => ({
          data: dia.data,
          condicao: dia.resumo,
          tempMin: dia.tempMin,
          tempMax: dia.tempMax,
          umidadeMin: dia.umidadeMin,
          umidadeMax: dia.umidadeMax,
          precipitacaoMm: dia.precipitacaoMm ?? null,
          probabilidadeChuva: null,
          rajadaMaxKmh: dia.rajadaMaxKmh ?? null,
          uvMax: null,
          codigoTempo: null,
          temMuitaChuva: false,
        })),
      });
    } catch (erro) {
      previsoes.push({ erro: `Previsão INMET indisponível: ${erro.message}` });
    }
  }

  // Mar: só as costeiras entram no lote, mas o índice precisa voltar a
  // apontar para a base certa.
  const indicesCosteiras = cidades
    .map((c, i) => (c.costeira ? i : -1))
    .filter((i) => i >= 0);
  const pontosMar = indicesCosteiras.map((i) => {
    const c = cidades[i];
    return c.pontoMar || { latitude: c.latitude, longitude: c.longitude };
  });
  const maresPorIndice = new Map();
  if (pontosMar.length) {
    const mares = await buscarSemanaMarEmLote(pontosMar, diasPrevisao);
    indicesCosteiras.forEach((indiceBase, k) => maresPorIndice.set(indiceBase, mares[k]));
  }

  // Avisos oficiais do INMET: uma chamada por base (endpoint aceita só um
  // município por vez), com falha isolada para não derrubar a base.
  const avisosPorIndice = new Map();
  for (const [i, cidade] of cidades.entries()) {
    try {
      const r = await buscarAvisosInmet(cidade.codigoIbge);
      avisosPorIndice.set(i, { avisos: r?.avisos || [] });
    } catch (erro) {
      avisosPorIndice.set(i, { avisos: [], falha: `Avisos INMET indisponíveis: ${erro.message}` });
    }
  }

  const resultados = cidades.map((cidade, i) => {
    const previsao = previsoes[i];
    if (!previsao || previsao.erro) {
      return { cidade, erro: previsao?.erro || "Previsão indisponível.", dias: [], avisos: [] };
    }

    const avisos = [];
    const mar = maresPorIndice.get(i);
    if (cidade.costeira && mar?.erro) {
      avisos.push(`Dados de mar indisponíveis: ${mar.erro}`);
    }
    const inmet = avisosPorIndice.get(i) || { avisos: [] };
    if (inmet.falha) avisos.push(inmet.falha);

    return montarBase(cidade, previsao, mar?.erro ? null : mar, inmet.avisos, avisos);
  });

  const basesOk = resultados.filter((b) => !b.erro);
  const basesComFalha = resultados.filter((b) => b.erro);
  if (!basesOk.length) {
    throw new Error("Relatório semanal bloqueado: nenhuma base possui previsão verificável.");
  }

  // Ordena por risco: quem abre na segunda vê primeiro o que exige ação.
  const basesOrdenadas = [...basesOk].sort((a, b) => b.pontuacaoRisco - a.pontuacaoRisco);

  // Consolidado por DIA da semana, somando todas as bases — responde
  // "qual dia da semana vai ser o pior no conjunto das instalações".
  const rotulosDias = basesOk[0]?.dias.map((d) => ({
    data: d.data,
    diaSemana: d.diaSemana,
    diaMes: d.diaMes,
    ehFimDeSemana: d.ehFimDeSemana,
  })) || [];

  const panoramaDias = rotulosDias.map((rotulo, i) => {
    const doDia = basesOk.map((b) => b.dias[i]).filter(Boolean);
    const chuvas = doDia.map((dia) => dia.precipitacaoMm).filter(Number.isFinite);
    const rajadas = doDia.map((dia) => dia.rajadaMaxKmh).filter(Number.isFinite);
    return {
      ...rotulo,
      basesCriticas: doDia.filter((d) => d.severidade.nivel === 3).length,
      basesAtencao: doDia.filter((d) => d.severidade.nivel === 2).length,
      basesNormais: doDia.filter((d) => d.severidade.nivel === 1).length,
      basesIndisponiveis: doDia.filter((d) => d.severidade.nivel === 0).length,
      chuvaMediaMm: chuvas.length === doDia.length && chuvas.length
        ? Math.round((chuvas.reduce((soma, valor) => soma + valor, 0) / chuvas.length) * 10) / 10
        : null,
      rajadaMaxKmh: rajadas.length ? Math.max(...rajadas) : null,
    };
  });

  const diaMaisCritico = [...panoramaDias].sort(
    (a, b) => b.basesCriticas * 10 + b.basesAtencao - (a.basesCriticas * 10 + a.basesAtencao)
  )[0];

  // Lista plana de alertas, ordenada por severidade e proximidade — é o que
  // vira o "painel de alertas" no topo do documento.
  const alertas = [];
  for (const base of basesOk) {
    for (const [indice, dia] of base.dias.entries()) {
      for (const risco of dia.riscos) {
        alertas.push({
          base: base.cidade.nome,
          uf: base.cidade.uf,
          chave: base.cidade.chave,
          diaSemana: dia.diaSemana,
          diaMes: dia.diaMes,
          indiceDia: indice,
          ...risco,
        });
      }
    }
  }
  alertas.sort(
    (a, b) => b.severidade.nivel - a.severidade.nivel || a.indiceDia - b.indiceDia
  );

  const agora = new Date(
    new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" })
  );

  const primeiroDia = rotulosDias[0];
  const ultimoDia = rotulosDias[rotulosDias.length - 1];

  return {
    tipo: "semanal",
    geradoEmISO: agora.toISOString(),
    dataGeracao: new Intl.DateTimeFormat("pt-BR", {
      dateStyle: "long",
      timeZone: "America/Sao_Paulo",
    }).format(agora),
    horaGeracao: new Intl.DateTimeFormat("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      timeZone: "America/Sao_Paulo",
    }).format(agora),
    periodoLabel: primeiroDia && ultimoDia ? `${primeiroDia.diaMes} a ${ultimoDia.diaMes}` : "—",
    nomeArquivoBase: `Relatorio_Semanal_CIM_${agora.toISOString().slice(0, 10)}`,
    rotulosDias,
    panoramaDias,
    diaMaisCritico,
    basesOrdenadas,
    basesComFalha,
    alertas,
    alertasCriticos: alertas.filter((a) => a.severidade.nivel === 3),
    totalBases: chaves.length,
    totalBasesCriticas: basesOk.filter((b) => b.severidadeMax.nivel === 3).length,
    totalBasesAtencao: basesOk.filter((b) => b.severidadeMax.nivel === 2).length,
    totalBasesNormais: basesOk.filter((b) => b.severidadeMax.nivel === 1).length,
    totalBasesIndisponiveis: basesOk.filter((b) => b.severidadeMax.nivel === 0).length,
  };
}

module.exports = { montarRelatorioSemanal, avaliarDia, SEVERIDADE };
