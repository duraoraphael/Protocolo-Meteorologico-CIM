// Cache dos dados meteorológicos exibidos no painel, por base.
//
// Antes o cache só era renovado quando um navegador pedia /api/preview; com a
// aba congelada ou sem nenhum navegador aberto, os dados envelheciam. Agora o
// agendador do servidor (src/scheduler.js) chama atualizarTodas() a cada
// INTERVALO_ATUALIZACAO_MIN e o painel apenas lê o que já está pronto.
//
// Regras:
// - "consultadoEm" é o horário da última consulta BEM-SUCEDIDA (geradoEmISO do
//   relatório). Uma falha nunca o altera nem apaga os dados anteriores.
// - Uma base nunca tem duas consultas simultâneas; o ciclo completo também não
//   se sobrepõe ao anterior.
// - Nenhum e-mail é disparado daqui: só montarRelatorio(), que apenas coleta.

const { montarRelatorio } = require("./reportBuilder");

const INTERVALO_PADRAO_MIN = 30;
// Depois de uma falha, pedidos do navegador não voltam a consultar as APIs
// antes deste intervalo (o ciclo agendado sempre tenta).
const ESPERA_APOS_FALHA_MS = 5 * 60 * 1000;
// Teto de segurança por base: as fontes já têm timeout próprio, mas uma
// consulta travada não pode bloquear os ciclos seguintes.
const LIMITE_POR_BASE_MS = 3 * 60 * 1000;

function intervaloAtualizacaoMin(valor = process.env.INTERVALO_ATUALIZACAO_MIN) {
  if (valor === undefined || valor === "") return INTERVALO_PADRAO_MIN;
  const minutos = Number(valor);
  if (!Number.isInteger(minutos) || minutos < 1 || minutos > 60 || 60 % minutos !== 0) {
    console.warn(`[ATUALIZACAO] INTERVALO_ATUALIZACAO_MIN inválido ("${valor}"; use um divisor de 60) — usando ${INTERVALO_PADRAO_MIN} min.`);
    return INTERVALO_PADRAO_MIN;
  }
  return minutos;
}

function comLimiteDeTempo(promessa, ms, nome) {
  let temporizador;
  const limite = new Promise((_, rejeitar) => {
    temporizador = setTimeout(() => rejeitar(new Error(`${nome}: coleta excedeu ${Math.round(ms / 1000)}s`)), ms);
    temporizador.unref?.();
  });
  return Promise.race([promessa, limite]).finally(() => clearTimeout(temporizador));
}

function criarAtualizadorDados({
  montar = montarRelatorio,
  intervaloMs = intervaloAtualizacaoMin() * 60 * 1000,
  esperaAposFalhaMs = ESPERA_APOS_FALHA_MS,
  limitePorBaseMs = LIMITE_POR_BASE_MS,
  agora = Date.now,
  logger = console,
} = {}) {
  const entradas = new Map(); // chave -> { report, consultadoEm, ultimaFalhaEm, ultimoErro }
  const emAndamento = new Map();
  let cicloEmAndamento = false;

  function entrada(chave) {
    if (!entradas.has(chave)) entradas.set(chave, { report: null, consultadoEm: 0, ultimaFalhaEm: 0, ultimoErro: null });
    return entradas.get(chave);
  }

  function registrar(report) {
    const item = entrada(report.cidade.chave);
    item.report = report;
    item.consultadoEm = Date.parse(report.geradoEmISO) || agora();
    item.ultimaFalhaEm = 0;
    item.ultimoErro = null;
  }

  /** Consulta as APIs para uma base. Rejeita em falha, mantendo os dados anteriores. */
  function atualizar(cidade, origem = "painel") {
    if (emAndamento.has(cidade.chave)) return emAndamento.get(cidade.chave);
    const inicio = agora();
    logger.log(`[ATUALIZACAO] ${cidade.nome}: consulta iniciada (${origem}).`);
    const tarefa = comLimiteDeTempo(Promise.resolve().then(() => montar(cidade)), limitePorBaseMs, cidade.nome)
      .then((report) => {
        registrar(report);
        const falhas = report.avisosColeta?.length ? ` com ${report.avisosColeta.length} aviso(s) de coleta` : "";
        logger.log(`[ATUALIZACAO] ${cidade.nome}: dados atualizados${falhas} (consulta às ${report.horaConsulta}, ${agora() - inicio} ms).`);
        return report;
      })
      .catch((erro) => {
        const item = entrada(cidade.chave);
        item.ultimaFalhaEm = agora();
        item.ultimoErro = erro?.message || String(erro);
        logger.error(`[ATUALIZACAO] ${cidade.nome}: falha na consulta (${origem}) — ${item.ultimoErro}. ${item.report ? "Mantidos os últimos dados válidos." : "Sem dados anteriores."}`);
        throw erro;
      })
      .finally(() => emAndamento.delete(cidade.chave));
    emAndamento.set(cidade.chave, tarefa);
    return tarefa;
  }

  function estado(chave) {
    const item = entrada(chave);
    const pendente = Boolean(item.ultimaFalhaEm && item.ultimaFalhaEm >= item.consultadoEm) ||
      (item.consultadoEm > 0 && agora() - item.consultadoEm > intervaloMs * 1.5);
    return {
      consultadoEmISO: item.consultadoEm ? new Date(item.consultadoEm).toISOString() : null,
      pendente,
      ultimaFalhaEmISO: item.ultimaFalhaEm ? new Date(item.ultimaFalhaEm).toISOString() : null,
      intervaloMs,
    };
  }

  /**
   * Usado por /api/preview. Devolve o cache se estiver dentro do intervalo;
   * se estiver vencido, tenta consultar e, em caso de falha, devolve os
   * últimos dados válidos marcados como pendentes.
   */
  async function obter(cidade) {
    const item = entrada(cidade.chave);
    const vencido = agora() - item.consultadoEm >= intervaloMs;
    const aguardandoNovaTentativa = item.ultimaFalhaEm && agora() - item.ultimaFalhaEm < esperaAposFalhaMs;
    if (item.report && (!vencido || aguardandoNovaTentativa)) {
      return { report: item.report, ...estado(cidade.chave) };
    }
    try {
      await atualizar(cidade);
    } catch (erro) {
      if (!item.report) throw erro;
    }
    return { report: item.report, ...estado(cidade.chave) };
  }

  /** Ciclo agendado: consulta as bases uma de cada vez (respeita os limites das APIs). */
  async function atualizarTodas(cidades, origem = "agendado") {
    if (cicloEmAndamento) {
      logger.warn("[ATUALIZACAO] Ciclo anterior ainda em andamento; ciclo sobreposto ignorado.");
      return null;
    }
    cicloEmAndamento = true;
    const inicio = agora();
    let sucesso = 0;
    logger.log(`[ATUALIZACAO] Ciclo ${origem} iniciado: ${cidades.length} base(s).`);
    try {
      for (const cidade of cidades) {
        try {
          await atualizar(cidade, origem);
          sucesso += 1;
        } catch {
          // já registrado em atualizar(); segue para a próxima base
        }
      }
    } finally {
      cicloEmAndamento = false;
      logger.log(`[ATUALIZACAO] Ciclo ${origem} finalizado: ${sucesso}/${cidades.length} base(s) atualizada(s) em ${Math.round((agora() - inicio) / 1000)}s.`);
    }
    return { sucesso, total: cidades.length };
  }

  return { obter, atualizar, atualizarTodas, registrar, estado, intervaloMs };
}

module.exports = { criarAtualizadorDados, intervaloAtualizacaoMin, INTERVALO_PADRAO_MIN };
