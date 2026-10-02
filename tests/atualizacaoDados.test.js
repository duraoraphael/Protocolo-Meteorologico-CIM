const test = require("node:test");
const assert = require("node:assert/strict");
const { criarAtualizadorDados, intervaloAtualizacaoMin } = require("../src/logic/atualizacaoDados");
const { iniciarAtualizacaoAutomatica } = require("../src/scheduler");

const silencioso = { log() {}, warn() {}, error() {} };
const RIO = { chave: "rio_de_janeiro", nome: "Rio de Janeiro" };
const MACAE = { chave: "macae", nome: "Macaé" };

function relatorio(cidade, iso) {
  return { cidade: { chave: cidade.chave }, geradoEmISO: iso, horaConsulta: iso.slice(11, 16), avisosColeta: [] };
}

function relogio(inicioISO) {
  let atual = Date.parse(inicioISO);
  return { agora: () => atual, avancar: (ms) => { atual += ms; } };
}

test("intervalo padrão é 30 min e valores inválidos voltam para 30", () => {
  assert.equal(intervaloAtualizacaoMin(undefined), 30);
  assert.equal(intervaloAtualizacaoMin("15"), 15);
  assert.equal(intervaloAtualizacaoMin("7"), 30);
  assert.equal(intervaloAtualizacaoMin("abc"), 30);
});

test("cache dentro do intervalo não consulta as APIs de novo", async () => {
  const r = relogio("2026-10-02T13:00:00.000Z");
  let chamadas = 0;
  const atualizador = criarAtualizadorDados({
    intervaloMs: 30 * 60000, agora: r.agora, logger: silencioso,
    montar: async (c) => { chamadas += 1; return relatorio(c, new Date(r.agora()).toISOString()); },
  });
  await atualizador.obter(RIO);
  r.avancar(29 * 60000);
  const resposta = await atualizador.obter(RIO);
  assert.equal(chamadas, 1);
  assert.equal(resposta.pendente, false);
  assert.equal(resposta.consultadoEmISO, "2026-10-02T13:00:00.000Z");
  r.avancar(2 * 60000);
  await atualizador.obter(RIO);
  assert.equal(chamadas, 2, "vencido o intervalo, busca dados novos");
});

test("falha mantém os últimos dados válidos, não altera o horário e marca pendente", async () => {
  const r = relogio("2026-10-02T13:00:00.000Z");
  let falhar = false;
  const atualizador = criarAtualizadorDados({
    intervaloMs: 30 * 60000, agora: r.agora, logger: silencioso,
    montar: async (c) => {
      if (falhar) throw new Error("APIs indisponíveis");
      return relatorio(c, new Date(r.agora()).toISOString());
    },
  });
  await atualizador.atualizarTodas([RIO]);
  falhar = true;
  r.avancar(30 * 60000);
  await atualizador.atualizarTodas([RIO]);
  const resposta = await atualizador.obter(RIO);
  assert.equal(resposta.report.geradoEmISO, "2026-10-02T13:00:00.000Z");
  assert.equal(resposta.consultadoEmISO, "2026-10-02T13:00:00.000Z");
  assert.equal(resposta.pendente, true);

  falhar = false;
  r.avancar(30 * 60000);
  await atualizador.atualizarTodas([RIO]);
  const recuperado = await atualizador.obter(RIO);
  assert.equal(recuperado.pendente, false);
  assert.equal(recuperado.consultadoEmISO, "2026-10-02T14:00:00.000Z");
});

test("horário muda a cada consulta bem-sucedida mesmo com valores iguais", async () => {
  const r = relogio("2026-10-02T13:00:00.000Z");
  const atualizador = criarAtualizadorDados({
    intervaloMs: 30 * 60000, agora: r.agora, logger: silencioso,
    montar: async (c) => ({ ...relatorio(c, new Date(r.agora()).toISOString()), tempMax: 30 }),
  });
  await atualizador.atualizarTodas([RIO]);
  r.avancar(30 * 60000);
  await atualizador.atualizarTodas([RIO]);
  assert.equal((await atualizador.obter(RIO)).report.horaConsulta, "13:30");
});

test("ciclo não se sobrepõe e consultas da mesma base são compartilhadas", async () => {
  let liberar;
  const bloqueio = new Promise((resolve) => { liberar = resolve; });
  let chamadas = 0;
  const atualizador = criarAtualizadorDados({
    logger: silencioso,
    montar: async (c) => { chamadas += 1; await bloqueio; return relatorio(c, new Date().toISOString()); },
  });
  const primeiro = atualizador.atualizarTodas([RIO, MACAE]);
  const sobreposto = await atualizador.atualizarTodas([RIO, MACAE]);
  assert.equal(sobreposto, null);
  const pedidoPainel = atualizador.obter(RIO); // junta-se à consulta em andamento
  liberar();
  await Promise.all([primeiro, pedidoPainel]);
  assert.equal(chamadas, 2);
});

test("agendador usa o intervalo configurado e executa só a coleta", async () => {
  const agendados = [];
  const ciclos = [];
  const atualizador = {
    intervaloMs: 30 * 60000,
    atualizarTodas: async (cidades, origem) => { ciclos.push({ total: cidades.length, origem }); },
  };
  const logOriginal = console.log;
  console.log = () => {};
  try {
    iniciarAtualizacaoAutomatica(atualizador, (expressao, tarefa, opcoes) => {
      agendados.push({ expressao, tarefa, opcoes });
      return {};
    });
  } finally {
    console.log = logOriginal;
  }
  assert.equal(agendados.length, 1);
  assert.equal(agendados[0].expressao, "*/30 * * * *");
  assert.equal(agendados[0].opcoes.timezone, "America/Sao_Paulo");
  await agendados[0].tarefa();
  assert.deepEqual(ciclos.map((c) => c.origem), ["inicial", "agendado"]);
});
