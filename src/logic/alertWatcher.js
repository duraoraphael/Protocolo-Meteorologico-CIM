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
// 1. SÓ O QUE EXIGE AÇÃO. Chuva intensa e vento entram exclusivamente por
//    aviso oficial do INMET; as demais categorias preservam suas fontes.
//
// 2. SÓ MUDANÇAS. Cada fenômeno tem uma assinatura; o último grau confirmado
//    pelo SMTP fica em data/alertas-notificados.json. Grau inalterado não reenvia.

const fs = require("fs");
const path = require("path");
const { CIDADES, getCidade } = require("../config/cities");
const { montarRelatorio } = require("./reportBuilder");
const { LIMIARES, grauUvConfigurado } = require("./riskEngine");
const { recomendacoes } = require("./inmetAlertRules");
const { recomendacoesProtecao } = require("./healthProtection");
const {
  consolidarAvisosInmet,
  fenomenoAvisoInmet,
  grauAvisoInmet,
} = require("../sources/inmet");

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
      detalhe: `EHF ${calorSaude.ehf.classificacao}${calorSaude.ehf.valor == null ? '' : ` (${calorSaude.ehf.valor})`}; risco combinado: ${calorSaude.riscoCombinado ?? 'indisponível'}.`,
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
      recomendacoes: [...new Set(protocolos.flatMap((protocolo) => recomendacoes(protocolo, grau)))],
      assinatura: `inmet:${fenomeno}`,
    });
  }

  if (!report.mar?.desatualizado && report.mar?.alturaMaxDiaM != null && report.mar.alturaMaxDiaM >= LIMIARES.marGrossoM) {
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
    const grau = grauUvConfigurado("extremo");
    achados.push({
      origem: "Previsão",
      fonteDados: report.fontesPorCampo?.["ar.uvMax"] || "Previsão de UV",
      tipo: "Índice UV extremo",
      grau,
      gravidade: GRAVIDADE_POR_GRAU[grau],
      detalhe: `Índice UV de ${report.qualidadeAr.uvMax}`,
      janela: report.qualidadeAr.horaPicoUv ? `pico ~${report.qualidadeAr.horaPicoUv}` : "meio do dia",
      recomendacoes: recomendacoesProtecao(grau),
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
      novos.push({
        ...a,
        chaveEstado: chave,
        motivo: "novo",
        ...(a.assinatura.startsWith("inmet:") ? { grauAnterior: "NORMAL" } : {}),
      });
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
    // Estados legados de avisos oficiais usavam `chuva`/`vento` e podiam
    // colidir com a previsão. Não inferimos normalização desses registros.
    if (!assinatura.startsWith("inmet:") && anterior.fonteDados === "INMET") continue;
    if (!dadosDisponiveis(assinatura) || (GRAVIDADE[anterior.gravidade] ?? 0) === 0) continue;
    const avisoOficial = assinatura.startsWith("inmet:");
    novos.push({
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
      naturezaDado: alerta.naturezaDado,
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
/**
 * @param {object} [opcoes]
 * @param {boolean} [opcoes.ignorarHistorico=false] trata todos os alertas
 *   ativos como novos (envio de teste). O histórico não é lido nem alterado.
 */
async function verificarAlertas({ ignorarHistorico = false } = {}) {
  const estado = ignorarHistorico ? {} : limparExpirados(carregarEstado());
  const porBase = [];
  const falhas = [];

  for (const chave of basesMonitoradas()) {
    const cidade = getCidade(chave);
    try {
      const report = await montarRelatorio(cidade, { atualizarClimaSaude: true });
      const graves = detectarAlertasGraves(report);
      const dadosDisponiveis = (assinatura) => {
        if (assinatura === "vento") return Number.isFinite(report.rajadaMaxKmh);
        if (assinatura === "chuva") return Number.isFinite(report.precipitacaoHorariaMaxMm) || Number.isFinite(report.precipitacaoTotalMm);
        if (assinatura.startsWith("inmet:")) return report.monitoramentoApis?.some((api) => api.id === "inmet-avisos" && api.status === "operacional");
        if (assinatura === "mar") return !report.mar?.desatualizado && Number.isFinite(report.mar?.alturaMaxDiaM);
        if (assinatura === "calor") return Number.isFinite(report.tempMax);
        if (assinatura === "calor-ehf") return report.climaSaude?.status === 'operacional' && Boolean(report.climaSaude.dados?.nivel);
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
  enviarAlertaCalorDoRelatorio,
};
