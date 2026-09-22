// Motor de regras: converte os dados brutos consolidados (Open-Meteo + INMET)
// em (1) o evento climático mais relevante do dia e (2) as recomendações de
// segurança adaptadas ao cenário — nunca uma lista genérica fixa.
//
// Limiares documentados aqui para poderem ser revisados/calibrados pelo CIM.

const LIMIARES = {
  chuvaIntensaMm: 20,
  chuvaIntensaProb: 70,
  chuvaModeradaMm: 5,
  chuvaModeradaProb: 30,
  ventoForteKmh: 60,
  ventoModeradoKmh: 40,
  calorExtremoC: 37,
  baixaUmidadePct: 20,
  // Índice UV — faixas da OMS: 8+ é "muito alto", 11+ é "extremo".
  uvMuitoAlto: 8,
  uvExtremo: 11,
  // Altura significativa de onda (m) — referência para operação portuária,
  // transferência de pessoal e uso de heliponto em instalações costeiras.
  marGrossoM: 2.5,
  marModeradoM: 1.5,
  // PM2.5 (µg/m³) — acima de 25 já é "moderada/ruim" pela diretriz da OMS.
  pm25RuimUgM3: 25,
};

function textoAvisos(avisos, regex) {
  return avisos.some((a) => regex.test(a.descricao || ""));
}

function primeiraJanela(periodos, testeFn) {
  for (const chave of ["manha", "tarde", "noite"]) {
    const p = periodos[chave];
    if (p && testeFn(p)) return p.periodo;
  }
  return null;
}

function avaliarRiscos(consolidado) {
  const {
    tempMax,
    umidadeMin,
    rajadaMaxKmh,
    probabilidadeChuvaMax,
    precipitacaoTotalMm,
    temTempestadeHoje,
    periodos,
    avisosInmet,
    mar,
    qualidadeAr,
  } = consolidado;

  const candidatos = [];

  if (temTempestadeHoje || textoAvisos(avisosInmet, /raio|tempestade|trovoada/i)) {
    candidatos.push({
      tipo: "raios",
      nivel: 5,
      janela: primeiraJanela(periodos, (p) => p.tempestade) || "ao longo do dia",
      descricao:
        "Possibilidade de tempestade com raios/trovoadas identificada na previsão do período.",
    });
  }

  if (
    precipitacaoTotalMm >= LIMIARES.chuvaIntensaMm ||
    probabilidadeChuvaMax >= LIMIARES.chuvaIntensaProb ||
    textoAvisos(avisosInmet, /chuva intensa|alagamento/i)
  ) {
    candidatos.push({
      tipo: "chuvaIntensa",
      nivel: 4,
      janela:
        primeiraJanela(periodos, (p) => p.probabilidadeChuva >= LIMIARES.chuvaIntensaProb) ||
        "ao longo do dia",
      descricao: `Chuva intensa prevista (probabilidade máxima ${probabilidadeChuvaMax}%, acumulado estimado ${precipitacaoTotalMm} mm), com risco de acúmulo de água e alagamentos pontuais.`,
    });
  } else if (
    precipitacaoTotalMm >= LIMIARES.chuvaModeradaMm ||
    probabilidadeChuvaMax >= LIMIARES.chuvaModeradaProb
  ) {
    candidatos.push({
      tipo: "chuvaModerada",
      nivel: 2,
      janela:
        primeiraJanela(periodos, (p) => p.probabilidadeChuva >= LIMIARES.chuvaModeradaProb) ||
        "ao longo do dia",
      descricao: `Chuva fraca a moderada isolada prevista (probabilidade máxima ${probabilidadeChuvaMax}%, acumulado estimado ${precipitacaoTotalMm} mm).`,
    });
  }

  if (
    rajadaMaxKmh >= LIMIARES.ventoForteKmh ||
    (textoAvisos(avisosInmet, /vento|rajada|ventania/i) &&
      textoAvisos(avisosInmet, /perigo/i))
  ) {
    candidatos.push({
      tipo: "ventoForte",
      nivel: 4,
      janela:
        primeiraJanela(periodos, (p) => p.rajadaMaxKmh >= LIMIARES.ventoForteKmh) ||
        "ao longo do dia",
      descricao: `Rajadas de vento fortes previstas (até ${rajadaMaxKmh} km/h), com risco de queda de galhos e objetos soltos.`,
    });
  } else if (rajadaMaxKmh >= LIMIARES.ventoModeradoKmh) {
    candidatos.push({
      tipo: "ventoModerado",
      nivel: 2,
      janela:
        primeiraJanela(periodos, (p) => p.rajadaMaxKmh >= LIMIARES.ventoModeradoKmh) ||
        "ao longo do dia",
      descricao: `Rajadas de vento moderadas previstas (até ${rajadaMaxKmh} km/h).`,
    });
  }

  if (tempMax >= LIMIARES.calorExtremoC || textoAvisos(avisosInmet, /calor/i)) {
    candidatos.push({
      tipo: "calorExtremo",
      nivel: 3,
      janela: "tarde",
      descricao: `Temperatura máxima elevada prevista (${tempMax}°C), com risco de estresse térmico em atividades externas.`,
    });
  }

  if (umidadeMin <= LIMIARES.baixaUmidadePct || textoAvisos(avisosInmet, /baixa umidade/i)) {
    candidatos.push({
      tipo: "baixaUmidade",
      nivel: 1,
      janela: "tarde",
      descricao: `Umidade relativa mínima baixa prevista (${umidadeMin}%), com atenção à saúde e risco de incêndio.`,
    });
  }

  // Condições de mar (apenas bases costeiras — `mar` vem nulo nas demais).
  if (mar?.alturaMaxDiaM != null) {
    if (mar.alturaMaxDiaM >= LIMIARES.marGrossoM || textoAvisos(avisosInmet, /ressaca|agitação marítima/i)) {
      candidatos.push({
        tipo: "marGrosso",
        nivel: 4,
        janela:
          mar.periodos.find((p) => p.alturaMaxM >= LIMIARES.marGrossoM)?.periodo ||
          "ao longo do dia",
        descricao: `Mar ${mar.estadoMarDia.toLowerCase()} previsto (ondas de até ${mar.alturaMaxDiaM} m), com impacto potencial em operação portuária, transferência de pessoal e uso de heliponto.`,
      });
    } else if (mar.alturaMaxDiaM >= LIMIARES.marModeradoM) {
      candidatos.push({
        tipo: "marModerado",
        nivel: 2,
        janela:
          mar.periodos.find((p) => p.alturaMaxM >= LIMIARES.marModeradoM)?.periodo ||
          "ao longo do dia",
        descricao: `Mar ${mar.estadoMarDia.toLowerCase()} previsto (ondas de até ${mar.alturaMaxDiaM} m).`,
      });
    }
  }

  // Índice UV — risco de queimadura solar para equipes em trabalho externo.
  if (qualidadeAr?.uvMax != null && qualidadeAr.uvMax >= LIMIARES.uvMuitoAlto) {
    const extremo = qualidadeAr.uvMax >= LIMIARES.uvExtremo;
    candidatos.push({
      tipo: "uvAlto",
      nivel: extremo ? 3 : 2,
      janela: qualidadeAr.horaPicoUv ? `pico por volta das ${qualidadeAr.horaPicoUv}` : "meio do dia",
      descricao: `Índice UV ${qualidadeAr.uvClassificacao.nivel.toLowerCase()} previsto (máx. ${qualidadeAr.uvMax}), com risco de queimadura solar em exposição curta sem proteção.`,
    });
  }

  // Qualidade do ar — material particulado fino (respirável).
  if (qualidadeAr?.pm25Medio != null && qualidadeAr.pm25Medio > LIMIARES.pm25RuimUgM3) {
    candidatos.push({
      tipo: "qualidadeArRuim",
      nivel: 2,
      janela: "ao longo do dia",
      descricao: `Qualidade do ar ${qualidadeAr.pm25Classificacao.nivel.toLowerCase()} prevista (PM2,5 médio de ${qualidadeAr.pm25Medio} µg/m³, acima da diretriz da OMS de 15 µg/m³).`,
    });
  }

  // aviso oficial do INMET não capturado pelas regras numéricas acima
  // (ex.: nevoeiro denso, ressaca marítima) entra como candidato genérico
  for (const aviso of avisosInmet) {
    const jaCoberto = candidatos.some((c) =>
      new RegExp(c.tipo, "i").test(aviso.descricao || "")
    );
    if (!jaCoberto) {
      candidatos.push({
        tipo: "avisoInmet",
        nivel: /grande perigo/i.test(aviso.severidade) ? 5 : /perigo/i.test(aviso.severidade) ? 4 : 2,
        janela: `${aviso.inicio} até ${aviso.fim}`,
        descricao: `Aviso oficial INMET ativo: "${aviso.descricao}" (${aviso.severidade}). ${
          (aviso.riscos || [])[0] || ""
        }`,
      });
    }
  }

  candidatos.sort((a, b) => b.nivel - a.nivel);
  const eventoMaisRelevante = candidatos[0] || null;
  const categoriasAtivas = new Set(candidatos.map((c) => c.tipo));

  return { eventoMaisRelevante, candidatos, categoriasAtivas };
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
      "Evitar caminhar próximo a bueiros, sarjetas e pontos de alagamento recorrente.",
      "Atenção redobrada ao piso escorregadio em calçadas, escadas e passarelas."
    );
    transporte.push(
      "Prever possíveis atrasos em linhas de ônibus e trens devido à chuva.",
      "Em pontos de ônibus desabrigados, buscar abrigo alternativo em caso de intensificação da chuva.",
      "Consultar aplicativos de mobilidade/trânsito antes de sair."
    );
    condutores.push(
      "Reduzir a velocidade e aumentar a distância de segurança em pistas molhadas.",
      "Manter faróis acesos e redobrar atenção à visibilidade reduzida.",
      "Evitar rotas com histórico de alagamento recorrente; buscar rotas alternativas."
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

module.exports = { avaliarRiscos, recomendacoesDeslocamento, recomendacoesEdificacao, LIMIARES };
