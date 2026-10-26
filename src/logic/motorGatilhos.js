// Motor de gatilhos meteorológicos do CIM (chuva intensa, vento forte, calor).
//
// Funções puras, sem rede nem relógio implícito, para que o mesmo código seja
// usado pelo monitor, pelos relatórios e pelos testes:
//
//   1. avaliarChuva / avaliarVento / avaliarCalor  -> severidade de UM fenômeno
//      a partir de indicadores normalizados e validados (valor, unidade,
//      fonte, horário de referência, natureza observada/prevista);
//   2. avaliarLocalidade                           -> fenômenos independentes
//      + severidade geral (maior nível), sem espalhar a EMERGÊNCIA de um
//      fenômeno para os demais;
//   3. tipoTransicao / decidirReducao              -> o que mudou e se a
//      redução de severidade já está confirmada (histerese);
//   4. registrarHistorico                          -> trilha de auditoria.
//
// Os limites e as recomendações vivem em inmetAlertRules.js (chuva/vento) e
// healthProtection.js (calor); aqui não há números meteorológicos novos.
// Os gatilhos apenas geram alertas e recomendações: paralisações e
// evacuações dependem dos procedimentos locais e do PRE.

const fs = require("node:fs");
const path = require("node:path");
const {
  GRAUS,
  LIMITES_ALERTA_INMET,
  classificarChuvaHoraria,
  classificarChuvaDiaria,
  classificarRajada,
  maiorGrau,
  recomendacoes,
} = require("./inmetAlertRules");
const { recomendacoesPorProtocolo } = require("./healthProtection");
const {
  NIVEIS_ACUMULAVEIS,
  acumularRecomendacoesPorNivel,
} = require("./recomendacoesCumulativas");
const { RECOMENDACOES: RECOMENDACOES_CHUVA_VENTO } = require("./inmetAlertRules");
const { RECOMENDACOES_POR_PROTOCOLO } = require("./healthProtection");

const ARQUIVO_HISTORICO = path.join(__dirname, "..", "..", "data", "gatilhos-historico.jsonl");

const FENOMENOS = Object.freeze(["chuva", "vento", "calor"]);
const ROTULOS = Object.freeze({ chuva: "CHUVA INTENSA", vento: "VENTOS FORTES", calor: "CALOR EXTREMO" });
const COR_POR_GRAU = Object.freeze({
  NORMAL: "verde",
  "ATENÇÃO": "amarelo",
  ALERTA: "laranja",
  "EMERGÊNCIA": "vermelho",
});

// Calor: P1/P2/P3 vêm da fonte (EHF do Clima e Saúde); o motor só traduz.
const GRAU_POR_PROTOCOLO = Object.freeze({ P1: "ATENÇÃO", P2: "ALERTA", P3: "EMERGÊNCIA" });
const ROTULO_PROTOCOLO = Object.freeze({ P1: "P1 — BAIXO", P2: "P2 — SEVERO", P3: "P3 — EXTREMO" });

const CONFIG_CALOR = Object.freeze({
  calor: Object.freeze({
    "ATENÇÃO": RECOMENDACOES_POR_PROTOCOLO.P1,
    ALERTA: RECOMENDACOES_POR_PROTOCOLO.P2,
    "EMERGÊNCIA": RECOMENDACOES_POR_PROTOCOLO.P3,
  }),
});

// ---------------------------------------------------------------------------
// Validação de indicadores
// ---------------------------------------------------------------------------

const UNIDADES_ACEITAS = Object.freeze({
  "mm/h": ["mm/h"],
  mm: ["mm", "mm/dia"],
  "km/h": ["km/h"],
});

/**
 * Indicador normalizado:
 *   { valor, unidade, fonte, referenciaEm, natureza: "observada"|"prevista" }
 * Inválido (nunca zero/NORMAL): sem número finito, negativo, unidade diferente
 * da esperada, sem fonte ou sem horário de referência interpretável.
 */
function validarIndicador(indicador, unidadeEsperada) {
  if (!indicador || typeof indicador !== "object") return { valido: false, motivo: "indicador ausente" };
  if (typeof indicador.valor === "string" && indicador.valor.trim() === "") return { valido: false, motivo: "valor ausente" };
  const valor = indicador.valor === null || indicador.valor === undefined ? NaN : Number(indicador.valor);
  if (!Number.isFinite(valor)) return { valido: false, motivo: "valor ausente ou não numérico" };
  if (valor < 0) return { valido: false, motivo: "valor negativo" };
  const unidade = String(indicador.unidade || "").trim().toLowerCase();
  if (!(UNIDADES_ACEITAS[unidadeEsperada] || [unidadeEsperada]).includes(unidade)) {
    return { valido: false, motivo: `unidade "${indicador.unidade ?? "ausente"}" incompatível (esperado ${unidadeEsperada})` };
  }
  if (!String(indicador.fonte || "").trim() || /^indispon[ií]vel$/i.test(String(indicador.fonte).trim())) {
    return { valido: false, motivo: "fonte não identificada" };
  }
  if (!indicador.referenciaEm || Number.isNaN(new Date(indicador.referenciaEm).getTime())) {
    return { valido: false, motivo: "horário de referência ausente ou inválido" };
  }
  if (!["observada", "prevista"].includes(indicador.natureza)) {
    return { valido: false, motivo: "natureza (observada/prevista) não informada" };
  }
  return { valido: true, valor };
}

function descreverIndicador(id, rotulo, indicador, unidade, classificador) {
  const validacao = validarIndicador(indicador, unidade);
  if (!validacao.valido) {
    return { id, rotulo, unidade, status: "indisponivel", grau: null, motivo: validacao.motivo };
  }
  return {
    id,
    rotulo,
    unidade,
    status: "valido",
    valor: validacao.valor,
    grau: classificador(validacao.valor),
    natureza: indicador.natureza,
    fonte: indicador.fonte,
    referenciaEm: indicador.referenciaEm,
  };
}

function resultado(fenomeno, indicadores, { grau, status, motivo, recomendacoesGrau, configuracao, extra = {} }) {
  const gatilho = grau && grau !== "NORMAL"
    ? indicadores.filter((i) => i.status === "valido" && i.grau === grau)[0] || null
    : null;
  return {
    fenomeno,
    rotulo: ROTULOS[fenomeno],
    status, // "avaliado" | "indeterminado" | "indisponivel"
    grau, // null quando não é possível classificar com segurança
    cor: grau ? COR_POR_GRAU[grau] : null,
    motivo,
    indicadores,
    gatilho: gatilho && {
      indicador: gatilho.id,
      rotulo: gatilho.rotulo,
      valor: gatilho.valor,
      unidade: gatilho.unidade,
      natureza: gatilho.natureza,
      fonte: gatilho.fonte,
      referenciaEm: gatilho.referenciaEm,
    },
    // "Preventivo" = gatilho acionado por previsão (chuva/vento); o P1/P2/P3
    // do calor é um nível oficial da fonte, não um alerta preventivo do CIM.
    preventivo: fenomeno !== "calor" && Boolean(gatilho && gatilho.natureza === "prevista"),
    recomendacoes: grau ? recomendacoesGrau : [],
    recomendacoesPorNivel: grau ? acumularRecomendacoesPorNivel(configuracao.fenomeno, grau, configuracao.mapa) : [],
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// Fenômenos
// ---------------------------------------------------------------------------

/**
 * Chuva: a intensidade horária e o acumulado diário são critérios distintos
 * do protocolo. A severidade final é o MAIOR nível (nunca a média). Um nível
 * confirmado vale mesmo com o outro indicador ausente, mas NORMAL exige os
 * dois indicadores válidos — dado ausente não descarta uma condição crítica.
 */
function avaliarChuva({ horaria, diaria } = {}) {
  const indicadores = [
    descreverIndicador("chuvaHoraria", "Intensidade horária", horaria, "mm/h", classificarChuvaHoraria),
    descreverIndicador("chuvaDiaria", "Acumulado diário", diaria, "mm", classificarChuvaDiaria),
  ];
  return classificarIndicadores("chuva", indicadores, { exigirTodosParaNormal: true });
}

/**
 * Vento: rajada observada (medição local, base do protocolo) e rajada prevista
 * (alerta preventivo) ficam separadas. Uma previsão não vira medição, e a
 * ausência de medição não zera um alerta preventivo. São fontes alternativas
 * do MESMO critério; basta uma válida para declarar NORMAL.
 */
function avaliarVento({ observada, prevista } = {}) {
  const indicadores = [
    descreverIndicador("rajadaObservada", "Rajada observada", observada && { ...observada, natureza: "observada" }, "km/h", classificarRajada),
    descreverIndicador("rajadaPrevista", "Rajada prevista", prevista && { ...prevista, natureza: "prevista" }, "km/h", classificarRajada),
  ];
  return classificarIndicadores("vento", indicadores, { exigirTodosParaNormal: false });
}

function classificarIndicadores(fenomeno, indicadores, { exigirTodosParaNormal }) {
  const validos = indicadores.filter((i) => i.status === "valido");
  const configuracao = { fenomeno, mapa: RECOMENDACOES_CHUVA_VENTO };
  if (!validos.length) {
    return resultado(fenomeno, indicadores, {
      grau: null, status: "indisponivel", configuracao,
      motivo: `Nenhum indicador válido de ${fenomeno}; severidade não classificada.`,
    });
  }
  const grau = maiorGrau(...validos.map((i) => i.grau));
  const faltando = indicadores.filter((i) => i.status !== "valido");
  if (grau === "NORMAL" && exigirTodosParaNormal && faltando.length) {
    return resultado(fenomeno, indicadores, {
      grau: null, status: "indeterminado", configuracao,
      motivo: `Sem dado válido de ${faltando.map((i) => i.rotulo.toLowerCase()).join(", ")}; NORMAL não pode ser declarado.`,
    });
  }
  // Em empate, a medição observada (base do protocolo) é a referência citada.
  const empatados = validos.filter((i) => i.grau === grau);
  const principal = empatados.find((i) => i.natureza === "observada") || empatados[0];
  return resultado(fenomeno, indicadores, {
    grau, status: "avaliado", configuracao,
    recomendacoesGrau: recomendacoes(fenomeno, grau),
    motivo: grau === "NORMAL"
      ? "Indicadores válidos abaixo dos limites de ATENÇÃO."
      : `${principal.rotulo} ${principal.valor} ${principal.unidade} (${principal.natureza}) atingiu ${grau}.`,
  });
}

/**
 * Calor: usa exclusivamente o P1/P2/P3 entregue pela integração Clima e Saúde.
 * Só uma coleta operacional vale; cache, falha ou nível desconhecido tornam o
 * indicador indisponível (nunca NORMAL).
 *
 * @param {{status:string, protocolo?:string|null, classificacao?:string, fonte?:string, referenciaEm?:string}} entrada
 *   protocolo === null com status "operacional" significa "sem excesso" (NORMAL).
 */
function avaliarCalor(entrada) {
  const configuracao = { fenomeno: "calor", mapa: CONFIG_CALOR };
  const base = { id: "prontidaoCalor", rotulo: "Nível de prontidão", unidade: "nível de prontidão" };
  const operacional = entrada?.status === "operacional";
  const fonte = String(entrada?.fonte || "").trim();
  const referenciaOk = entrada?.referenciaEm && !Number.isNaN(new Date(entrada.referenciaEm).getTime());
  if (!operacional || !fonte || !referenciaOk) {
    const motivo = !operacional
      ? `Fonte de calor sem coleta atual (${entrada?.status || "ausente"}).`
      : "Fonte ou horário de referência do nível de calor ausente.";
    return resultado("calor", [{ ...base, status: "indisponivel", grau: null, motivo }], {
      grau: null, status: "indisponivel", configuracao,
      motivo: `${motivo} Nível P não disponível; não tratado como NORMAL.`,
    });
  }
  const protocolo = entrada.protocolo || null;
  if (protocolo && !GRAU_POR_PROTOCOLO[protocolo]) {
    return resultado("calor", [{ ...base, status: "indisponivel", grau: null, motivo: `nível "${protocolo}" desconhecido` }], {
      grau: null, status: "indisponivel", configuracao,
      motivo: `Nível de prontidão "${protocolo}" não reconhecido; não tratado como NORMAL.`,
    });
  }
  const grau = protocolo ? GRAU_POR_PROTOCOLO[protocolo] : "NORMAL";
  const indicador = {
    ...base, status: "valido", valor: protocolo ? ROTULO_PROTOCOLO[protocolo] : "Sem excesso", grau,
    natureza: "prevista", fonte, referenciaEm: entrada.referenciaEm,
  };
  return resultado("calor", [indicador], {
    grau, status: "avaliado", configuracao,
    recomendacoesGrau: protocolo ? recomendacoesPorProtocolo(protocolo) : [],
    motivo: protocolo ? `Prontidão ${ROTULO_PROTOCOLO[protocolo]} informada por ${fonte}.` : "Sem excesso de calor na coleta atual.",
    extra: { protocolo },
  });
}

/**
 * Cada fenômeno é avaliado sozinho; a severidade geral é apenas o maior nível
 * entre os fenômenos classificados. Fenômeno sem classificação não rebaixa os
 * demais e não é tratado como NORMAL.
 */
function avaliarLocalidade({ localidade, chuva, vento, calor } = {}) {
  const fenomenos = {
    chuva: avaliarChuva(chuva),
    vento: avaliarVento(vento),
    calor: avaliarCalor(calor),
  };
  const classificados = Object.values(fenomenos).filter((f) => f.grau);
  const severidadeGeral = classificados.length ? maiorGrau(...classificados.map((f) => f.grau)) : null;
  return {
    localidade: localidade || null,
    severidadeGeral,
    cor: severidadeGeral ? COR_POR_GRAU[severidadeGeral] : null,
    completa: classificados.length === FENOMENOS.length,
    fenomenos,
    recomendacoesPorFenomeno: Object.fromEntries(
      Object.entries(fenomenos).map(([chave, f]) => [chave, f.recomendacoes])
    ),
  };
}

// ---------------------------------------------------------------------------
// Transições
// ---------------------------------------------------------------------------

/** Classifica a mudança anterior -> atual (graus em texto, NORMAL incluído). */
function tipoTransicao(anterior, atual) {
  const de = GRAUS[anterior ?? "NORMAL"];
  const para = GRAUS[atual ?? "NORMAL"];
  if (de === undefined || para === undefined || de === para) return null;
  if (para > de) {
    if (de === GRAUS.NORMAL) return para === GRAUS["EMERGÊNCIA"] ? "critico" : "inicio";
    return "agravamento";
  }
  return para === GRAUS.NORMAL ? "normalizacao" : "reducao";
}

const ROTULO_TRANSICAO = Object.freeze({
  inicio: "Início do evento",
  critico: "Evento crítico imediato",
  agravamento: "Agravamento",
  reducao: "Redução de severidade",
  normalizacao: "Normalização",
});

function configuracaoConfirmacao(env = process.env) {
  const inteiro = (valor, padrao) => {
    const n = Number.parseInt(valor, 10);
    return Number.isInteger(n) && n >= 1 ? n : padrao;
  };
  const minutos = Number.parseInt(env.GATILHOS_MINUTOS_ESTABILIZACAO, 10);
  return {
    // Leituras válidas consecutivas abaixo do nível confirmado.
    leituras: inteiro(env.GATILHOS_CONFIRMACOES_REDUCAO, 3),
    // Tempo mínimo entre a primeira e a última leitura da estabilização.
    minutos: Number.isFinite(minutos) && minutos >= 0 ? minutos : 15,
  };
}

/**
 * Histerese: uma elevação é imediata; uma redução só é confirmada após N
 * leituras válidas consecutivas abaixo do nível vigente durante um mínimo de
 * minutos. O nível de destino é o MAIOR visto na janela (evita saltos para
 * NORMAL por uma única leitura boa). Leitura sem dado válido não conta nem
 * zera a janela.
 *
 * @param {{grau:string, reducaoPendente?:object}} vigente  estado confirmado
 * @param {{grau:string, valida:boolean, alerta?:object}} leitura
 * @returns {{confirmar:boolean, alvo?:object, pendencia:object|null}}
 */
function decidirReducao(vigente, leitura, agora, config = configuracaoConfirmacao()) {
  const pendente = vigente?.reducaoPendente || null;
  if (!leitura?.valida) return { confirmar: false, pendencia: pendente };
  const nivelVigente = GRAUS[vigente?.grau ?? "NORMAL"] ?? 0;
  const nivelLeitura = GRAUS[leitura.grau ?? "NORMAL"];
  if (nivelLeitura >= nivelVigente) return { confirmar: false, pendencia: null };

  const instante = new Date(agora).toISOString();
  const anteriorOk = pendente && GRAUS[pendente.grauAlvo] !== undefined;
  const melhorAlvo = anteriorOk && GRAUS[pendente.grauAlvo] > nivelLeitura
    ? { grauAlvo: pendente.grauAlvo, alertaAlvo: pendente.alertaAlvo || null }
    : { grauAlvo: leitura.grau, alertaAlvo: leitura.alerta || null };
  const pendencia = {
    desde: anteriorOk ? pendente.desde : instante,
    leituras: (anteriorOk ? pendente.leituras : 0) + 1,
    ultimaLeituraEm: instante,
    ...melhorAlvo,
  };
  const decorrido = (new Date(instante) - new Date(pendencia.desde)) / 60000;
  const confirmar = pendencia.leituras >= config.leituras && decorrido >= config.minutos;
  // A pendência é mantida ao confirmar: se o envio falhar, a próxima
  // verificação confirma de novo sem reiniciar a estabilização. O estado
  // confirmado (marcarAlertasEnviados) a descarta.
  return { confirmar, alvo: confirmar ? melhorAlvo : undefined, pendencia };
}

// ---------------------------------------------------------------------------
// Auditoria
// ---------------------------------------------------------------------------

/**
 * Acrescenta um evento ao histórico (JSON Lines, somente inclusão). Nunca
 * lança: falha de auditoria não pode impedir o envio de um alerta.
 */
function arquivoHistorico() {
  return process.env.GATILHOS_HISTORICO_ARQUIVO || ARQUIVO_HISTORICO;
}

function registrarHistorico(evento, { arquivo = arquivoHistorico(), agora = () => new Date() } = {}) {
  try {
    fs.mkdirSync(path.dirname(arquivo), { recursive: true });
    fs.appendFileSync(arquivo, `${JSON.stringify({ registradoEm: agora().toISOString(), ...evento })}\n`, "utf-8");
    return true;
  } catch (erro) {
    console.error(`[GATILHOS][ERRO] histórico não gravado: ${erro.message}`);
    return false;
  }
}

function lerHistorico({ arquivo = arquivoHistorico() } = {}) {
  try {
    return fs.readFileSync(arquivo, "utf-8").split("\n").filter(Boolean).map((linha) => JSON.parse(linha));
  } catch (erro) {
    if (erro.code === "ENOENT") return [];
    throw erro;
  }
}

module.exports = {
  ARQUIVO_HISTORICO,
  COR_POR_GRAU,
  FENOMENOS,
  LIMITES: LIMITES_ALERTA_INMET,
  NIVEIS: ["NORMAL", ...NIVEIS_ACUMULAVEIS],
  ROTULO_TRANSICAO,
  avaliarCalor,
  avaliarChuva,
  avaliarLocalidade,
  avaliarVento,
  configuracaoConfirmacao,
  decidirReducao,
  lerHistorico,
  registrarHistorico,
  tipoTransicao,
  validarIndicador,
};
