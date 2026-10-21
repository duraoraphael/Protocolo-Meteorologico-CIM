const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { CONFIGURACAO_EMAIL } = require("../src/config/email");
const {
  iniciarAgendamentoDiario,
  executarHorarioAgendado,
  agendarEnvioUnicoHoje,
  iniciarMonitorAlertas,
} = require("../src/scheduler");
const { compararComManha, adquirirExecucao } = require("../src/logic/scheduledReport");

test("trava persistente impede dois processos de assumir o mesmo envio", (t) => {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), "cim-agendador-"));
  t.after(() => fs.rmSync(pasta, { recursive: true, force: true }));
  const chave = "2026-10-21|rio_de_janeiro|08:00";
  const primeira = adquirirExecucao(chave, { pasta, agora: new Date("2026-10-21T11:00:00Z") });
  const segunda = adquirirExecucao(chave, { pasta, agora: new Date("2026-10-21T11:00:01Z") });
  assert.equal(primeira.adquirida, true);
  assert.equal(segunda.adquirida, false);
  primeira.concluir("enviado", { messageId: "teste" });
  const aposReinicio = adquirirExecucao(chave, { pasta, agora: new Date("2026-10-21T12:00:00Z") });
  assert.equal(aposReinicio.adquirida, false, "reinício não reassume envio confirmado");
});

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

test("cron agenda exclusivamente 08h e 15h no horário de Brasília", () => {
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
    assert.deepEqual(tarefas.map((t) => t.expressao), ["0 8 * * *", "0 15 * * *"]);
    assert.deepEqual(Object.keys(agendadas), ["08:00", "15:00"]);
    assert.ok(tarefas.every((t) => t.opcoes.timezone === "America/Sao_Paulo"));

    // Restrição por variável de ambiente; horário desconhecido não é agendado.
    tarefas.length = 0;
    process.env.HORARIOS_INFORMATIVO = "15:00,08:00";
    iniciarAgendamentoDiario(undefined, agendar);
    assert.deepEqual(tarefas.map((t) => t.expressao), ["0 8 * * *", "0 15 * * *"]);
    tarefas.length = 0;
    process.env.HORARIOS_INFORMATIVO = "05:00,10:00";
    const erro = console.error; console.error = () => {};
    try { iniciarAgendamentoDiario(undefined, agendar); } finally { console.error = erro; }
    assert.equal(tarefas.length, 2, "configuração inválida volta ao padrão autorizado");
  } finally {
    for (const v of variaveis) {
      if (anteriores[v] === undefined) delete process.env[v];
      else process.env[v] = anteriores[v];
    }
  }
});

test("edição das 15h compara com as 08h e COR-Rio segue os mesmos horários", async () => {
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
  await executarHorarioAgendado("08:00", opcoes);
  await executarHorarioAgendado("15:00", opcoes);
  const chamada = chamadas.find((c) => c.horarioAgendado === "15:00" && c.tipoEnvio !== "cor_rio");
  assert.equal(chamada.comparacaoAnterior.grau, "ATENÇÃO");
  assert.ok(estado["2026-09-28|rio_de_janeiro|15:00"]);
  assert.deepEqual(chamadas.filter((c) => c.tipoEnvio === "cor_rio").map((c) => c.horarioAgendado), ["08:00", "15:00"]);
  assert.match(compararComManha({ grau: "NORMAL", vento: "NORMAL", chuva: "NORMAL", fenomenos: [], rajadaMaxKmh: 30 }, { grau: "NORMAL", vento: "NORMAL", chuva: "NORMAL", fenomenos: [], rajadaMaxKmh: 40 }, "15:00").join(" "), /previsão das 08:00 → previsão das 15:00/);
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
  const opcoes = { executar, bases: ["rio_de_janeiro", "macae"], carregar: () => estado, salvar: () => {}, data: "2026-09-28" };
  await executarHorarioAgendado("08:00", opcoes);
  assert.ok(estado["2026-09-28|rio_de_janeiro|08:00"]);
  assert.equal(estado["2026-09-28|cabiunas|08:00"], undefined);
  assert.equal(estado["2026-09-28|macae|05:00"], undefined);
  await executarHorarioAgendado("08:00", opcoes);
  assert.equal(chamadas.filter((c) => c.horarioAgendado === "08:00" && c.cidadeChave === "rio_de_janeiro" && c.tipoEnvio !== "cor_rio").length, 1);
  await executarHorarioAgendado("15:00", opcoes);
  assert.equal(chamadas.find((c) => c.horarioAgendado === "15:00" && c.cidadeChave === "rio_de_janeiro" && c.tipoEnvio !== "cor_rio").comparacaoAnterior.grau, "ATENÇÃO");
  assert.ok(estado["2026-09-28|rio_de_janeiro|15:00"]);
  assert.ok(estado["2026-09-28|cor_rio|08:00"]);
  assert.ok(estado["2026-09-28|cor_rio|15:00"]);
  assert.equal(chamadas.filter((c) => c.tipoEnvio === "cor_rio").length, 2);
  assert.match(compararComManha({ grau: "ATENÇÃO", vento: "ATENÇÃO", chuva: "NORMAL", fenomenos: [], rajadaMaxKmh: 35, precipitacaoTotalMm: 0 }, { grau: "ALERTA", vento: "ALERTA", chuva: "NORMAL", fenomenos: ["ALERTA — VENTO"], rajadaMaxKmh: 48, precipitacaoTotalMm: 0 }).join(" "), /ATENÇÃO → ALERTA/);
});
