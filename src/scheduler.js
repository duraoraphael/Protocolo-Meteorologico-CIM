const cron = require("node-cron");
const { executarPipeline } = require("./pipeline");
const { CIDADES } = require("./config/cities");
const { dataBrasilia, lerEstado, gravarEstado, resumo } = require("./logic/scheduledReport");
const {
  relatorioDiarioAtivo,
  envioUnicoAgendadoAtivo,
  alertasAutomaticosAtivos,
} = require("./config/email");

/**
 * Restrição opcional do envio único de teste. O agendamento 05h/15h percorre
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
} = {}) {
  if (processamentoAgendado) {
    console.warn(`[AGENDADOR] ${horario}: execução anterior ainda em andamento; ciclo sobreposto ignorado.`);
    return;
  }
  processamentoAgendado = true;
  console.log(`[AGENDADOR] ${horario} iniciado (${data}).`);
  try {
    const estado = carregar();
    for (const cidadeChave of bases) {
      const nome = CIDADES[cidadeChave]?.nome || cidadeChave;
      const chave = `${data}|${cidadeChave}|${horario}`;
      if (estado[chave]) {
        console.log(`[AGENDADOR] ${nome}: envio das ${horario} já confirmado; ignorado.`);
        continue;
      }
      console.log(`[AGENDADOR] ${nome}: iniciando coleta (${horario}).`);
      try {
        const resultado = await executar({
          cidadeChave,
          enviarEmail: true,
          horarioAgendado: horario,
          comparacaoAnterior: horario === "15:00" ? estado[`${data}|${cidadeChave}|05:00`]?.resumo || null : null,
        });
        if (!resultado.envio) throw new Error("SMTP não confirmou o envio do relatório.");
        estado[chave] = { enviadoEmISO: new Date().toISOString(), resumo: resumo(resultado.report) };
        salvar(estado);
        console.log(`[AGENDADOR] ${nome}: relatório gerado e e-mail enviado com sucesso (${horario}).`);
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
        console.error(`[AGENDADOR] ${nome}: falha às ${horario}: ${erro.message}`);
        onResultado?.(erro, null);
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

/** Agenda os dois relatórios diários para todas as bases em Brasília. */
function iniciarAgendamentoDiario(onResultado, agendar = cron.schedule) {
  if (!relatorioDiarioAtivo()) {
    console.log("[CIM] Agendamento diário desativado em src/config/email.js.");
    return null;
  }
  if (process.env.ENVIO_AUTOMATICO_DIARIO === "false") {
    console.log("[CIM] Agendamento diário desativado via ENVIO_AUTOMATICO_DIARIO=false.");
    return null;
  }

  const manha = agendar("0 5 * * *", () => executarHorarioAgendado("05:00", { onResultado }), { timezone: "America/Sao_Paulo" });
  const tarde = agendar("0 15 * * *", () => executarHorarioAgendado("15:00", { onResultado }), { timezone: "America/Sao_Paulo" });
  console.log(`[AGENDADOR] 05:00 e 15:00 (America/Sao_Paulo), ${Object.keys(CIDADES).length} bases cadastradas.`);
  return { manha, tarde };
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
 * A janela horária existe porque um e-mail às 3h da manhã não gera ação —
 * só ruído. Eventos da madrugada aparecem no informativo das 07:30.
 */
function iniciarMonitorAlertas(onResultado) {
  if (!alertasAutomaticosAtivos()) {
    console.log("[CIM] Monitor de alertas desativado em src/config/email.js.");
    return null;
  }
  if (process.env.MONITOR_ALERTAS === "false") {
    console.log("[CIM] Monitor de alertas desativado via MONITOR_ALERTAS=false.");
    return null;
  }

  const intervalo = parseInt(process.env.INTERVALO_MONITOR_MIN || "60", 10);
  if (Number.isNaN(intervalo) || intervalo < 10) {
    console.warn(`[CIM] INTERVALO_MONITOR_MIN inválido ou muito curto — usando 60 min.`);
  }
  const minutos = Number.isNaN(intervalo) || intervalo < 10 ? 60 : intervalo;

  const janela = (process.env.JANELA_MONITOR || "06:00-22:00").split("-");
  const [horaIni, horaFim] = janela.map((h) => parseInt(h.split(":")[0], 10));

  const expressao = minutos >= 60 ? `0 */${Math.floor(minutos / 60)} * * *` : `*/${minutos} * * * *`;

  const tarefa = cron.schedule(
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
        const { verificarAlertas, marcarAlertasEnviados } = require("./logic/alertWatcher");
        const { enviarAlertaPorEmail } = require("./email/sendAlert");

        const resultado = await verificarAlertas();
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
        for (const base of resultado.porBase) {
          try {
            const envio = await enviarAlertaPorEmail(base);
            marcarAlertasEnviados(base);
            console.log(
              `[CIM] Alerta enviado (${base.chave}): ${base.alertas.map((a) => a.tipo).join(", ")} -> ${envio.destinatarios.length} destinatário(s).`
            );
            onResultado?.(null, { base, envio });
          } catch (erro) {
            console.error(`[CIM] Falha ao enviar alerta (${base.chave}):`, erro.message);
            onResultado?.(erro, null);
          }
        }
      } catch (erro) {
        console.error("[CIM] Falha no monitor de alertas:", erro.message);
        onResultado?.(erro, null);
      }
    },
    { timezone: "America/Sao_Paulo" }
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

module.exports = {
  iniciarAgendamentoDiario,
  executarHorarioAgendado,
  agendarEnvioUnicoHoje,
  iniciarMonitorAlertas,
  iniciarAtualizacaoAutomatica,
};
