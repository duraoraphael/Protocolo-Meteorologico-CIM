const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  verificarAlertas,
  filtrarNovidades,
  marcarAlertasEnviados,
  detectarAlertasGraves,
  ASSINATURA_MONITOR,
} = require("../src/logic/alertWatcher");
const fila = require("../src/logic/alertQueue");
const { processarAlertaBase, iniciarMonitorAlertas } = require("../src/scheduler");
const { CONFIGURACAO_EMAIL } = require("../src/config/email");

function reportComNivel(grau = "ATENÇÃO") {
  return {
    avisosInmet: [],
    severidade: {
      eventos: [{
        assinatura: "chuva",
        tipo: "chuvaIntensa",
        grau,
        descricao: `Chuva em nível ${grau}`,
        fonteDados: "INMET — previsão oficial",
        recomendacoes: [],
      }],
    },
    periodos: {},
    fontesPorCampo: { precipitacaoTotalMm: "INMET — previsão oficial" },
    precipitacaoTotalMm: 50,
    monitoramentoApis: [{ id: "inmet-avisos", status: "operacional" }],
  };
}

function estadoBase(chave, grau = "ATENÇÃO", gravidade = "atencao") {
  return {
    [`${chave}|${ASSINATURA_MONITOR}`]: { inicializadoEm: "2026-10-20T12:00:00.000Z" },
    [`${chave}|chuva`]: { grau, gravidade, tipo: "Chuva", fonteDados: "INMET — previsão oficial" },
  };
}

test("cenário A: somente Macaé alterada produz um evento da própria base", async () => {
  const estado = { ...estadoBase("macae"), ...estadoBase("rio_de_janeiro") };
  const processadas = [];
  const resultado = await verificarAlertas({
    chaves: ["macae", "rio_de_janeiro"],
    carregar: () => estado,
    salvar: () => {},
    montar: async (cidade) => reportComNivel(cidade.chave === "macae" ? "ALERTA" : "ATENÇÃO"),
    onBase: async (base) => processadas.push(base.chave),
  });
  assert.deepEqual(processadas, ["macae"]);
  assert.deepEqual(resultado.porBase.map((base) => base.chave), ["macae"]);
});

test("cenários B e C: duas mudanças são independentes e nenhuma mudança não gera evento", async () => {
  const estado = { ...estadoBase("rio_de_janeiro"), ...estadoBase("santos") };
  const alteradas = await verificarAlertas({
    chaves: ["rio_de_janeiro", "santos"],
    carregar: () => estado,
    salvar: () => {},
    montar: async () => reportComNivel("ALERTA"),
  });
  assert.deepEqual(new Set(alteradas.porBase.map((base) => base.chave)), new Set(["rio_de_janeiro", "santos"]));

  const semMudanca = await verificarAlertas({
    chaves: ["rio_de_janeiro", "santos"],
    carregar: () => ({ ...estadoBase("rio_de_janeiro", "ALERTA", "alto"), ...estadoBase("santos", "ALERTA", "alto") }),
    salvar: () => {},
    montar: async () => reportComNivel("ALERTA"),
  });
  assert.equal(semMudanca.totalNovos, 0);
});

test("cenário D: agravamento de alerta para emergência é comunicado", () => {
  const estado = estadoBase("macae", "ALERTA", "alto");
  const [evento] = filtrarNovidades("macae", [{
    assinatura: "chuva", tipo: "Chuva", grau: "EMERGÊNCIA", gravidade: "severo",
  }], estado);
  assert.deepEqual([evento.grauAnterior, evento.grau, evento.motivo], ["ALERTA", "EMERGÊNCIA", "agravou"]);
});

test("cenário E: falha de fonte preserva o estado e não comunica normalização", async () => {
  const estado = estadoBase("macae", "ALERTA", "alto");
  const antes = JSON.stringify(estado);
  const resultado = await verificarAlertas({
    chaves: ["macae"], carregar: () => estado, salvar: () => {},
    montar: async () => { throw new Error("INMET indisponível"); },
  });
  assert.equal(resultado.totalNovos, 0);
  assert.equal(resultado.falhas.length, 1);
  assert.equal(JSON.stringify(estado), antes);
});

test("cenários F e G: falha permanece pendente e reinício não reenvia evento confirmado", () => {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), "cim-alerta-fila-"));
  const arquivo = path.join(pasta, "fila.json");
  const base = { chave: "macae", cidade: { nome: "Macaé", uf: "RJ" }, alertas: [{ assinatura: "chuva", grau: "ALERTA", gravidade: "alto", motivo: "agravou", fingerprint: "abc" }] };
  try {
    const evento = fila.enfileirar(base, ["macae@exemplo.com"], { arquivo, agora: new Date("2026-10-21T12:00:00Z") });
    assert.ok(fila.assumir(evento.id, { arquivo, agora: new Date("2026-10-21T12:00:01Z") }));
    fila.marcarFalha(evento.id, new Error("SMTP fora do ar"), { arquivo, agora: new Date("2026-10-21T12:00:02Z") });
    assert.equal(fila.carregarFila(arquivo).eventos[evento.id].status, "pendente");
    assert.equal(fila.assumir(evento.id, { arquivo, agora: new Date("2026-10-21T12:04:00Z") }), null);
    assert.ok(fila.assumir(evento.id, { arquivo, agora: new Date("2026-10-21T12:06:00Z") }));
    fila.marcarEnviado(evento.id, { messageId: "smtp-1" }, { arquivo, agora: new Date("2026-10-21T12:06:01Z") });
    assert.equal(fila.enfileirar(base, ["macae@exemplo.com"], { arquivo }).status, "enviado");
    assert.equal(fila.assumir(evento.id, { arquivo, agora: new Date("2026-10-22T12:00:00Z") }), null);
  } finally {
    fs.rmSync(pasta, { recursive: true, force: true });
  }
});

test("cenário H: atualização material do mesmo aviso INMET gera nova versão", () => {
  const relatorio = (risco, atualizadoEm) => ({
    ...reportComNivel("ATENÇÃO"),
    severidade: { eventos: [] },
    avisosInmet: [{
      idAviso: "42", id: "urn:inmet:42.1", sequencia: 1,
      descricao: "Tempestade", severidade: "Perigo", inicio: "21/10/2026 12:00",
      fim: "21/10/2026 18:00", riscos: [risco], instrucoes: ["Busque abrigo."], atualizadoEm,
    }],
  });
  const anterior = detectarAlertasGraves(relatorio("Ventos intensos.", "2026-10-21T11:00:00Z"))
    .find((alerta) => alerta.assinatura === "inmet:tempestade");
  const estado = {};
  const primeiro = filtrarNovidades("santos", [anterior], estado);
  marcarAlertasEnviados({ chave: "santos", alertas: primeiro }, { carregar: () => estado, salvar: () => {} });
  const atual = detectarAlertasGraves(relatorio("Ventos intensos e granizo.", "2026-10-21T12:00:00Z"))
    .find((alerta) => alerta.assinatura === "inmet:tempestade");
  const [mudanca] = filtrarNovidades("santos", [atual], estado);
  assert.equal(mudanca.motivo, "atualizou");
});

test("primeiro ciclo registra linha de base sem disparo em massa", async () => {
  const estado = {};
  const resultado = await verificarAlertas({
    chaves: ["macae"], carregar: () => estado, salvar: () => {}, montar: async () => reportComNivel("EMERGÊNCIA"),
  });
  assert.equal(resultado.totalNovos, 0);
  assert.ok(estado[`macae|${ASSINATURA_MONITOR}`]);
  assert.equal(estado["macae|chuva"].grau, "EMERGÊNCIA");
});

test("processamento usa somente destinatários da base e confirma após SMTP", async () => {
  const base = { chave: "macae", cidade: { nome: "Macaé", uf: "RJ" }, alertas: [{ assinatura: "chuva", grau: "ALERTA", gravidade: "alto" }] };
  let confirmou = false;
  const envio = await processarAlertaBase(base, {
    listar: (chave, opcoes) => {
      assert.equal(chave, "macae");
      assert.equal(opcoes.permitirFallback, false);
      return ["focal.macae@exemplo.com"];
    },
    enfileirar: () => ({ id: "evento-1", status: "pendente" }),
    assumir: () => ({ id: "evento-1", status: "processando" }),
    enviar: async (_base, opcoes) => {
      assert.deepEqual(opcoes.destinatariosOverride, ["focal.macae@exemplo.com"]);
      return { messageId: "smtp-1", destinatarios: opcoes.destinatariosOverride };
    },
    marcarEnviado: () => {},
    marcarFalha: () => assert.fail("não deveria registrar falha"),
    confirmar: () => { confirmou = true; },
  });
  assert.equal(envio.messageId, "smtp-1");
  assert.equal(confirmou, true);
});

test("monitor extraordinário agenda cinco minutos, dia inteiro e sem sobreposição", () => {
  const anterior = { ...CONFIGURACAO_EMAIL };
  const envAnterior = {
    MONITOR_ALERTAS: process.env.MONITOR_ALERTAS,
    INTERVALO_MONITOR_MIN: process.env.INTERVALO_MONITOR_MIN,
    JANELA_MONITOR: process.env.JANELA_MONITOR,
  };
  let chamada;
  try {
    CONFIGURACAO_EMAIL.alertasAutomaticosAtivos = true;
    delete process.env.MONITOR_ALERTAS;
    delete process.env.INTERVALO_MONITOR_MIN;
    delete process.env.JANELA_MONITOR;
    iniciarMonitorAlertas(undefined, (expressao, callback, opcoes) => {
      chamada = { expressao, callback, opcoes };
      return { stop() {} };
    });
    assert.equal(chamada.expressao, "*/5 * * * *");
    assert.equal(chamada.opcoes.timezone, "America/Sao_Paulo");
    assert.equal(chamada.opcoes.noOverlap, true);
  } finally {
    Object.assign(CONFIGURACAO_EMAIL, anterior);
    for (const [chave, valor] of Object.entries(envAnterior)) {
      if (valor === undefined) delete process.env[chave];
      else process.env[chave] = valor;
    }
  }
});
