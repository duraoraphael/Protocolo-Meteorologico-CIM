// Motor de regras: converte os dados brutos consolidados (Open-Meteo + INMET)
// em (1) o evento climático mais relevante do dia e (2) as recomendações de
// segurança adaptadas ao cenário — nunca uma lista genérica fixa.
//
// Limiares complementares documentados aqui para poderem ser revisados pelo
// CIM. Chuva e vento usam exclusivamente os critérios de inmetAlertRules.js.

const {
  GRAUS,
  classificarCondicoesMeteorologicas,
  maiorGrau,
  recomendacoes,
} = require("./inmetAlertRules");
const { formatarTitulo } = require("../../public/alert-title");
const { grauAvisoInmet, fenomenoAvisoInmet, normalizarComparacao } = require("../sources/inmet");
const { recomendacoesFenomeno } = require("./phenomenonRecommendations");

const LIMIARES = {
  // Contrato legado do relatório semanal. O informativo diário não usa estes
  // campos para chuva/vento; sua classificação vem de inmetAlertRules.js.
  chuvaIntensaMm: 20,
  chuvaIntensaProb: 70,
  chuvaModeradaMm: 5,
  chuvaModeradaProb: 30,
  ventoForteKmh: 60,
  ventoModeradoKmh: 40,
  baixaUmidadePct: 20,
  // Índice UV — faixas da OMS: 8+ é "muito alto", 11+ é "extremo".
  uvMuitoAlto: 8,
  uvExtremo: 11,
  // Altura significativa de onda (m) — referência para operação portuária,
  // transferência de pessoal e uso de heliponto em instalações costeiras.
  marGrossoM: 2.5,
  marModeradoM: 1.5,
  // European AQI da Open-Meteo/CAMS: acima de 60 começa a faixa "Ruim".
  aqiEuropeuRuim: 60,
};

function textoAvisos(avisos, regex) {
  return avisos.some((a) => regex.test(a.descricao || ""));
}

function janelaDoEvento(periodos, assinatura) {
  const lista = Object.values(periodos || {}).filter(Boolean);
  const campos = assinatura === "vento"
    ? ["rajadaMaxKmh"]
    : ["precipitacaoHorariaMaxMm", "precipitacaoMm"];
  let escolhido = null;
  let maior = -Infinity;
  for (const periodo of lista) {
    const valor = campos.map((campo) => periodo?.[campo]).find(Number.isFinite);
    if (Number.isFinite(valor) && valor > maior) {
      maior = valor;
      escolhido = periodo;
    }
  }
  if (!escolhido) return "ao longo do dia";
  return [escolhido.periodo, escolhido.janela ? `(${escolhido.janela})` : null].filter(Boolean).join(" ");
}

const NIVEL_POR_GRAU = Object.freeze({
  NORMAL: 0,
  "ATENÇÃO": 2,
  ALERTA: 4,
  "EMERGÊNCIA": 5,
});

function grauPorNivel(nivel) {
  if (nivel >= 5) return "EMERGÊNCIA";
  if (nivel >= 3) return "ALERTA";
  return nivel >= 1 ? "ATENÇÃO" : "NORMAL";
}

function grauUvConfigurado(categoria) {
  const padrao = categoria === "extremo" ? "ALERTA" : "ATENÇÃO";
  const chave = categoria === "extremo" ? "UV_GRAU_EXTREMO" : "UV_GRAU_MUITO_ALTO";
  const valor = String(process.env[chave] || padrao)
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
  return ({ ATENCAO: "ATENÇÃO", ALERTA: "ALERTA", EMERGENCIA: "EMERGÊNCIA" })[valor] || padrao;
}

function rotuloFenomeno(tipo) {
  return ({
    raios: "TEMPESTADE COM RAIOS",
    tempestadePrevista: "TEMPESTADE",
    calorExtremo: "CALOR EXTREMO",
    baixaUmidade: "BAIXA UMIDADE",
    marGrosso: "AGITAÇÃO MARÍTIMA",
    marModerado: "CONDIÇÃO MARÍTIMA",
    uvAlto: "ÍNDICE UV ELEVADO",
    qualidadeArRuim: "QUALIDADE DO AR",
    avisoInmet: "AVISO OFICIAL INMET",
  })[tipo] || String(tipo).toUpperCase();
}

function avaliarRiscos(consolidado) {
  const {
    tempMax,
    umidadeMin,
    rajadaMaxKmh,
    precipitacaoHorariaMaxMm,
    precipitacaoTotalMm,
    temTempestadeHoje,
    periodos,
    fontesPorCampo = {},
    avisosInmet = [],
    mar,
    qualidadeAr,
  } = consolidado;

  const candidatos = [];

  // Avisos oficiais sempre prevalecem. Quando não há aviso aplicável ao
  // fenômeno, os valores numéricos confiáveis podem gerar uma classificação
  // interna, identificada explicitamente como previsão e sem atribuição ao
  // INMET.
  const avisosCobertos = new Set();
  const contextosOficiais = avisosInmet.map((aviso) => {
    const fenomeno = fenomenoAvisoInmet(aviso.descricao);
    const texto = normalizarComparacao([aviso.descricao, aviso.riscos].flat().filter(Boolean).join(" "));
    return {
      aviso,
      chuva: fenomeno === "chuva" || (fenomeno === "tempestade" && /chuva|alagamento/.test(texto)),
      vento: fenomeno === "vento" || (fenomeno === "tempestade" && /vento|rajada/.test(texto)),
    };
  });
  const temAvisoChuva = contextosOficiais.some((contexto) => contexto.chuva);
  const temAvisoVento = contextosOficiais.some((contexto) => contexto.vento);
  const temAvisoTempestade = avisosInmet.some((aviso) => fenomenoAvisoInmet(aviso.descricao) === "tempestade");
  const avisoEletrico = avisosInmet.find((aviso) => /raio|trovoada/i.test(aviso.descricao || ""));
  if (avisoEletrico) {
    const grau = grauAvisoInmet(avisoEletrico.severidade) || "ATENÇÃO";
    candidatos.push({
      tipo: "raios",
      grau,
      nivel: NIVEL_POR_GRAU[grau],
      janela: `${avisoEletrico.inicio} até ${avisoEletrico.fim}`,
      fonteDados: "INMET — aviso oficial",
      descricao: "Atividade elétrica indicada em aviso oficial do INMET; consulte o aviso completo abaixo.",
      avisoInmet: avisoEletrico,
      naturezaDado: "Aviso oficial",
      recomendacoes: recomendacoesFenomeno("tempestade", grau),
    });
    avisosCobertos.add(avisoEletrico);
  }

  for (const aviso of avisosInmet) {
    const fenomeno = fenomenoAvisoInmet(aviso.descricao);
    const texto = normalizarComparacao([aviso.descricao, aviso.riscos].flat().filter(Boolean).join(" "));
    const chuva = fenomeno === "chuva" || (fenomeno === "tempestade" && /chuva|alagamento/.test(texto));
    const vento = fenomeno === "vento" || (fenomeno === "tempestade" && /vento|rajada/.test(texto));
    const grau = grauAvisoInmet(aviso.severidade);
    if (!grau || (!chuva && !vento)) continue;
    if (chuva) candidatos.push({
      assinatura: "chuva",
      tipo: grau === "ATENÇÃO" ? "chuvaModerada" : "chuvaIntensa",
      grau,
      nivel: NIVEL_POR_GRAU[grau],
      janela: `${aviso.inicio} até ${aviso.fim}`,
      descricao: aviso.riscos?.join(" ") || `${aviso.descricao} — ${aviso.severidade}.`,
      recomendacoes: recomendacoes("chuva", grau),
      fonteDados: "INMET — aviso oficial",
      avisoInmet: aviso,
      naturezaDado: "Aviso oficial",
    });
    if (vento) candidatos.push({
      assinatura: "vento",
      tipo: grau === "ATENÇÃO" ? "ventoModerado" : "ventoForte",
      grau,
      nivel: NIVEL_POR_GRAU[grau],
      janela: `${aviso.inicio} até ${aviso.fim}`,
      descricao: aviso.riscos?.join(" ") || `${aviso.descricao} — ${aviso.severidade}.`,
      recomendacoes: recomendacoes("vento", grau),
      fonteDados: "INMET — aviso oficial",
      avisoInmet: aviso,
      naturezaDado: "Aviso oficial",
    });
    avisosCobertos.add(aviso);
  }

  const internos = classificarCondicoesMeteorologicas({
    rajadaKmh: rajadaMaxKmh,
    chuvaHorariaMmH: precipitacaoHorariaMaxMm,
    chuvaDiariaMm: precipitacaoTotalMm,
  }).eventos;
  for (const evento of internos) {
    if ((evento.assinatura === "vento" && temAvisoVento)
      || (evento.assinatura === "chuva" && temAvisoChuva)) continue;
    const atencao = evento.grau === "ATENÇÃO";
    const tipo = evento.assinatura === "vento"
      ? (atencao ? "ventoModerado" : "ventoForte")
      : (atencao ? "chuvaModerada" : "chuvaIntensa");
    const fontes = evento.assinatura === "vento"
      ? [fontesPorCampo.rajadaMaxKmh]
      : [fontesPorCampo.precipitacaoHorariaMaxMm, fontesPorCampo.precipitacaoTotalMm];
    candidatos.push({
      ...evento,
      tipo,
      nivel: NIVEL_POR_GRAU[evento.grau],
      janela: janelaDoEvento(periodos, evento.assinatura),
      descricao: evento.detalhe,
      fonteDados: [...new Set(fontes.filter((fonte) => fonte && fonte !== "Indisponível"))].join(" / ")
        || "Previsão meteorológica integrada",
      naturezaDado: "Classificação interna baseada na previsão",
    });
  }

  if (temTempestadeHoje && !temAvisoTempestade) {
    candidatos.push({
      assinatura: "tempestade",
      tipo: "tempestadePrevista",
      grau: "ATENÇÃO",
      nivel: NIVEL_POR_GRAU["ATENÇÃO"],
      janela: "períodos com código meteorológico de tempestade",
      descricao: "A previsão indica condição de tempestade ou trovoada; não há confirmação de descargas elétricas por aviso oficial nesta coleta.",
      fonteDados: fontesPorCampo.temTempestadeHoje || "Previsão meteorológica integrada",
      naturezaDado: "Classificação interna baseada na previsão",
      recomendacoes: recomendacoesFenomeno("tempestade", "ATENÇÃO"),
    });
  }

  if ((Number.isFinite(umidadeMin) && umidadeMin <= LIMIARES.baixaUmidadePct) || textoAvisos(avisosInmet, /baixa umidade/i)) {
    candidatos.push({
      tipo: "baixaUmidade",
      nivel: 1,
      janela: "tarde",
      descricao: Number.isFinite(umidadeMin)
        ? `Umidade relativa mínima baixa prevista (${umidadeMin}%), com atenção à saúde e risco de incêndio.`
        : "Aviso oficial de baixa umidade, com atenção à saúde e risco de incêndio.",
      naturezaDado: textoAvisos(avisosInmet, /baixa umidade/i)
        ? "Aviso oficial"
        : "Classificação interna baseada na previsão",
      recomendacoes: recomendacoesFenomeno("umidade", "ATENÇÃO"),
    });
  }

  // Condições de mar (apenas bases costeiras — `mar` vem nulo nas demais).
  if (!mar?.desatualizado && Number.isFinite(mar?.alturaMaxDiaM)) {
    if (mar.alturaMaxDiaM >= LIMIARES.marGrossoM || textoAvisos(avisosInmet, /ressaca|agitação marítima/i)) {
      candidatos.push({
        tipo: "marGrosso",
        nivel: 4,
        janela:
          mar.periodos?.find((p) => Number.isFinite(p.alturaMaxM) && p.alturaMaxM >= LIMIARES.marGrossoM)?.periodo ||
          "ao longo do dia",
        descricao: `Mar ${mar.estadoMarDia.toLowerCase()} previsto (ondas de até ${mar.alturaMaxDiaM} m), com impacto potencial em operação portuária, transferência de pessoal e uso de heliponto.`,
        naturezaDado: textoAvisos(avisosInmet, /ressaca|agitação marítima/i)
          ? "Aviso oficial"
          : "Classificação interna baseada na previsão",
        recomendacoes: recomendacoesFenomeno("mar", "ALERTA"),
      });
    } else if (mar.alturaMaxDiaM >= LIMIARES.marModeradoM) {
      candidatos.push({
        tipo: "marModerado",
        nivel: 2,
        janela:
          mar.periodos?.find((p) => Number.isFinite(p.alturaMaxM) && p.alturaMaxM >= LIMIARES.marModeradoM)?.periodo ||
          "ao longo do dia",
        descricao: `Mar ${mar.estadoMarDia.toLowerCase()} previsto (ondas de até ${mar.alturaMaxDiaM} m).`,
        naturezaDado: "Classificação interna baseada na previsão",
        recomendacoes: recomendacoesFenomeno("mar", "ATENÇÃO"),
      });
    }
  }

  // Índice UV — risco de queimadura solar para equipes em trabalho externo.
  if (Number.isFinite(qualidadeAr?.uvMax) && qualidadeAr.uvMax >= LIMIARES.uvMuitoAlto) {
    const extremo = qualidadeAr.uvMax >= LIMIARES.uvExtremo;
    const grauUv = grauUvConfigurado(extremo ? "extremo" : "muito_alto");
    candidatos.push({
      tipo: "uvAlto",
      grau: grauUv,
      nivel: NIVEL_POR_GRAU[grauUv],
      janela: qualidadeAr.horaPicoUv ? `pico por volta das ${qualidadeAr.horaPicoUv}` : "meio do dia",
      descricao: `Índice UV ${qualidadeAr.uvClassificacao.nivel.toLowerCase()} previsto (máx. ${qualidadeAr.uvMax}), com risco de queimadura solar em exposição curta sem proteção.`,
      naturezaDado: "Classificação interna baseada na previsão",
      recomendacoes: recomendacoesFenomeno("uv", grauUv),
    });
  }

  // Qualidade do ar — classificação oficial do European AQI calculada pela
  // própria fonte. A concentração de PM2,5 continua visível, mas não é
  // convertida localmente em uma categoria que a OMS não publica.
  if (Number.isFinite(qualidadeAr?.aqiPm25) && qualidadeAr.aqiPm25 > LIMIARES.aqiEuropeuRuim) {
    const grau = qualidadeAr.aqiPm25 > 100
      ? "EMERGÊNCIA"
      : qualidadeAr.aqiPm25 > 80 ? "ALERTA" : "ATENÇÃO";
    candidatos.push({
      tipo: "qualidadeArRuim",
      grau,
      nivel: NIVEL_POR_GRAU[grau],
      janela: "ao longo do dia",
      // Texto para leitor leigo; a concentração em µg/m³ segue na tabela de
      // qualidade do ar do informativo.
      descricao: `Qualidade do ar ${qualidadeAr.pm25Classificacao.nivel.toLowerCase()} prevista: o ar terá mais partículas finas de poluição (como fumaça e poeira), que podem irritar olhos, nariz e garganta e piorar problemas respiratórios. Índice ${qualidadeAr.aqiPm25} — quanto maior, pior; acima de 60 o ar já é considerado ruim.`,
      naturezaDado: "Classificação interna baseada na previsão",
      recomendacoes: recomendacoesFenomeno("ar", grau),
    });
  }

  // aviso oficial do INMET não capturado pelas regras numéricas acima
  // (ex.: nevoeiro denso, ressaca marítima) entra como candidato genérico
  for (const aviso of avisosInmet) {
    if (avisosCobertos.has(aviso)) continue;
    const jaCoberto = candidatos.some((c) =>
      new RegExp(c.tipo, "i").test(aviso.descricao || "")
    );
    if (!jaCoberto) {
      candidatos.push({
        tipo: "avisoInmet",
        // Severidade oficial → nível pelo mapeamento único do projeto
        // ("Perigo Potencial" é ATENÇÃO; antes /perigo/ o elevava a ALERTA).
        nivel: NIVEL_POR_GRAU[grauAvisoInmet(aviso.severidade)] || 2,
        janela: `${aviso.inicio} até ${aviso.fim}`,
        // Texto oficial do próprio aviso — nunca um encaminhamento genérico.
        descricao: aviso.riscos?.length
          ? `${aviso.descricao} — ${aviso.severidade}: ${aviso.riscos.join(" ")}`
          : `${aviso.descricao} — ${aviso.severidade}. Detalhes do aviso indisponíveis na fonte oficial.`,
        avisoInmet: aviso,
        naturezaDado: "Aviso oficial",
      });
    }
  }

  for (const candidato of candidatos) {
    candidato.grau ||= grauPorNivel(candidato.nivel);
    candidato.titulo ||= formatarTitulo(rotuloFenomeno(candidato.tipo), candidato.grau);
    candidato.recomendacoes ||= [];
  }

  candidatos.sort(
    (a, b) => GRAUS[b.grau] - GRAUS[a.grau] || b.nivel - a.nivel
  );
  const eventoMaisRelevante = candidatos[0] || null;
  const categoriasAtivas = new Set(candidatos.map((c) => c.tipo));
  const severidade = {
    grau: eventoMaisRelevante?.grau || "NORMAL",
    vento: { grau: candidatos.filter((c) => c.assinatura === "vento").reduce((g, c) => maiorGrau(g, c.grau), "NORMAL"), rajadaKmh: null, fonte: "INMET" },
    chuva: { grau: candidatos.filter((c) => c.assinatura === "chuva").reduce((g, c) => maiorGrau(g, c.grau), "NORMAL"), intensidadeHorariaMmH: null, acumuladoDiarioMm: null, fonte: "INMET" },
    eventos: candidatos,
  };

  return { eventoMaisRelevante, candidatos, categoriasAtivas, severidade };
}

// ---------------------------------------------------------------------------
// Recomendações — montadas dinamicamente conforme as categorias ativas.
// ---------------------------------------------------------------------------

function recomendacoesDeslocamento(categorias, janelaChuva) {
  const pedestres = [];
  const transporte = [];
  const condutores = [];

  if (categorias.has("chuvaIntensa") || categorias.has("chuvaModerada")) {
    pedestres.push(
      `Utilizar guarda-chuva ou capa de chuva a partir do período da ${janelaChuva || "tarde"}.`,
      "Atenção redobrada ao piso escorregadio em calçadas, escadas e passarelas."
    );
    transporte.push(
      "Prever possíveis atrasos em linhas de ônibus e trens devido à chuva.",
      "Em pontos de ônibus desabrigados, buscar abrigo alternativo em caso de intensificação da chuva.",
      "Consultar aplicativos de mobilidade/trânsito antes de sair."
    );
    condutores.push(
      "Reduzir a velocidade e aumentar a distância de segurança em pistas molhadas.",
      "Manter faróis acesos e redobrar atenção à visibilidade reduzida."
    );
  }

  if (categorias.has("ventoForte") || categorias.has("ventoModerado")) {
    pedestres.push(
      "Evitar permanência ou circulação próxima a árvores de grande porte, tapumes e estruturas soltas durante rajadas."
    );
    condutores.push(
      "Atenção a rajadas de vento que podem causar queda de galhos ou pequenos objetos na via, especialmente em vias arborizadas."
    );
  }

  if (categorias.has("raios")) {
    pedestres.push(
      "Evitar áreas abertas, campos e proximidade de estruturas metálicas altas durante trovoadas.",
      "Buscar abrigo em edificação fechada ao primeiro sinal de raios."
    );
    transporte.push("Evitar permanência prolongada em pontos de ônibus descobertos durante trovoadas.");
    condutores.push("Evitar parar sob árvores ou estruturas altas durante trovoadas; manter-se dentro do veículo.");
  }

  if (categorias.has("calorExtremo") || categorias.has("baixaUmidade")) {
    pedestres.push(
      "Priorizar hidratação e proteção solar, evitando exposição prolongada nos horários mais quentes.",
      "Usar roupas leves em deslocamentos a pé durante a tarde."
    );
    condutores.push(
      "Verificar climatização do veículo e manter água disponível para deslocamentos mais longos."
    );
  }

  if (categorias.has("uvAlto")) {
    pedestres.push(
      "Usar protetor solar FPS 30 ou superior, boné/chapéu e óculos escuros em deslocamentos a pé no meio do dia.",
      "Priorizar sombra e trajetos cobertos entre 10h e 16h, quando o índice UV é mais alto."
    );
    transporte.push("Aguardar em pontos com cobertura sempre que possível, evitando exposição solar direta prolongada.");
  }

  if (categorias.has("qualidadeArRuim")) {
    pedestres.push(
      "Pessoas com asma, rinite ou doenças cardiorrespiratórias devem evitar esforço físico intenso ao ar livre.",
      "Preferir trajetos por vias menos congestionadas, com menor concentração de poluentes."
    );
    condutores.push("Manter janelas fechadas e ar-condicionado em recirculação em vias de tráfego intenso.");
  }

  if (categorias.has("marGrosso") || categorias.has("marModerado")) {
    pedestres.push(
      "Evitar circulação em orlas, molhes, píeres e passeios à beira-mar durante o período de maior agitação marítima."
    );
    condutores.push(
      "Atenção a vias litorâneas sujeitas a invasão de água do mar e areia durante ressaca."
    );
  }

  if (pedestres.length === 0) {
    pedestres.push("Sem risco meteorológico relevante identificado; manter atenção às condições usuais de trânsito e circulação.");
  }
  if (transporte.length === 0) {
    transporte.push("Não há indicativo meteorológico relevante para atrasos ou riscos em transporte público nesta data.");
  }
  if (condutores.length === 0) {
    condutores.push("Sem restrição meteorológica relevante à condução prevista para esta data.");
  }

  return { pedestres, transporte, condutores };
}

function recomendacoesEdificacao(categorias) {
  const secoes = [];

  if (categorias.has("chuvaIntensa") || categorias.has("chuvaModerada")) {
    secoes.push({
      titulo: "Chuva intensa / fraca a moderada",
      itens: [
        "Verificar previamente calhas, ralos e sistema de drenagem pluvial da edificação.",
        "Testar o funcionamento de bombas de drenagem em subsolos e garagens.",
        "Verificar vedação de janelas e portas em áreas expostas, especialmente em andares baixos.",
        "Monitorar sinais de infiltração em subsolos ao longo do dia.",
      ],
    });
  }

  if (categorias.has("ventoForte") || categorias.has("ventoModerado")) {
    secoes.push({
      titulo: "Ventos fortes / moderados",
      itens: [
        "Verificar a fixação de elementos externos leves (toldos, placas, vasos, mobiliário de área externa).",
        "Restringir o uso de heliponto, se existente, durante o período de rajadas mais intensas.",
        "Suspender temporariamente trabalhos em andaimes ou áreas elevadas externas.",
      ],
    });
  }

  if (categorias.has("calorExtremo")) {
    secoes.push({
      titulo: "Calor extremo",
      itens: [
        "Testar previamente o funcionamento do sistema de climatização (HVAC).",
        "Disponibilizar e sinalizar pontos de hidratação para ocupantes e visitantes.",
        "Monitorar equipamentos sensíveis à sobrecarga térmica.",
      ],
    });
  }

  if (categorias.has("raios")) {
    secoes.push({
      titulo: "Raios / tempestade elétrica",
      itens: [
        "Verificar operacionalidade do SPDA (Sistema de Proteção contra Descargas Atmosféricas).",
        "Restringir acesso a áreas externas descobertas durante o período de risco.",
      ],
    });
  }

  if (categorias.has("marGrosso") || categorias.has("marModerado")) {
    secoes.push({
      titulo: "Agitação marítima / operação costeira",
      itens: [
        "Reavaliar janelas de atracação, amarração e transferência de pessoal conforme a altura de onda prevista.",
        "Reforçar amarração de embarcações de apoio e verificar defensas do cais.",
        "Restringir operação de heliponto em plataforma/embarcação durante o pico de agitação.",
        "Verificar estruturas expostas à arrebentação (píeres, passarelas, tomadas de água de resfriamento).",
      ],
    });
  }

  if (categorias.has("uvAlto")) {
    secoes.push({
      titulo: "Índice UV elevado",
      itens: [
        "Disponibilizar protetor solar e reforçar o uso de EPI com proteção solar para equipes em trabalho externo.",
        "Reprogramar, quando possível, atividades externas prolongadas para fora da janela de pico do UV.",
        "Garantir pontos de sombra e hidratação nas frentes de trabalho a céu aberto.",
      ],
    });
  }

  if (categorias.has("qualidadeArRuim")) {
    secoes.push({
      titulo: "Qualidade do ar desfavorável",
      itens: [
        "Verificar e, se necessário, antecipar a troca de filtros do sistema de climatização (HVAC).",
        "Manter tomadas de ar externo reduzidas enquanto o material particulado estiver elevado.",
        "Orientar ocupantes com quadros respiratórios sensíveis sobre a condição do dia.",
      ],
    });
  }

  if (secoes.length === 0) {
    secoes.push({
      titulo: "Boas práticas gerais (ausência de evento extremo caracterizado)",
      itens: [
        "Manter inspeção rotineira de cobertura, calhas e drenagem como medida preventiva geral.",
        "Preservar rotinas normais de operação da edificação, sem necessidade de medidas extraordinárias.",
        "Manter plano de contingência atualizado, mesmo sem alerta severo em vigor.",
      ],
    });
  } else {
    secoes.push({
      titulo: "Boas práticas gerais complementares",
      itens: [
        "Manter comunicação preventiva aos ocupantes sobre a previsão do dia.",
        "Verificar árvores próximas à edificação quanto a galhos secos ou fragilizados.",
        "Manter plano de contingência atualizado.",
      ],
    });
  }

  return secoes;
}

module.exports = { avaliarRiscos, recomendacoesDeslocamento, recomendacoesEdificacao, LIMIARES, grauUvConfigurado };
