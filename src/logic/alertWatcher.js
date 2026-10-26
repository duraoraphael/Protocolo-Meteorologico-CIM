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
const { recomendacoesPorProtocoloEmNiveis } = require("./healthProtection");
const {
  configuracaoConfirmacao,
  decidirReducao,
  registrarHistorico,
  tipoTransicao,
} = require("./motorGatilhos");
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

// O fingerprint da medição identifica o conteúdo atual. O fingerprint da
// transição também incorpora o estado confirmado anterior. Isso é essencial
// para distinguir dois ciclos legítimos iguais, por exemplo:
// NORMAL -> ATENÇÃO -> NORMAL -> ATENÇÃO. Sem o marcador do estado anterior,
// a fila confundiria o segundo agravamento com o primeiro e não enviaria.
function fingerprintTransicao(alerta, anterior, motivo) {
  const material = {
    atual: fingerprintAlerta(alerta),
    assinatura: alerta.assinatura,
    grau: alerta.grau,
    motivo,
    grauAnterior: anterior?.grau || anterior?.gravidade || null,
    estadoAnteriorEm: anterior?.emISO || anterior?.fingerprint || null,
  };
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
      recomendacoesPorNivel: recomendacoesPorProtocoloEmNiveis(calorSaude.nivel.protocolo),
      valorGatilho: { indicador: 'prontidaoCalor', valor: calorSaude.nivel.protocolo, unidade: 'nível P1/P2/P3', natureza: 'prevista' },
      referenciaEm: calorSaude.consultadoEm || calorSaude.dataConsulta || null,
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
    qualidadeArRuim: report.fontesPorCampo?.["ar.usAqi"],
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
      recomendacoesPorNivel: evento.recomendacoesPorNivel,
      ...(evento.valores ? {
        valorGatilho: {
          indicador: assinatura === "vento" ? (evento.baseDado === "observada" ? "rajadaObservada" : "rajadaPrevista") : "chuva",
          valores: evento.valores,
          unidade: evento.unidade,
          natureza: contexto?.origem === "Observação" || evento.baseDado === "observada" ? "observada" : "prevista",
        },
        preventivo: assinatura === "vento" && evento.baseDado !== "observada" && contexto?.origem !== "Observação",
      } : {}),
      referenciaEm: report.geradoEmISO || null,
      assinatura,
    });
  }

  return consolidarPorFenomeno(achados);
}

// Fenômenos do motor de gatilhos cuja REDUÇÃO exige confirmação (histerese).
// Elevações são sempre imediatas; avisos oficiais INMET seguem a vigência oficial.
const GATILHOS_CONFIRMAVEIS = new Set(["chuva", "vento", "calor-ehf"]);
const GRAU_POR_GRAVIDADE = { atencao: "ATENÇÃO", alto: "ALERTA", severo: "EMERGÊNCIA" };

/**
 * Filtra somente transições do último grau enviado por fenômeno.
 *
 * @param {object} [opcoes]
 * @param {Date}   [opcoes.agora]       relógio da verificação
 * @param {object} [opcoes.pendencias]  recebe {chaveEstado: pendência|null}
 *   para persistir a estabilização de reduções ainda não confirmadas
 * @param {object} [opcoes.confirmacao] {leituras, minutos}
 * @param {Function} [opcoes.historico] auditoria de eventos intermediários
 */
function filtrarNovidades(chaveBase, achados, estado, dadosDisponiveis = () => true, opcoes = {}) {
  const agoraData = opcoes.agora || new Date();
  const confirmacao = opcoes.confirmacao || configuracaoConfirmacao();
  const pendencias = opcoes.pendencias || {};
  const auditar = opcoes.historico || (() => {});
  const novos = [];

  // Aplica a histerese; devolve a decisão (confirmar, alvo, pendencia).
  const avaliarReducao = (chave, assinatura, anterior, leitura) => {
    const decisao = decidirReducao(anterior, leitura, agoraData, confirmacao);
    const tinha = anterior.reducaoPendente || null;
    pendencias[chave] = decisao.pendencia;
    if (decisao.pendencia && (!tinha || tinha.leituras !== decisao.pendencia.leituras)) {
      auditar({
        evento: decisao.confirmar ? "reducao_confirmada" : "reducao_aguardando_confirmacao",
        chave, localidade: chaveBase, fenomeno: assinatura,
        grauVigente: anterior.grau, grauAlvo: decisao.pendencia.grauAlvo,
        leituras: decisao.pendencia.leituras, exigidas: confirmacao.leituras,
      });
    }
    return decisao;
  };

  for (const alerta of achados) {
    const chave = `${chaveBase}|${alerta.assinatura}`;
    const anterior = estado[chave];
    const fingerprint = fingerprintAlerta(alerta);

    if (!anterior) {
      const motivo = "novo";
      novos.push({
        ...alerta,
        fingerprint: fingerprintTransicao(alerta, null, motivo),
        conteudoFingerprint: fingerprint,
        chaveEstado: chave,
        motivo,
        transicao: tipoTransicao("NORMAL", alerta.grau),
        ...(alerta.assinatura.startsWith("inmet:") ? { grauAnterior: "NORMAL" } : {}),
      });
      continue;
    }

    const antes = GRAVIDADE[anterior.gravidade] ?? 0;
    const agora = GRAVIDADE[alerta.gravidade] ?? 0;
    const grauAnterior = anterior.grau || GRAU_POR_GRAVIDADE[anterior.gravidade] || "NORMAL";

    if (agora < antes && GATILHOS_CONFIRMAVEIS.has(alerta.assinatura)) {
      const decisao = avaliarReducao(chave, alerta.assinatura, anterior, { grau: alerta.grau, valida: true, alerta });
      if (!decisao.confirmar) continue;
      // Notifica o MAIOR nível visto na janela de estabilização.
      const alvo = decisao.alvo.alertaAlvo && decisao.alvo.grauAlvo !== alerta.grau
        ? decisao.alvo.alertaAlvo : alerta;
      const motivo = "reduziu";
      novos.push({
        ...alvo,
        fingerprint: fingerprintTransicao(alvo, anterior, motivo),
        conteudoFingerprint: fingerprintAlerta(alvo),
        chaveEstado: chave,
        motivo,
        grauAnterior,
        transicao: tipoTransicao(grauAnterior, alvo.grau),
      });
      continue;
    }
    if (agora >= antes && anterior.reducaoPendente) pendencias[chave] = null;

    if (agora !== antes) {
      const motivo = agora > antes ? "agravou" : "reduziu";
      novos.push({
        ...alerta,
        fingerprint: fingerprintTransicao(alerta, anterior, motivo),
        conteudoFingerprint: fingerprint,
        chaveEstado: chave,
        motivo,
        grauAnterior,
        transicao: tipoTransicao(grauAnterior, alerta.grau),
      });
    } else if (alerta.assinatura.startsWith("inmet:") && anterior.fingerprint && anterior.fingerprint !== fingerprint) {
      const motivo = "atualizou";
      novos.push({
        ...alerta,
        fingerprint: fingerprintTransicao(alerta, anterior, motivo),
        conteudoFingerprint: fingerprint,
        chaveEstado: chave,
        motivo,
        grauAnterior: anterior.grau || alerta.grau,
      });
    }
  }

  for (const [chave, anterior] of Object.entries(estado)) {
    if (!chave.startsWith(`${chaveBase}|`) || chave.endsWith(`|${ASSINATURA_MONITOR}`) ||
        achados.some((alerta) => chave === `${chaveBase}|${alerta.assinatura}`)) continue;
    const assinatura = chave.slice(chaveBase.length + 1);
    if (!assinatura.startsWith("inmet:") && anterior.fonteDados === "INMET") continue;
    // Dado indisponível não é dado normal: sem leitura válida, o estado,
    // a pendência e a janela de estabilização permanecem como estão.
    if (!dadosDisponiveis(assinatura) || (GRAVIDADE[anterior.gravidade] ?? 0) === 0) continue;
    const avisoOficial = assinatura.startsWith("inmet:");
    const grauAnterior = anterior.grau || GRAU_POR_GRAVIDADE[anterior.gravidade];

    let residual = null; // alerta de menor nível mantido pela janela de estabilização
    if (GATILHOS_CONFIRMAVEIS.has(assinatura)) {
      const decisao = avaliarReducao(chave, assinatura, anterior, { grau: "NORMAL", valida: true });
      if (!decisao.confirmar) continue;
      if (decisao.alvo.alertaAlvo && decisao.alvo.grauAlvo !== "NORMAL") residual = decisao.alvo.alertaAlvo;
    }
    if (residual) {
      novos.push({
        ...residual,
        fingerprint: fingerprintTransicao(residual, anterior, "reduziu"),
        conteudoFingerprint: fingerprintAlerta(residual),
        chaveEstado: chave,
        motivo: "reduziu",
        grauAnterior,
        transicao: tipoTransicao(grauAnterior, residual.grau),
      });
      continue;
    }
    const normalizacao = {
      chaveEstado: chave,
      assinatura,
      tipo: anterior.tipo || assinatura,
      grau: "NORMAL",
      gravidade: "normal",
      motivo: "normalizou",
      transicao: "normalizacao",
      grauAnterior,
      detalhe: avisoOficial
        ? "O aviso oficial não consta mais entre os avisos ativos do INMET para esta base."
        : `O gatilho de ${anterior.tipo || assinatura} retornou ao nível NORMAL.`,
      janela: avisoOficial ? null : "verificação atual",
      origem: anterior.origem || "Monitor CIM",
      fonteDados: avisoOficial ? "INMET" : anterior.fonteDados || null,
      naturezaDado: avisoOficial ? "Aviso oficial" : anterior.naturezaDado,
      recomendacoes: [],
    };
    novos.push({
      ...normalizacao,
      fingerprint: fingerprintTransicao(normalizacao, anterior, "normalizou"),
      conteudoFingerprint: fingerprintAlerta(normalizacao),
    });
  }
  return novos;
}

function marcarAlertasEnviados(base, { carregar = carregarEstado, salvar = salvarEstado, auditar = carregar === carregarEstado } = {}) {
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
      // O estado compara o conteúdo meteorológico; a fila usa o fingerprint
      // da transição para deduplicar cada episódio separadamente.
      fingerprint: alerta.conteudoFingerprint || fingerprintAlerta(alerta),
      eventoFingerprint: alerta.fingerprint || null,
      transicao: alerta.transicao || null,
      emISO,
    };
    // Trilha de auditoria: somente após o SMTP confirmar a notificação e só
    // para o estado real (armazenamentos injetados são de teste).
    if (auditar) registrarHistorico({
      evento: "notificacao_enviada",
      chave: alerta.chaveEstado,
      localidade: chaveBase,
      fenomeno: alerta.assinatura,
      transicao: alerta.transicao || null,
      motivo: alerta.motivo || null,
      grauAnterior: alerta.grauAnterior || null,
      grau: alerta.grau,
      gatilho: alerta.valorGatilho || null,
      detalhe: alerta.detalhe || null,
      preventivo: Boolean(alerta.preventivo),
      fonte: alerta.fonteDados || null,
      natureza: alerta.naturezaDado || null,
      referenciaEm: alerta.referenciaEm || null,
      janela: alerta.janela || null,
      recomendacoes: alerta.recomendacoes || [],
    });
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
  agora = () => new Date(),
  auditar = carregar === carregarEstado,
} = {}) {
  const estado = ignorarHistorico ? {} : limparExpirados(carregar());
  const agoraVerificacao = agora();
  // Estabilização de reduções ainda não confirmadas, persistida ao final.
  const pendencias = {};
  const registrarEventoHistorico = ignorarHistorico || !auditar ? () => {} : (evento) => registrarHistorico(evento);
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
        // Normalizar chuva exige os dois critérios do protocolo (intensidade
        // horária e acumulado diário): dado ausente não descarta risco.
        if (assinatura === "chuva") return Number.isFinite(report.precipitacaoHorariaMaxMm) && Number.isFinite(report.precipitacaoTotalMm);
        if (assinatura.startsWith("inmet:")) return report.monitoramentoApis?.some((api) => api.id === "inmet-avisos" && api.status === "operacional");
        if (assinatura === "mar") return !report.mar?.desatualizado && Number.isFinite(report.mar?.alturaMaxDiaM);
        if (assinatura === "calor") return Number.isFinite(report.tempMax);
        if (assinatura === "calor-ehf") return report.climaSaude?.status === "operacional" && Boolean(report.climaSaude.dados?.nivel);
        if (assinatura === "uv") return Number.isFinite(report.qualidadeAr?.uvMax);
        if (assinatura === "ar") return Number.isFinite(report.qualidadeAr?.usAqi);
        if (assinatura === "umidade") return Number.isFinite(report.umidadeMin);
        if (assinatura === "tempestade") return typeof report.temTempestadeHoje === "boolean";
        if (assinatura === "raios") return report.monitoramentoApis?.some((api) =>
          api.id === "inmet-avisos" && api.status === "operacional");
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

      const novos = filtrarNovidades(chave, graves, estado, dadosDisponiveis, {
        agora: agoraVerificacao,
        pendencias,
        historico: registrarEventoHistorico,
      });
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
  const chavesPendentes = Object.keys(pendencias);
  if ((estadoAlterado || chavesPendentes.length) && !ignorarHistorico) {
    // Recarrega: marcarAlertasEnviados pode ter gravado durante a verificação.
    const estadoAtual = carregar();
    let alterou = estadoAlterado;
    for (const chave of basesInicializadasAgora) {
      for (const [chaveEstado, valor] of Object.entries(estado)) {
        if (chaveEstado.startsWith(`${chave}|`)) estadoAtual[chaveEstado] = valor;
      }
    }
    for (const chaveEstado of chavesPendentes) {
      const entrada = estadoAtual[chaveEstado];
      if (!entrada) continue;
      // Notificação confirmada durante esta verificação: o estado foi
      // substituído (marcarAlertasEnviados) e a estabilização já foi consumida.
      if (entrada.emISO !== estado[chaveEstado]?.emISO) continue;
      const pendencia = pendencias[chaveEstado];
      if (pendencia) {
        entrada.reducaoPendente = pendencia;
        alterou = true;
      } else if (entrada.reducaoPendente) {
        delete entrada.reducaoPendente;
        alterou = true;
      }
    }
    if (alterou) salvar(estadoAtual);
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
