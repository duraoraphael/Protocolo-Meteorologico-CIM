const cron = require("node-cron");
const { executarPipeline } = require("./pipeline");
const { CIDADES } = require("./config/cities");
const { dataBrasilia, lerEstado, gravarEstado, registroHistorico, adquirirExecucao } = require("./logic/scheduledReport");
const { BASE_COR_RIO } = require("./config/distributionBases");
const { HORARIOS_INFORMATIVO, HORARIO_EDICAO_INICIAL, horariosConfigurados } = require("./logic/informativoValidity");

const HORARIOS_COR_RIO_PADRAO = Object.freeze(["08:00", "15:00"]);
const {
  relatorioDiarioAtivo,
  envioUnicoAgendadoAtivo,
  alertasAutomaticosAtivos,
} = require("./config/email");

/**
 * Restrição opcional do envio único de teste. O agendamento diário percorre
 * sempre todas as bases cadastradas em src/config/cities.js.
 *   BASES_ENVIO_DIARIO=rio_de_janeiro,salvador
 */
function basesParaEnvioDiario() {
  const restricao = process.env.BASES_ENVIO_DIARIO;
  if (!restricao) return Object.keys(CIDADES);
  return restricao
    .split(",")
    .map((c) => c.trim())
    .filter((chave) => {
      if (!CIDADES[chave]) {
        console.warn(`[CIM] BASES_ENVIO_DIARIO cita base desconhecida "${chave}" — ignorada.`);
        return false;
      }
      return true;
    });
}

let processamentoAgendado = false;

async function executarHorarioAgendado(horario, {
  executar = executarPipeline,
  onResultado,
  bases = Object.keys(CIDADES),
  carregar = lerEstado,
  salvar = gravarEstado,
  data = dataBrasilia(),
  incluirCorRio = true,
  adquirir = null,
} = {}) {
  if (processamentoAgendado) {
    console.warn(`[AGENDADOR] ${horario}: execução anterior ainda em andamento; ciclo sobreposto ignorado.`);
    return;
  }
  processamentoAgendado = true;
  const adquirirTrava = adquirir || ((carregar !== lerEstado || salvar !== gravarEstado)
    ? (chave) => ({ adquirida: true, executionId: `teste:${chave}`, concluir() {}, liberar() {} })
    : adquirirExecucao);
  console.log(`[AGENDADOR] horárioProgramado=${horario} horárioEfetivo=${new Date().toISOString()} data=${data} status=iniciado.`);
  try {
    const estado = carregar();
    for (const cidadeChave of bases) {
      const nome = CIDADES[cidadeChave]?.nome || cidadeChave;
      const chave = `${data}|${cidadeChave}|${horario}`;
      if (estado[chave]) {
        console.log(`[AGENDADOR] ${nome}: envio das ${horario} já confirmado; ignorado.`);
        continue;
      }
      const trava = adquirirTrava(chave);
      if (!trava.adquirida) {
        console.warn(`[AGENDADOR] execução duplicada bloqueada horario=${horario} localidade="${nome}" chave="${chave}".`);
        continue;
      }
      console.log(`[AGENDADOR] executionId=${trava.executionId} horarioProgramado=${horario} localidade="${nome}" status=coleta_iniciada.`);
      try {
        const resultado = await executar({
          cidadeChave,
          enviarEmail: true,
          horarioAgendado: horario,
          // A edição das 15h compara com a edição inicial (08:00) do dia.
          comparacaoAnterior: horario !== HORARIO_EDICAO_INICIAL
            ? estado[`${data}|${cidadeChave}|${HORARIO_EDICAO_INICIAL}`]?.resumo || null
            : null,
        });
        if (!resultado.envio) throw new Error("SMTP não confirmou o envio do relatório.");
        estado[chave] = registroHistorico(resultado.report);
        salvar(estado);
        trava.concluir("enviado", { messageId: resultado.envio?.messageId || null });
        console.log(`[AGENDADOR] executionId=${trava.executionId} horarioProgramado=${horario} horarioEfetivo=${new Date().toISOString()} localidade="${nome}" status=enviado.`);
        if (alertasAutomaticosAtivos() && process.env.MONITOR_ALERTAS !== "false" && resultado.report.climaSaude?.status === 'operacional') {
          try {
            const { enviarAlertaCalorDoRelatorio } = require('./logic/alertWatcher');
            await enviarAlertaCalorDoRelatorio(CIDADES[cidadeChave], resultado.report);
          } catch (erro) {
            console.error(`[AGENDADOR] ${nome}: falha no alerta de calor: ${erro.message}`);
          }
        }
        onResultado?.(null, resultado);
      } catch (erro) {
        trava.liberar();
        console.error(`[AGENDADOR] executionId=${trava.executionId} horarioProgramado=${horario} horarioEfetivo=${new Date().toISOString()} localidade="${nome}" status=falha erro="${erro.message}".`);
        onResultado?.(erro, null);
      }
    }
    if (incluirCorRio) {
      const chaveCorRio = `${data}|${BASE_COR_RIO}|${horario}`;
      if (!estado[chaveCorRio]) {
        const travaCorRio = adquirirTrava(chaveCorRio);
        if (!travaCorRio.adquirida) {
          console.warn(`[AGENDADOR] execução duplicada bloqueada horario=${horario} localidade="COR-RIO" chave="${chaveCorRio}".`);
          return;
        }
        try {
          const resultado = await executar({
            cidadeChave: "rio_de_janeiro",
            enviarEmail: true,
            horarioAgendado: horario,
            tipoEnvio: "cor_rio",
            permitirSemDestinatarios: true,
          });
          if (resultado.envio) {
            estado[chaveCorRio] = registroHistorico(resultado.report);
            salvar(estado);
            travaCorRio.concluir("enviado", { messageId: resultado.envio?.messageId || null });
            console.log(`[AGENDADOR] executionId=${travaCorRio.executionId} horarioProgramado=${horario} horarioEfetivo=${new Date().toISOString()} localidade="COR-RIO" status=enviado.`);
            onResultado?.(null, resultado);
          } else {
            travaCorRio.liberar();
            console.log(`[AGENDADOR] COR-RIO: nenhum destinatário vinculado; envio ignorado (${horario}).`);
          }
        } catch (erro) {
          travaCorRio.liberar();
          console.error(`[AGENDADOR] COR-RIO: falha às ${horario}: ${erro.message}`);
          onResultado?.(erro, null);
        }
      }
    }
  } catch (erro) {
    console.error(`[AGENDADOR] ${horario}: não foi possível ler o estado dos envios: ${erro.message}`);
    onResultado?.(erro, null);
  } finally {
    processamentoAgendado = false;
    console.log(`[AGENDADOR] ${horario} finalizado.`);
  }
}

function lerHorarios(variavel, padrao) {
  try {
    return horariosConfigurados(process.env[variavel], padrao);
  } catch (erro) {
    console.error(`[AGENDADOR] ${variavel}: ${erro.message} Usando o padrão (${padrao.join(", ")}).`);
    return [...padrao];
  }
}

/**
 * Agenda as edições diárias do informativo para todas as bases, no horário
 * de Brasília. Únicos horários regulares: 08:00 e 15:00.
 *   HORARIOS_INFORMATIVO=08:00,15:00
 *   HORARIOS_COR_RIO=08:00,15:00
 */
function iniciarAgendamentoDiario(onResultado, agendar = cron.schedule) {
  if (!relatorioDiarioAtivo()) {
    console.log("[CIM] Agendamento diário desativado em src/config/email.js.");
    return null;
  }
  if (process.env.ENVIO_AUTOMATICO_DIARIO === "false") {
    console.log("[CIM] Agendamento diário desativado via ENVIO_AUTOMATICO_DIARIO=false.");
    return null;
  }

  const horarios = lerHorarios("HORARIOS_INFORMATIVO", HORARIOS_INFORMATIVO);
  const horariosCorRio = lerHorarios("HORARIOS_COR_RIO", HORARIOS_COR_RIO_PADRAO);
  const tarefas = Object.fromEntries(horarios.map((horario) => {
    const [hora, minuto] = horario.split(":").map(Number);
    const incluirCorRio = horariosCorRio.includes(horario);
    const tarefa = agendar(`${minuto} ${hora} * * *`, () => executarHorarioAgendado(horario, { onResultado, incluirCorRio }), { timezone: "America/Sao_Paulo" });
    return [horario, tarefa];
  }));
  console.log(`[AGENDADOR] ${horarios.join(", ")} (America/Sao_Paulo), ${Object.keys(CIDADES).length} bases meteorológicas; aviso COR-RIO em ${horariosCorRio.filter((h) => horarios.includes(h)).join(", ") || "nenhum horário"}.`);
  return tarefas;
}

/**
 * Dispara o informativo de todas as bases uma única vez, em um horário
 * específico de hoje. Serve para testes ("manda hoje às 08:30") sem alterar
 * o agendamento diário permanente. Controlado por env:
 *   ENVIO_UNICO_HOJE=08:30
 * Se o horário já passou, não envia nada (evita disparo imediato indesejado
 * ao reiniciar o servidor no fim do dia).
 */
function agendarEnvioUnicoHoje(onResultado) {
  const horario = process.env.ENVIO_UNICO_HOJE;
  if (!horario) return null;
  if (!envioUnicoAgendadoAtivo()) {
    console.log("[CIM] Envio único desativado em src/config/email.js.");
    return null;
  }

  const [hora, minuto] = horario.split(":").map((v) => parseInt(v, 10));
  if (Number.isNaN(hora) || Number.isNaN(minuto)) {
    console.warn(`[CIM] ENVIO_UNICO_HOJE inválido ("${horario}") — ignorado.`);
    return null;
  }

  const agoraBrasilia = new Date(
    new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" })
  );
  const alvo = new Date(agoraBrasilia);
  alvo.setHours(hora, minuto, 0, 0);

  const milissegundosAteAlvo = alvo.getTime() - agoraBrasilia.getTime();
  if (milissegundosAteAlvo <= 0) {
    console.log(
      `[CIM] ENVIO_UNICO_HOJE=${horario} já passou (agora ${agoraBrasilia.toLocaleTimeString("pt-BR")}) — nenhum envio único agendado.`
    );
    return null;
  }

  const minutosRestantes = Math.round(milissegundosAteAlvo / 60000);
  console.log(
    `[CIM] Envio ÚNICO agendado para hoje às ${horario} (em ~${minutosRestantes} min), bases: ${basesParaEnvioDiario().join(", ")}.`
  );

  return setTimeout(async () => {
    const bases = basesParaEnvioDiario();
    console.log(`[CIM] Disparando envio único de ${horario} para: ${bases.join(", ")}...`);
    for (const cidadeChave of bases) {
      try {
        const resultado = await executarPipeline({ cidadeChave, enviarEmail: true });
        console.log(`[CIM] Envio único concluído (${cidadeChave}): ${resultado.arquivoPdf}`);
        onResultado?.(null, resultado);
      } catch (erro) {
        console.error(`[CIM] Falha no envio único (${cidadeChave}):`, erro.message);
        onResultado?.(erro, null);
      }
    }
    console.log("[CIM] Envio único finalizado. O agendamento diário segue ativo.");
  }, milissegundosAteAlvo);
}

/**
 * Monitor de vigilância: verifica as fontes de tempos em tempos e envia
 * e-mail SÓ quando aparece condição grave nova. Controlado por env:
 *   MONITOR_ALERTAS=false          (desliga; padrão: ligado)
 *   INTERVALO_MONITOR_MIN=60       (de quantos em quantos minutos verificar)
 *   JANELA_MONITOR=06:00-22:00     (faixa horária; fora dela não verifica)
 *   BASES_MONITOR_ALERTAS=a,b      (opcional; padrão: todas)
 *
 * Por padrão o monitor opera 24 horas; uma janela menor pode ser configurada
 * explicitamente quando houver uma política operacional para isso.
 */
async function processarAlertaBase(base, {
  enviar,
  listar,
  enfileirar,
  assumir,
  marcarEnviado,
  marcarFalha,
  confirmar,
} = {}) {
  const enviarEfetivo = enviar || require("./email/sendAlert").enviarAlertaPorEmail;
  const listarEfetivo = listar || require("./email/sendReport").listaDestinatarios;
  const fila = require("./logic/alertQueue");
  const enfileirarEfetivo = enfileirar || fila.enfileirar;
  const assumirEfetivo = assumir || fila.assumir;
  const marcarEnviadoEfetivo = marcarEnviado || fila.marcarEnviado;
  const marcarFalhaEfetivo = marcarFalha || fila.marcarFalha;
  const confirmarEfetivo = confirmar || require("./logic/alertWatcher").marcarAlertasEnviados;
  const destinatarios = listarEfetivo(base.chave, { permitirFallback: false });
  const evento = enfileirarEfetivo(base, destinatarios);

  if (evento.status === "enviado") {
    confirmarEfetivo(base);
    return { ignorado: true, motivo: "evento-ja-enviado", eventoId: evento.id, destinatarios };
  }
  const assumido = assumirEfetivo(evento.id);
  if (!assumido) {
    return { ignorado: true, motivo: "evento-em-processamento-ou-backoff", eventoId: evento.id, destinatarios };
  }

  try {
    if (!destinatarios.length) throw new Error(`Nenhum ponto focal cadastrado para "${base.cidade.nome}".`);
    const envio = await enviarEfetivo(base, {
      eventoId: evento.id,
      destinatariosOverride: destinatarios,
    });
    marcarEnviadoEfetivo(evento.id, envio);
    try {
      confirmarEfetivo(base);
    } catch (erroEstado) {
      console.error(`[CIM] SMTP confirmou o alerta ${evento.id}, mas o histórico será reconciliado no próximo ciclo: ${erroEstado.message}`);
    }
    return { ...envio, eventoId: evento.id };
  } catch (erro) {
    marcarFalhaEfetivo(evento.id, erro);
    throw erro;
  }
}

async function verificarAlertasEEnviarPorBase({ onResultado, verificar } = {}) {
  const verificarEfetivo = verificar || require("./logic/alertWatcher").verificarAlertas;
  return verificarEfetivo({
    onBase: async (base) => {
      try {
        const envio = await processarAlertaBase(base);
        if (envio.ignorado) {
          console.log(`[CIM] Evento de alerta não reenviado (${base.chave}): ${envio.motivo}.`);
        } else {
          console.log(`[CIM] Alerta enviado (${base.chave}): ${base.alertas.map((a) => a.tipo).join(", ")} -> ${envio.destinatarios.length} destinatário(s).`);
        }
        onResultado?.(null, { base, envio });
      } catch (erro) {
        console.error(`[CIM] Falha ao enviar alerta (${base.chave}):`, erro.message);
        onResultado?.(erro, null);
      }
    },
  });
}

function iniciarMonitorAlertas(onResultado, agendar = cron.schedule) {
  if (!alertasAutomaticosAtivos()) {
    console.log("[CIM] Monitor de alertas desativado em src/config/email.js.");
    return null;
  }
  if (process.env.MONITOR_ALERTAS === "false") {
    console.log("[CIM] Monitor de alertas desativado via MONITOR_ALERTAS=false.");
    return null;
  }

  const intervalo = parseInt(process.env.INTERVALO_MONITOR_MIN || "5", 10);
  if (Number.isNaN(intervalo) || intervalo < 1) {
    console.warn(`[CIM] INTERVALO_MONITOR_MIN inválido — usando 5 min.`);
  }
  const minutos = Number.isNaN(intervalo) || intervalo < 1 ? 5 : intervalo;

  const janela = (process.env.JANELA_MONITOR || "00:00-24:00").split("-");
  const [horaIni, horaFim] = janela.map((h) => parseInt(h.split(":")[0], 10));

  const expressao = minutos >= 60 ? `0 */${Math.floor(minutos / 60)} * * *` : `*/${minutos} * * * *`;

  const tarefa = agendar(
    expressao,
    async () => {
      const agora = new Date(
        new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" })
      );
      const h = agora.getHours();
      if (!Number.isNaN(horaIni) && !Number.isNaN(horaFim) && (h < horaIni || h >= horaFim)) {
        return; // fora da janela de vigilância
      }

      try {
        const resultado = await verificarAlertasEEnviarPorBase({ onResultado });
        for (const falha of resultado.falhas) {
          console.error(`[AGENDADOR] Alerta — ${falha.nome}: falha na coleta: ${falha.erro}`);
        }
        if (resultado.totalNovos === 0) {
          console.log(`[CIM] Monitor: nenhuma condição nova (${resultado.verificadoEm}).`);
          return;
        }

        console.log(
          `[CIM] Monitor: ${resultado.totalNovos} alerta(s) novo(s) em ${resultado.porBase.length} base(s).`
        );
      } catch (erro) {
        console.error("[CIM] Falha no monitor de alertas:", erro.message);
        onResultado?.(erro, null);
      }
    },
    { timezone: "America/Sao_Paulo", noOverlap: true }
  );

  console.log(
    `[CIM] Monitor de alertas ativo: verificação a cada ${minutos} min, das ${janela[0]} às ${janela[1]}.`
  );
  return tarefa;
}

/**
 * Renova os dados do painel no servidor, independentemente de haver um
 * navegador aberto. Só coleta (montarRelatorio) — não envia e-mail nem mexe
 * no estado dos alertas. Controlado por env:
 *   ATUALIZACAO_AUTOMATICA=false     (desliga; padrão: ligado)
 *   INTERVALO_ATUALIZACAO_MIN=30     (divisor de 60; padrão 30)
 *   BASES_ATUALIZACAO=a,b            (opcional; padrão: todas)
 * Roda uma vez ao iniciar e depois nos minutos múltiplos do intervalo.
 */
function iniciarAtualizacaoAutomatica(atualizador, agendar = cron.schedule) {
  if (!atualizador) return null;
  if (process.env.ATUALIZACAO_AUTOMATICA === "false") {
    console.log("[ATUALIZACAO] Atualização automática desativada via ATUALIZACAO_AUTOMATICA=false.");
    return null;
  }
  const restricao = process.env.BASES_ATUALIZACAO;
  const chaves = restricao
    ? restricao.split(",").map((c) => c.trim()).filter((c) => CIDADES[c])
    : Object.keys(CIDADES);
  const cidades = chaves.map((chave) => CIDADES[chave]);
  const minutos = Math.round(atualizador.intervaloMs / 60000);

  const executar = (origem) => atualizador.atualizarTodas(cidades, origem).catch((erro) => {
    console.error(`[ATUALIZACAO] Falha inesperada no ciclo: ${erro.message}`);
  });
  const tarefa = agendar(`*/${minutos} * * * *`, () => executar("agendado"), { timezone: "America/Sao_Paulo" });
  console.log(`[ATUALIZACAO] Dados do painel renovados a cada ${minutos} min, ${cidades.length} base(s).`);
  executar("inicial");
  return tarefa;
}

/**
 * Verificação preventiva das fontes 30 min antes de cada informativo
 * (07:30 e 14:30). Só avisa a equipe técnica (EMAIL_ALERTA_FONTES) quando há
 * problema; sem a variável, registra apenas no log. Controlado por env:
 *   VERIFICACAO_FONTES=false   (desliga; padrão: ligado)
 */
async function executarVerificacaoFontes({
  verificar = () => require("./logic/verificacaoFontes").executarVerificacao(),
  avisar = (resultado) => require("./email/sendVerificacaoFontes").enviarVerificacaoFontes(resultado),
} = {}) {
  try {
    const resultado = await verificar();
    for (const p of resultado.problemas) {
      console.warn(`[FONTES] ${p.situacao.toUpperCase()} — ${p.fonte} (${p.escopo}): ${p.detalhe}`);
    }
    if (!resultado.problemas.length) {
      console.log(`[FONTES] Todas as fontes responderam (${resultado.itens.length} verificações).`);
      return resultado;
    }
    const envio = await avisar(resultado);
    console.log(envio.enviado
      ? `[FONTES] ${resultado.problemas.length} problema(s); aviso enviado para ${envio.destinatarios.join(", ")}.`
      : `[FONTES] ${resultado.problemas.length} problema(s); aviso por e-mail não enviado: ${envio.motivo}.`);
    return resultado;
  } catch (erro) {
    console.error(`[FONTES] Falha na verificação preventiva: ${erro.message}`);
    return null;
  }
}

function iniciarVerificacaoFontes(agendar = cron.schedule) {
  if (process.env.VERIFICACAO_FONTES === "false") {
    console.log("[FONTES] Verificação preventiva desativada via VERIFICACAO_FONTES=false.");
    return null;
  }
  const tarefa = agendar("30 7,14 * * *", () => executarVerificacaoFontes(), { timezone: "America/Sao_Paulo" });
  console.log("[FONTES] Verificação preventiva das fontes às 07:30 e 14:30 (America/Sao_Paulo).");
  return tarefa;
}

module.exports = {
  iniciarVerificacaoFontes,
  executarVerificacaoFontes,
  iniciarAgendamentoDiario,
  executarHorarioAgendado,
  agendarEnvioUnicoHoje,
  iniciarMonitorAlertas,
  processarAlertaBase,
  verificarAlertasEEnviarPorBase,
  iniciarAtualizacaoAutomatica,
};
