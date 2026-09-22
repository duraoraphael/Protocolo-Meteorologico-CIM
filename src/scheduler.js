const cron = require("node-cron");
const { executarPipeline } = require("./pipeline");
const { CIDADES } = require("./config/cities");

/**
 * Quais bases recebem o envio automático diário. Por padrão, TODAS as
 * cadastradas em src/config/cities.js (cada uma para seus próprios
 * responsáveis — ver src/config/recipients.js). Para restringir a um
 * subconjunto, defina no .env:
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

/**
 * Agenda o envio automático diário do informativo para cada base cadastrada.
 * Controlado por env:
 *   HORA_ENVIO_DIARIO=06:00   (HH:mm, horário de Brasília)
 *   ENVIO_AUTOMATICO_DIARIO=false   (desliga o agendamento; padrão: ligado)
 *   BASES_ENVIO_DIARIO=chave1,chave2   (opcional; padrão: todas as bases)
 */
function iniciarAgendamentoDiario(onResultado) {
  if (process.env.ENVIO_AUTOMATICO_DIARIO === "false") {
    console.log("[CIM] Agendamento diário desativado via ENVIO_AUTOMATICO_DIARIO=false.");
    return null;
  }

  const horario = process.env.HORA_ENVIO_DIARIO || "06:00";
  const [hora, minuto] = horario.split(":").map((v) => parseInt(v, 10));
  if (Number.isNaN(hora) || Number.isNaN(minuto)) {
    console.warn(`[CIM] HORA_ENVIO_DIARIO inválida ("${horario}"), usando 06:00.`);
  }
  const expressao = `${Number.isNaN(minuto) ? 0 : minuto} ${Number.isNaN(hora) ? 6 : hora} * * *`;

  const tarefa = cron.schedule(
    expressao,
    async () => {
      const bases = basesParaEnvioDiario();
      console.log(`[CIM] Disparando envio automático diário agendado (${horario}) para: ${bases.join(", ")}...`);
      for (const cidadeChave of bases) {
        try {
          const resultado = await executarPipeline({ cidadeChave, enviarEmail: true });
          console.log(`[CIM] Envio automático concluído (${cidadeChave}): ${resultado.arquivoPdf}`);
          onResultado?.(null, resultado);
        } catch (erro) {
          console.error(`[CIM] Falha no envio automático diário (${cidadeChave}):`, erro.message);
          onResultado?.(erro, null);
        }
      }
    },
    { timezone: "America/Sao_Paulo" }
  );

  console.log(
    `[CIM] Envio automático diário agendado para ${horario} (America/Sao_Paulo), bases: ${basesParaEnvioDiario().join(", ")}.`
  );
  return tarefa;
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
        const { verificarAlertas } = require("./logic/alertWatcher");
        const { enviarAlertaPorEmail } = require("./email/sendAlert");

        const resultado = await verificarAlertas();
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

module.exports = { iniciarAgendamentoDiario, agendarEnvioUnicoHoje, iniciarMonitorAlertas };
