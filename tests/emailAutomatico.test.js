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

test("cron agenda as seis edições diárias no horário de Brasília", () => {
  const tarefas = [];
  const agendar = (expressao, callback, opcoes) => {
    tarefas.push({ expressao, callback, opcoes });
    return { stop() {} };
  };
  const variaveis = ["ENVIO_AUTOMATICO_DIARIO", "HORARIOS_INFORMATIVO", "HORARIOS_COR_RIO"];
  const anteriores = Object.fromEntries(variaveis.map((v) => [v, process.env[v]]));
  try {
    for (const v of variaveis) delete process.env[v];
    const agendadas = iniciarAgendamentoDiario(undefined, agendar);
    assert.deepEqual(tarefas.map((t) => t.expressao), ["0 5 * * *", "0 9 * * *", "0 12 * * *", "0 15 * * *", "0 17 * * *", "0 20 * * *"]);
    assert.deepEqual(Object.keys(agendadas), ["05:00", "09:00", "12:00", "15:00", "17:00", "20:00"]);
    assert.ok(tarefas.every((t) => t.opcoes.timezone === "America/Sao_Paulo"));

    // Restrição por variável de ambiente; horário desconhecido não é agendado.
    tarefas.length = 0;
    process.env.HORARIOS_INFORMATIVO = "15:00,05:00";
    iniciarAgendamentoDiario(undefined, agendar);
    assert.deepEqual(tarefas.map((t) => t.expressao), ["0 5 * * *", "0 15 * * *"]);
    tarefas.length = 0;
    process.env.HORARIOS_INFORMATIVO = "05:00,10:00";
    const erro = console.error; console.error = () => {};
    try { iniciarAgendamentoDiario(undefined, agendar); } finally { console.error = erro; }
    assert.equal(tarefas.length, 6, "configuração inválida volta ao padrão completo");
  } finally {
    for (const v of variaveis) {
      if (anteriores[v] === undefined) delete process.env[v];
      else process.env[v] = anteriores[v];
    }
  }
});

test("edições intermediárias comparam com as 05:00 e só enviam COR-Rio quando configurado", async () => {
  const estado = {};
  const chamadas = [];
  const executar = async (opcoes) => {
    chamadas.push(opcoes);
    return {
      envio: { messageId: "teste" },
      report: {
        geradoEmISO: "2026-09-28T08:00:00.000Z",
        severidade: { grau: "ATENÇÃO", vento: { grau: "ATENÇÃO" }, chuva: { grau: "NORMAL" }, eventos: [] },
        rajadaMaxKmh: 35,
        precipitacaoTotalMm: 0,
      },
    };
  };
  const opcoes = { executar, bases: ["rio_de_janeiro"], carregar: () => estado, salvar: () => {}, data: "2026-09-28" };
  await executarHorarioAgendado("05:00", opcoes);
  for (const horario of ["09:00", "12:00", "17:00", "20:00"]) {
    await executarHorarioAgendado(horario, { ...opcoes, incluirCorRio: false });
    const chamada = chamadas.find((c) => c.horarioAgendado === horario && c.tipoEnvio !== "cor_rio");
    assert.equal(chamada.comparacaoAnterior.grau, "ATENÇÃO", `${horario} compara com 05:00`);
    assert.ok(estado[`2026-09-28|rio_de_janeiro|${horario}`], `${horario} registrado no histórico`);
  }
  assert.deepEqual(chamadas.filter((c) => c.tipoEnvio === "cor_rio").map((c) => c.horarioAgendado), ["05:00"]);
  assert.match(compararComManha({ grau: "NORMAL", vento: "NORMAL", chuva: "NORMAL", fenomenos: [], rajadaMaxKmh: 30 }, { grau: "NORMAL", vento: "NORMAL", chuva: "NORMAL", fenomenos: [], rajadaMaxKmh: 40 }, "12:00").join(" "), /previsão das 05:00 → previsão das 12:00/);
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
  assert.equal(chamadas.filter((c) => c.horarioAgendado === "05:00" && c.cidadeChave === "rio_de_janeiro" && c.tipoEnvio !== "cor_rio").length, 1);
  await executarHorarioAgendado("15:00", opcoes);
  assert.equal(chamadas.find((c) => c.horarioAgendado === "15:00" && c.cidadeChave === "rio_de_janeiro" && c.tipoEnvio !== "cor_rio").comparacaoAnterior.grau, "ATENÇÃO");
  assert.ok(estado["2026-09-28|rio_de_janeiro|15:00"]);
  assert.ok(estado["2026-09-28|cor_rio|05:00"]);
  assert.ok(estado["2026-09-28|cor_rio|15:00"]);
  assert.equal(chamadas.filter((c) => c.tipoEnvio === "cor_rio").length, 2);
  assert.match(compararComManha({ grau: "ATENÇÃO", vento: "ATENÇÃO", chuva: "NORMAL", fenomenos: [], rajadaMaxKmh: 35, precipitacaoTotalMm: 0 }, { grau: "ALERTA", vento: "ALERTA", chuva: "NORMAL", fenomenos: ["ALERTA — VENTO"], rajadaMaxKmh: 48, precipitacaoTotalMm: 0 }).join(" "), /ATENÇÃO → ALERTA/);
});
