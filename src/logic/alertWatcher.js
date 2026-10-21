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
// 1. SÓ O QUE EXIGE AÇÃO. Avisos oficiais prevalecem; quando eles não existem,
//    uma previsão confiável pode gerar classificação interna explicitamente
//    identificada, usando os limites documentados do projeto.
//
// 2. SÓ MUDANÇAS. Cada fenômeno tem uma assinatura; o último grau confirmado
//    pelo SMTP fica em data/alertas-notificados.json. Grau inalterado não reenvia.

const fs = require("fs");
const path = require("path");
const crypto = require("node:crypto");
const { CIDADES, getCidade } = require("../config/cities");
const { montarRelatorio } = require("./reportBuilder");
const { avaliarRiscos } = require("./riskEngine");
const { recomendacoes } = require("./inmetAlertRules");
const { contextoPrevisao } = require("./forecastAlertContext");
const { recomendacoesFenomeno } = require("./phenomenonRecommendations");
const {
  consolidarAvisosInmet,
  fenomenoAvisoInmet,
  grauAvisoInmet,
} = require("../sources/inmet");

const ARQUIVO_ESTADO = path.join(__dirname, "..", "..", "data", "alertas-notificados.json");
const ASSINATURA_MONITOR = "__monitor_inicializado__";

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

function fingerprintAlerta(alerta) {
  const oficial = alerta?.naturezaDado === "Aviso oficial" || String(alerta?.assinatura || "").startsWith("inmet:");
  const material = oficial
    ? [
        alerta.assinatura,
        alerta.idAviso,
        alerta.codigoAviso,
        alerta.sequenciaAviso,
        alerta.grau,
        alerta.janela,
        alerta.atualizadoEm,
        alerta.detalhe,
        ...(alerta.instrucoesOficiais || []),
      ]
    : [alerta.assinatura, alerta.grau];
  return crypto.createHash("sha256").update(JSON.stringify(material)).digest("hex");
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

  // EHF é um gatilho próprio de saúde: risco combinado é apenas informativo.
  // Só uma coleta nova pode mudar o estado; cache/erro nunca normalizam calor.
  const calorSaude = report.climaSaude?.status === 'operacional' ? report.climaSaude.dados : null;
  if (calorSaude?.nivel?.protocolo) {
    achados.push({
      origem: 'Clima e Saúde', fonteDados: calorSaude.source,
      tipo: 'Calor / risco à saúde', assinatura: 'calor-ehf',
      grau: calorSaude.nivel.grau, gravidade: calorSaude.nivel.gravidade,
      protocolo: calorSaude.nivel.protocolo,
      detalhe: `EHF ${calorSaude.ehf.classificacao}${calorSaude.ehf.valor == null ? '' : ` (${calorSaude.ehf.valor})`}; risco combinado: ${calorSaude.riscoCombinado ?? 'indisponível'}. ${calorSaude.nivel.significado || ''}`.trim(),
      janela: 'consulta atual', naturezaDado: 'Indicador EHF',
      recomendacoes: calorSaude.recomendacoes,
    });
  }

  // 1. Avisos oficiais do INMET. A assinatura é própria (`inmet:*`) e não
  // colide com os gatilhos numéricos de previsão (`chuva`, `vento`, etc.).
  for (const aviso of consolidarAvisosInmet(report.avisosInmet)) {
    const grau = grauAvisoInmet(aviso.severidade);
    if (!grau) continue;
    const fenomeno = fenomenoAvisoInmet(aviso.descricao);
    const texto = [aviso.descricao, ...(aviso.riscos || [])].join(" ")
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    const protocolos = [];
    if (fenomeno === "chuva" || (fenomeno === "tempestade" && /chuva|alagamento/.test(texto))) protocolos.push("chuva");
    if (fenomeno === "vento" || (fenomeno === "tempestade" && /vento|rajada/.test(texto))) protocolos.push("vento");
    const janela = [aviso.inicio, aviso.fim].filter(Boolean).join(" até ");
    const previsao = contextoPrevisao(report, fenomeno);

    achados.push({
      origem: "INMET",
      tipo: aviso.descricao || "Aviso meteorológico",
      grau,
      gravidade: GRAVIDADE_POR_GRAU[grau],
      severidadeTexto: aviso.severidade,
      detalhe: (aviso.riscos || []).filter(Boolean).join(" "),
      instrucoesOficiais: (aviso.instrucoes || []).filter(Boolean),
      janela: janela || null,
      naturezaDado: "Aviso oficial",
      fonteDados: "INMET",
      orgaoEmissor: "INMET",
      idAviso: aviso.idAviso || null,
      codigoAviso: aviso.id || null,
      sequenciaAviso: aviso.sequencia ?? null,
      atualizadoEm: aviso.atualizadoEm || null,
      previsaoComplementar: previsao?.detalhe || null,
      periodoPrevisao: previsao?.janela || null,
      fontePrevisao: previsao?.fonteDados || null,
      recomendacoes: [...new Set([
        ...protocolos.flatMap((protocolo) => recomendacoes(protocolo, grau)),
        ...(fenomeno === "tempestade" ? recomendacoesFenomeno("tempestade", grau) : []),
      ])],
      assinatura: `inmet:${fenomeno}`,
    });
  }

  const periodos = report.periodos || Object.fromEntries(["manha", "tarde", "noite"].map((chave, indice) => [
    chave,
    { ...(report.ventoPorPeriodo?.[indice] || {}), ...(report.chuvaPorPeriodo?.[indice] || {}) },
  ]));
  const eventos = report.severidade?.eventos || avaliarRiscos({
    ...report,
    periodos,
    fontesPorCampo: report.fontesPorCampo || {},
  }).severidade.eventos;
  const assinaturaPorTipo = {
    baixaUmidade: "umidade",
    marGrosso: "mar",
    marModerado: "mar",
    uvAlto: "uv",
    qualidadeArRuim: "ar",
    tempestadePrevista: "tempestade",
  };
  const tipoExibicao = {
    baixaUmidade: "Baixa umidade",
    marGrosso: "Agitação marítima",
    marModerado: "Condição marítima",
    uvAlto: "Índice UV",
    qualidadeArRuim: "Qualidade do ar",
    tempestadePrevista: "Tempestade",
  };
  const fontePorTipo = {
    baixaUmidade: report.fontesPorCampo?.umidadeMin,
    marGrosso: report.fontesPorCampo?.["mar.alturaMaxDiaM"],
    marModerado: report.fontesPorCampo?.["mar.alturaMaxDiaM"],
    uvAlto: report.fontesPorCampo?.["ar.uvMax"],
    qualidadeArRuim: report.fontesPorCampo?.["ar.aqiPm25"],
    tempestadePrevista: report.fontesPorCampo?.temTempestadeHoje,
  };
  for (const evento of eventos) {
    if (!evento || evento.avisoInmet || evento.naturezaDado === "Aviso oficial") continue;
    const assinatura = evento.assinatura || assinaturaPorTipo[evento.tipo];
    const grau = evento.grau;
    if (!assinatura || !GRAVIDADE_POR_GRAU[grau]) continue;
    const contexto = contextoPrevisao(report, assinatura);
    achados.push({
      origem: contexto?.origem || "Previsão",
      fonteDados: contexto?.fonteDados || evento.fonteDados || fontePorTipo[evento.tipo] || "Dado meteorológico integrado",
      tipo: tipoExibicao[evento.tipo] || evento.tipo,
      grau,
      gravidade: GRAVIDADE_POR_GRAU[grau],
      detalhe: contexto?.detalhe || evento.descricao || evento.detalhe,
      janela: contexto?.janela || evento.janela,
      naturezaDado: contexto?.naturezaDado || evento.naturezaDado || "Classificação interna baseada na previsão",
      recomendacoes: evento.recomendacoes,
      assinatura,
    });
  }

  return consolidarPorFenomeno(achados);
}

/** Filtra somente transições do último grau enviado por fenômeno. */
function filtrarNovidades(chaveBase, achados, estado, dadosDisponiveis = () => true) {
  const novos = [];
  for (const alerta of achados) {
    const chave = `${chaveBase}|${alerta.assinatura}`;
    const anterior = estado[chave];
    const fingerprint = fingerprintAlerta(alerta);

    if (!anterior) {
      novos.push({
        ...alerta,
        fingerprint,
        chaveEstado: chave,
        motivo: "novo",
        ...(alerta.assinatura.startsWith("inmet:") ? { grauAnterior: "NORMAL" } : {}),
      });
      continue;
    }

    const antes = GRAVIDADE[anterior.gravidade] ?? 0;
    const agora = GRAVIDADE[alerta.gravidade] ?? 0;
    if (agora !== antes) {
      novos.push({
        ...alerta,
        fingerprint,
        chaveEstado: chave,
        motivo: agora > antes ? "agravou" : "reduziu",
        grauAnterior: anterior.grau || ({ atencao: "ATENÇÃO", alto: "ALERTA", severo: "EMERGÊNCIA" })[anterior.gravidade],
      });
    } else if (alerta.assinatura.startsWith("inmet:") && anterior.fingerprint && anterior.fingerprint !== fingerprint) {
      novos.push({
        ...alerta,
        fingerprint,
        chaveEstado: chave,
        motivo: "atualizou",
        grauAnterior: anterior.grau || alerta.grau,
      });
    }
  }

  for (const [chave, anterior] of Object.entries(estado)) {
    if (!chave.startsWith(`${chaveBase}|`) || chave.endsWith(`|${ASSINATURA_MONITOR}`) ||
        achados.some((alerta) => chave === `${chaveBase}|${alerta.assinatura}`)) continue;
    const assinatura = chave.slice(chaveBase.length + 1);
    if (!assinatura.startsWith("inmet:") && anterior.fonteDados === "INMET") continue;
    if (!dadosDisponiveis(assinatura) || (GRAVIDADE[anterior.gravidade] ?? 0) === 0) continue;
    const avisoOficial = assinatura.startsWith("inmet:");
    const normalizacao = {
      chaveEstado: chave,
      assinatura,
      tipo: anterior.tipo || assinatura,
      grau: "NORMAL",
      gravidade: "normal",
      motivo: "normalizou",
      grauAnterior: anterior.grau || ({ atencao: "ATENÇÃO", alto: "ALERTA", severo: "EMERGÊNCIA" })[anterior.gravidade],
      detalhe: avisoOficial
        ? "O aviso oficial não consta mais entre os avisos ativos do INMET para esta base."
        : `O gatilho de ${anterior.tipo || assinatura} retornou ao nível NORMAL.`,
      janela: avisoOficial ? null : "verificação atual",
      origem: anterior.origem || "Monitor CIM",
      fonteDados: avisoOficial ? "INMET" : anterior.fonteDados || null,
      naturezaDado: avisoOficial ? "Aviso oficial" : anterior.naturezaDado,
      recomendacoes: [],
    };
    novos.push({ ...normalizacao, fingerprint: fingerprintAlerta(normalizacao) });
  }
  return novos;
}

function marcarAlertasEnviados(base, { carregar = carregarEstado, salvar = salvarEstado } = {}) {
  const estado = carregar();
  const emISO = new Date().toISOString();
  const chaveBase = base.chave || String(base.alertas?.[0]?.chaveEstado || "").split("|")[0];
  for (const alerta of base.alertas) {
    estado[alerta.chaveEstado] = {
      gravidade: alerta.gravidade,
      grau: alerta.grau,
      tipo: alerta.tipo,
      origem: alerta.origem,
      fonteDados: alerta.fonteDados,
      naturezaDado: alerta.naturezaDado,
      janela: alerta.janela,
      fingerprint: alerta.fingerprint || fingerprintAlerta(alerta),
      emISO,
    };
  }
  estado[`${chaveBase}|${ASSINATURA_MONITOR}`] = {
    inicializadoEm: estado[`${chaveBase}|${ASSINATURA_MONITOR}`]?.inicializadoEm || emISO,
    verificadoEm: emISO,
  };
  salvar(estado);
}

function registrarLinhaBase(estado, chaveBase, alertas, emISO = new Date().toISOString()) {
  for (const alerta of alertas) {
    estado[`${chaveBase}|${alerta.assinatura}`] = {
      gravidade: alerta.gravidade,
      grau: alerta.grau,
      tipo: alerta.tipo,
      origem: alerta.origem,
      fonteDados: alerta.fonteDados,
      naturezaDado: alerta.naturezaDado,
      janela: alerta.janela,
      fingerprint: fingerprintAlerta(alerta),
      emISO,
    };
  }
  estado[`${chaveBase}|${ASSINATURA_MONITOR}`] = { inicializadoEm: emISO, verificadoEm: emISO };
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
/**
 * @param {object} [opcoes]
 * @param {boolean} [opcoes.ignorarHistorico=false] trata todos os alertas
 *   ativos como novos (envio de teste). O histórico não é lido nem alterado.
 */
async function verificarAlertas({
  ignorarHistorico = false,
  chaves = basesMonitoradas(),
  montar = montarRelatorio,
  onBase,
  carregar = carregarEstado,
  salvar = salvarEstado,
  inicializarSemEnvio = true,
} = {}) {
  const estado = ignorarHistorico ? {} : limparExpirados(carregar());
  const porBase = [];
  const falhas = [];
  let estadoAlterado = false;
  const basesInicializadasAgora = new Set();

  const verificarBase = async (chave) => {
    const cidade = getCidade(chave);
    try {
      const report = await montar(cidade, { atualizarClimaSaude: true });
      const graves = detectarAlertasGraves(report);
      const dadosDisponiveis = (assinatura) => {
        if (assinatura === "vento") return Number.isFinite(report.rajadaMaxKmh) || Number.isFinite(report.rajadaObservadaMaxKmh);
        if (assinatura === "chuva") return Number.isFinite(report.precipitacaoHorariaMaxMm) || Number.isFinite(report.precipitacaoTotalMm);
        if (assinatura.startsWith("inmet:")) return report.monitoramentoApis?.some((api) => api.id === "inmet-avisos" && api.status === "operacional");
        if (assinatura === "mar") return !report.mar?.desatualizado && Number.isFinite(report.mar?.alturaMaxDiaM);
        if (assinatura === "calor") return Number.isFinite(report.tempMax);
        if (assinatura === "calor-ehf") return report.climaSaude?.status === "operacional" && Boolean(report.climaSaude.dados?.nivel);
        if (assinatura === "uv") return Number.isFinite(report.qualidadeAr?.uvMax);
        if (assinatura === "ar") return Number.isFinite(report.qualidadeAr?.aqiPm25);
        if (assinatura === "umidade") return Number.isFinite(report.umidadeMin);
        if (assinatura === "tempestade") return typeof report.temTempestadeHoje === "boolean";
        if (assinatura === "raios") return report.monitoramentoApis?.some((api) =>
          ["open-meteo", "inmet-avisos"].includes(api.id) && api.status === "operacional");
        return true;
      };

      const inicializada = Boolean(estado[`${chave}|${ASSINATURA_MONITOR}`]);
      if (!ignorarHistorico && inicializarSemEnvio && !inicializada) {
        registrarLinhaBase(estado, chave, graves);
        estadoAlterado = true;
        basesInicializadasAgora.add(chave);
        console.log(`[AGENDADOR] ${cidade.nome}: linha de base registrada; nenhum alerta retroativo enviado.`);
        return;
      }

      const novos = filtrarNovidades(chave, graves, estado, dadosDisponiveis);
      if (!novos.length) {
        console.log(`[AGENDADOR] ${cidade.nome}: gatilhos sem mudança; nenhum alerta enviado.`);
        return;
      }
      const base = { chave, cidade, report, alertas: novos };
      porBase.push(base);
      await onBase?.(base);
    } catch (erro) {
      falhas.push({ chave, nome: cidade.nome, erro: erro.message });
    }
  };

  await Promise.all(chaves.map(verificarBase));
  if (estadoAlterado && !ignorarHistorico) {
    const estadoAtual = carregar();
    for (const chave of basesInicializadasAgora) {
      for (const [chaveEstado, valor] of Object.entries(estado)) {
        if (chaveEstado.startsWith(`${chave}|`)) estadoAtual[chaveEstado] = valor;
      }
    }
    salvar(estadoAtual);
  }

  return {
    porBase,
    totalNovos: porBase.reduce((s, b) => s + b.alertas.length, 0),
    falhas,
    verificadoEm: new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }),
  };
}

async function enviarAlertaCalorDoRelatorio(cidade, report) {
  if (report.climaSaude?.status !== 'operacional') return null;
  const chave = `${cidade.chave}|calor-ehf`;
  const estadoCompleto = carregarEstado();
  const estado = estadoCompleto[chave] ? { [chave]: estadoCompleto[chave] } : {};
  const achados = detectarAlertasGraves(report).filter((a) => a.assinatura === 'calor-ehf');
  const novos = filtrarNovidades(cidade.chave, achados, estado, () => true);
  if (!novos.length) return null;
  const base = { chave: cidade.chave, cidade, report, alertas: novos };
  const { enviarAlertaPorEmail } = require('../email/sendAlert');
  const envio = await enviarAlertaPorEmail(base);
  marcarAlertasEnviados(base);
  return envio;
}

module.exports = {
  verificarAlertas,
  detectarAlertasGraves,
  filtrarNovidades,
  marcarAlertasEnviados,
  carregarEstado,
  salvarEstado,
  ARQUIVO_ESTADO,
  ASSINATURA_MONITOR,
  fingerprintAlerta,
  enviarAlertaCalorDoRelatorio,
};
