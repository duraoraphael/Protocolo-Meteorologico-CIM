// Monitor de vigilância: comunica mudanças de gatilho por base e fenômeno.
//
// Por que existe: o informativo agendado é uma fotografia. Se um aviso de
// tempestade do INMET surgir às 14h, ninguém é notificado — o painel mostra,
// mas só enxerga quem estiver olhando para a TV. Este monitor cobre
// exatamente o item do protocolo original sobre "variações meteorológicas
// extremas que possam acontecer no dia em que não estava previsto".
//
// Duas regras guiam o desenho, ambas para não virar spam (alerta que é
// ignorado não protege ninguém):
//
// 1. SÓ O QUE EXIGE AÇÃO. Chuva intensa e rajadas entram a partir do grau de
//    ATENÇÃO definido nos critérios INMET; as demais categorias preservam os
//    limiares graves já existentes.
//
// 2. SÓ MUDANÇAS. Cada fenômeno tem uma assinatura; o último grau confirmado
//    pelo SMTP fica em data/alertas-notificados.json. Grau inalterado não reenvia.

const fs = require("fs");
const path = require("path");
const { CIDADES, getCidade } = require("../config/cities");
const { montarRelatorio } = require("./reportBuilder");
const { LIMIARES } = require("./riskEngine");
const {
  classificarCondicoesMeteorologicas,
} = require("./inmetAlertRules");

const ARQUIVO_ESTADO = path.join(__dirname, "..", "..", "data", "alertas-notificados.json");

// ---------------------------------------------------------------------------
// Estado (o que já foi avisado)
// ---------------------------------------------------------------------------

function carregarEstado() {
  try {
    const dados = JSON.parse(fs.readFileSync(ARQUIVO_ESTADO, "utf-8"));
    return dados && typeof dados === "object" ? dados : {};
  } catch (erro) {
    if (erro.code === "ENOENT") return {};
    throw new Error(`Estado de alertas ilegível; envio suspenso para evitar duplicidade: ${erro.message}`, { cause: erro });
  }
}

function salvarEstado(estado) {
  fs.mkdirSync(path.dirname(ARQUIVO_ESTADO), { recursive: true });
  const temporario = `${ARQUIVO_ESTADO}.${process.pid}.tmp`;
  fs.writeFileSync(temporario, JSON.stringify(estado, null, 2), "utf-8");
  fs.renameSync(temporario, ARQUIVO_ESTADO);
}

function limparExpirados(estado) {
  // O nível enviado não expira por tempo: persistência do mesmo gatilho não
  // autoriza reenvio após 12 horas. Uma nova transição o substitui.
  return estado;
}

// ---------------------------------------------------------------------------
// Detecção
// ---------------------------------------------------------------------------

// Peso usado para decidir se um alerta "piorou" em relação ao já notificado.
const GRAVIDADE = { atencao: 1, alto: 2, severo: 3 };
const GRAVIDADE_POR_GRAU = {
  "ATENÇÃO": "atencao",
  ALERTA: "alto",
  "EMERGÊNCIA": "severo",
};

function normalizarTexto(t) {
  return (t || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function maximoNumerico(valores) {
  const validos = valores.filter(Number.isFinite);
  return validos.length ? Math.max(...validos) : null;
}

function somaNumerica(valores) {
  const validos = valores.filter(Number.isFinite);
  return validos.length
    ? Math.round(validos.reduce((soma, valor) => soma + valor, 0) * 10) / 10
    : null;
}

function fontesDoDado(report, campos) {
  return [...new Set(
    campos
      .map((campo) => report.fontesPorCampo?.[campo])
      .filter((fonte) => fonte && fonte !== "Indisponível")
  )].join(" / ") || "Fonte numérica indisponível";
}

function consolidarPorFenomeno(achados) {
  const porAssinatura = new Map();
  for (const alerta of achados) {
    const atual = porAssinatura.get(alerta.assinatura);
    if (!atual) {
      porAssinatura.set(alerta.assinatura, alerta);
      continue;
    }
    const nivelAtual = GRAVIDADE[atual.gravidade] ?? 0;
    const nivelNovo = GRAVIDADE[alerta.gravidade] ?? 0;
    if (nivelNovo > nivelAtual || (nivelNovo === nivelAtual && alerta.valores && !atual.valores)) {
      porAssinatura.set(alerta.assinatura, alerta);
    }
  }
  const grauPorGravidade = { atencao: "ATENÇÃO", alto: "ALERTA", severo: "EMERGÊNCIA" };
  return [...porAssinatura.values()].map((alerta) => ({
    ...alerta,
    grau: alerta.grau || grauPorGravidade[alerta.gravidade],
  }));
}

/**
 * Extrai de um relatório apenas as condições graves o bastante para
 * interromper alguém fora do horário do informativo.
 */
function detectarAlertasGraves(report) {
  const achados = [];

  // 1. Avisos oficiais do INMET. São a fonte mais forte: já vêm classificados
  // por autoridade competente. "Potencial" fica de fora — é previsão de
  // possibilidade, não de evento em curso.
  for (const aviso of report.avisosInmet || []) {
    const sev = normalizarTexto(aviso.severidade);
    const ehGrandePerigo = sev.includes("grande perigo");
    const ehPerigo = sev.includes("perigo") && !sev.includes("potencial");
    if (!ehGrandePerigo && !ehPerigo) continue;

    const descricaoNormalizada = normalizarTexto(aviso.descricao);
    const fenomeno = /chuva|alagamento/.test(descricaoNormalizada)
      ? "chuva"
      : /vento|rajada|ventania/.test(descricaoNormalizada)
        ? "vento"
        : null;
    const grau = ehGrandePerigo ? "EMERGÊNCIA" : "ALERTA";

    achados.push({
      origem: "INMET",
      tipo: fenomeno === "chuva" ? "Chuva intensa" : fenomeno === "vento" ? "Vento" : aviso.descricao || "Aviso meteorológico",
      grau,
      gravidade: GRAVIDADE_POR_GRAU[grau],
      severidadeTexto: aviso.severidade,
      detalhe: (aviso.riscos || []).filter(Boolean).join(" "),
      janela: `${aviso.inicio} até ${aviso.fim}`,
      naturezaDado: "Aviso oficial",
      fonteDados: "INMET",
      recomendacoes: fenomeno ? recomendacoes(fenomeno, grau) : [],
      // A assinatura ignora acentuação/caixa para que o mesmo aviso reemitido
      // com grafia levemente diferente não vire alerta novo.
      assinatura: fenomeno || `inmet:${descricaoNormalizada}`,
    });
  }

  // 2. Tempestade com raios detectada na previsão horária.
  if (report.eventoMaisRelevante?.tipo === "raios") {
    achados.push({
      origem: "Previsão",
      fonteDados: report.eventoMaisRelevante.fonteDados || "Previsão meteorológica",
      tipo: "Tempestade com raios",
      gravidade: "severo",
      detalhe: report.eventoMaisRelevante.descricao,
      janela: report.eventoMaisRelevante.janela,
      assinatura: "raios",
    });
  }

  // 3. Chuva intensa e rajada: critérios INMET centralizados. Os valores são
  // previsões numéricas e mantêm a fonte real registrada no relatório.
  const rajada = Number.isFinite(report.rajadaMaxKmh)
    ? report.rajadaMaxKmh
    : maximoNumerico((report.ventoPorPeriodo || []).map((p) => p.rajadaMaxKmh));
  const chuva = report.chuvaPorPeriodo || [];
  const intensidadeHoraria = Number.isFinite(report.precipitacaoHorariaMaxMm)
    ? report.precipitacaoHorariaMaxMm
    : maximoNumerico(chuva.map((p) => p.precipitacaoHorariaMaxMm));
  const acumulado = Number.isFinite(report.precipitacaoTotalMm)
    ? report.precipitacaoTotalMm
    : somaNumerica(chuva.map((p) => p.precipitacaoMm));

  const eventosProtocolo = classificarCondicoesMeteorologicas({
    rajadaKmh: rajada,
    chuvaHorariaMmH: intensidadeHoraria,
    chuvaDiariaMm: acumulado,
  }).eventos;

  for (const evento of eventosProtocolo) {
    const chuvaIntensa = evento.assinatura === "chuva";
    const periodo = chuvaIntensa
      ? chuva.find((p) => p.precipitacaoHorariaMaxMm === intensidadeHoraria)?.periodo
      : (report.ventoPorPeriodo || []).find((p) => p.rajadaMaxKmh === rajada)?.periodo;
    achados.push({
      origem: "INMET",
      fonteDados: fontesDoDado(
        report,
        chuvaIntensa
          ? ["precipitacaoHorariaMaxMm", "precipitacaoTotalMm"]
          : ["rajadaMaxKmh"]
      ),
      naturezaDado: "Previsão",
      tipo: evento.tipo,
      grau: evento.grau,
      gravidade: GRAVIDADE_POR_GRAU[evento.grau],
      detalhe: evento.detalhe,
      valores: evento.valores,
      unidade: evento.unidade,
      janela: periodo || (chuvaIntensa ? "restante do dia" : "próximas horas"),
      recomendacoes: evento.recomendacoes,
      assinatura: evento.assinatura,
    });
  }

  if (report.mar?.alturaMaxDiaM != null && report.mar.alturaMaxDiaM >= LIMIARES.marGrossoM) {
    achados.push({
      origem: "Previsão",
      fonteDados: report.fontesPorCampo?.["mar.alturaMaxDiaM"] || "Previsão marítima",
      tipo: "Mar grosso",
      gravidade: "alto",
      detalhe: `Ondas de até ${report.mar.alturaMaxDiaM} m (${report.mar.estadoMarDia})`,
      janela: "próximas horas",
      assinatura: "mar",
    });
  }

  if (report.tempMax != null && report.tempMax >= LIMIARES.calorExtremoC) {
    achados.push({
      origem: "Previsão",
      fonteDados: report.fontesPorCampo?.tempMax || "Previsão meteorológica",
      tipo: "Calor extremo",
      gravidade: "alto",
      detalhe: `Máxima prevista de ${report.tempMax}°C`,
      janela: "tarde",
      assinatura: "calor",
    });
  }

  if (report.qualidadeAr?.uvMax != null && report.qualidadeAr.uvMax >= LIMIARES.uvExtremo) {
    achados.push({
      origem: "Previsão",
      fonteDados: report.fontesPorCampo?.["ar.uvMax"] || "Previsão de UV",
      tipo: "Índice UV extremo",
      gravidade: "alto",
      detalhe: `Índice UV de ${report.qualidadeAr.uvMax}`,
      janela: report.qualidadeAr.horaPicoUv ? `pico ~${report.qualidadeAr.horaPicoUv}` : "meio do dia",
      assinatura: "uv",
    });
  }

  return consolidarPorFenomeno(achados);
}

/** Filtra somente transições do último grau enviado por fenômeno. */
function filtrarNovidades(chaveBase, achados, estado, dadosDisponiveis = () => true) {
  const novos = [];
  for (const a of achados) {
    const chave = `${chaveBase}|${a.assinatura}`;
    const jaAvisado = estado[chave];

    if (!jaAvisado) {
      novos.push({ ...a, chaveEstado: chave, motivo: "novo" });
      continue;
    }

    const antes = GRAVIDADE[jaAvisado.gravidade] ?? 0;
    const agora = GRAVIDADE[a.gravidade] ?? 0;
    if (agora !== antes) {
      novos.push({ ...a, chaveEstado: chave, motivo: agora > antes ? "agravou" : "reduziu", grauAnterior: jaAvisado.grau || ({ atencao: "ATENÇÃO", alto: "ALERTA", severo: "EMERGÊNCIA" })[jaAvisado.gravidade] });
    }
  }
  for (const [chave, anterior] of Object.entries(estado)) {
    if (!chave.startsWith(`${chaveBase}|`) || achados.some((a) => chave === `${chaveBase}|${a.assinatura}`)) continue;
    const assinatura = chave.slice(chaveBase.length + 1);
    if (!dadosDisponiveis(assinatura) || (GRAVIDADE[anterior.gravidade] ?? 0) === 0) continue;
    novos.push({
      chaveEstado: chave,
      assinatura,
      tipo: anterior.tipo || assinatura,
      grau: "NORMAL",
      gravidade: "normal",
      motivo: "normalizou",
      grauAnterior: anterior.grau || ({ atencao: "ATENÇÃO", alto: "ALERTA", severo: "EMERGÊNCIA" })[anterior.gravidade],
      detalhe: `O gatilho de ${anterior.tipo || assinatura} retornou ao nível NORMAL.`,
      janela: "verificação atual",
      origem: anterior.origem || "Monitor CIM",
      fonteDados: anterior.fonteDados || null,
      recomendacoes: [],
    });
  }
  return novos;
}

function marcarAlertasEnviados(base, { carregar = carregarEstado, salvar = salvarEstado } = {}) {
  const estado = carregar();
  const emISO = new Date().toISOString();
  for (const alerta of base.alertas) {
    estado[alerta.chaveEstado] = {
      gravidade: alerta.gravidade,
      grau: alerta.grau,
      tipo: alerta.tipo,
      origem: alerta.origem,
      fonteDados: alerta.fonteDados,
      janela: alerta.janela,
      emISO,
    };
  }
  salvar(estado);
}

// ---------------------------------------------------------------------------
// Verificação
// ---------------------------------------------------------------------------

function basesMonitoradas() {
  const restricao = process.env.BASES_MONITOR_ALERTAS;
  if (!restricao) return Object.keys(CIDADES);
  return restricao
    .split(",")
    .map((c) => c.trim())
    .filter((chave) => {
      if (!CIDADES[chave]) {
        console.warn(`[CIM] BASES_MONITOR_ALERTAS cita base desconhecida "${chave}" — ignorada.`);
        return false;
      }
      return true;
    });
}

/**
 * Verifica todas as bases monitoradas e devolve os alertas novos.
 *
 * @returns {Promise<{porBase: Array, totalNovos: number, falhas: Array}>}
 */
async function verificarAlertas() {
  const estado = limparExpirados(carregarEstado());
  const porBase = [];
  const falhas = [];

  for (const chave of basesMonitoradas()) {
    const cidade = getCidade(chave);
    try {
      const report = await montarRelatorio(cidade);
      const graves = detectarAlertasGraves(report);
      const dadosDisponiveis = (assinatura) => {
        if (assinatura === "vento") return Number.isFinite(report.rajadaMaxKmh);
        if (assinatura === "chuva") return Number.isFinite(report.precipitacaoHorariaMaxMm) || Number.isFinite(report.precipitacaoTotalMm);
        if (assinatura.startsWith("inmet:")) return report.monitoramentoApis?.some((api) => api.id === "inmet-avisos" && api.status === "operacional");
        if (assinatura === "mar") return Number.isFinite(report.mar?.alturaMaxDiaM);
        if (assinatura === "calor") return Number.isFinite(report.tempMax);
        if (assinatura === "uv") return Number.isFinite(report.qualidadeAr?.uvMax);
        if (assinatura === "raios") return report.monitoramentoApis?.some((api) =>
          ["open-meteo", "windy-weather", "inmet-avisos"].includes(api.id) && api.status === "operacional");
        return true;
      };
      const novos = filtrarNovidades(chave, graves, estado, dadosDisponiveis);

      if (novos.length) {
        porBase.push({ chave, cidade, report, alertas: novos });
      } else {
        console.log(`[AGENDADOR] ${cidade.nome}: gatilhos sem mudança; nenhum alerta enviado.`);
      }
    } catch (erro) {
      falhas.push({ chave, nome: cidade.nome, erro: erro.message });
    }
  }

  return {
    porBase,
    totalNovos: porBase.reduce((s, b) => s + b.alertas.length, 0),
    falhas,
    verificadoEm: new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }),
  };
}

module.exports = {
  verificarAlertas,
  detectarAlertasGraves,
  filtrarNovidades,
  marcarAlertasEnviados,
  carregarEstado,
  salvarEstado,
  ARQUIVO_ESTADO,
};
