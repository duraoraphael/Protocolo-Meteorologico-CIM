const test = require("node:test");
const assert = require("node:assert/strict");

const { CONFIGURACAO_EMAIL } = require("../src/config/email");
const {
  iniciarAgendamentoDiario,
  executarHorarioAgendado,
  agendarEnvioUnicoHoje,
  iniciarMonitorAlertas,
} = require("../src/scheduler");
const { compararComManha } = require("../src/logic/scheduledReport");

test("interruptores bloqueiam separadamente cada envio automático", () => {
  const configuracaoAnterior = { ...CONFIGURACAO_EMAIL };
  const envioUnicoAnterior = process.env.ENVIO_UNICO_HOJE;

  try {
    process.env.ENVIO_UNICO_HOJE = "12:00";

    CONFIGURACAO_EMAIL.relatorioDiarioAtivo = false;
    CONFIGURACAO_EMAIL.envioUnicoAgendadoAtivo = true;
    CONFIGURACAO_EMAIL.alertasAutomaticosAtivos = true;
    assert.equal(iniciarAgendamentoDiario(), null);

    CONFIGURACAO_EMAIL.relatorioDiarioAtivo = true;
    CONFIGURACAO_EMAIL.envioUnicoAgendadoAtivo = false;
    assert.equal(agendarEnvioUnicoHoje(), null);

    CONFIGURACAO_EMAIL.envioUnicoAgendadoAtivo = true;
    CONFIGURACAO_EMAIL.alertasAutomaticosAtivos = false;
    assert.equal(iniciarMonitorAlertas(), null);
  } finally {
    Object.assign(CONFIGURACAO_EMAIL, configuracaoAnterior);
    if (envioUnicoAnterior === undefined) delete process.env.ENVIO_UNICO_HOJE;
    else process.env.ENVIO_UNICO_HOJE = envioUnicoAnterior;
  }
});

test("cron agenda 05:00 e 15:00 no horário de Brasília", () => {
  const tarefas = [];
  const agendar = (expressao, callback, opcoes) => {
    tarefas.push({ expressao, callback, opcoes });
    return { stop() {} };
  };
  const anterior = process.env.ENVIO_AUTOMATICO_DIARIO;
  try {
    delete process.env.ENVIO_AUTOMATICO_DIARIO;
    iniciarAgendamentoDiario(undefined, agendar);
    assert.deepEqual(tarefas.map((t) => t.expressao), ["0 5 * * *", "0 15 * * *"]);
    assert.ok(tarefas.every((t) => t.opcoes.timezone === "America/Sao_Paulo"));
  } finally {
    if (anterior === undefined) delete process.env.ENVIO_AUTOMATICO_DIARIO;
    else process.env.ENVIO_AUTOMATICO_DIARIO = anterior;
  }
});

test("duas rodadas percorrem bases, isolam falha e não repetem envio confirmado", async () => {
  const estado = {};
  const chamadas = [];
  const executar = async (opcoes) => {
    chamadas.push(opcoes);
    if (opcoes.cidadeChave === "macae") throw new Error("Falha de teste");
    return {
      envio: { messageId: "teste" },
      report: {
        geradoEmISO: "2026-09-28T08:00:00.000Z",
        severidade: { grau: opcoes.horarioAgendado === "15:00" ? "ALERTA" : "ATENÇÃO", vento: { grau: "ATENÇÃO" }, chuva: { grau: "NORMAL" }, eventos: [] },
        rajadaMaxKmh: 35,
        precipitacaoTotalMm: 0,
      },
    };
  };
  const opcoes = { executar, bases: ["rio_de_janeiro", "macae", "cabiunas"], carregar: () => estado, salvar: () => {}, data: "2026-09-28" };
  await executarHorarioAgendado("05:00", opcoes);
  assert.ok(estado["2026-09-28|rio_de_janeiro|05:00"]);
  assert.ok(estado["2026-09-28|cabiunas|05:00"]);
  assert.equal(estado["2026-09-28|macae|05:00"], undefined);
  await executarHorarioAgendado("05:00", opcoes);
  assert.equal(chamadas.filter((c) => c.horarioAgendado === "05:00" && c.cidadeChave === "rio_de_janeiro").length, 1);
  await executarHorarioAgendado("15:00", opcoes);
  assert.equal(chamadas.find((c) => c.horarioAgendado === "15:00" && c.cidadeChave === "rio_de_janeiro").comparacaoAnterior.grau, "ATENÇÃO");
  assert.ok(estado["2026-09-28|rio_de_janeiro|15:00"]);
  assert.match(compararComManha({ grau: "ATENÇÃO", vento: "ATENÇÃO", chuva: "NORMAL", fenomenos: [], rajadaMaxKmh: 35, precipitacaoTotalMm: 0 }, { grau: "ALERTA", vento: "ALERTA", chuva: "NORMAL", fenomenos: ["ALERTA — VENTO"], rajadaMaxKmh: 48, precipitacaoTotalMm: 0 }).join(" "), /ATENÇÃO → ALERTA/);
});
