// Motor de gatilhos meteorológicos: limites, herança de recomendações,
// transições com histerese, persistência, auditoria e renderização.
process.env.GATILHOS_CONFIRMACOES_REDUCAO = "3";
process.env.GATILHOS_MINUTOS_ESTABILIZACAO = "10";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const cheerio = require("cheerio");

const motor = require("../src/logic/motorGatilhos");
const {
  acumularRecomendacoes,
  acumularRecomendacoesPorNivel,
  semDuplicidade,
} = require("../src/logic/recomendacoesCumulativas");
const { RECOMENDACOES, recomendacoes } = require("../src/logic/inmetAlertRules");
const { recomendacoesPorProtocolo } = require("../src/logic/healthProtection");
const {
  ASSINATURA_MONITOR,
  detectarAlertasGraves,
  filtrarNovidades,
  marcarAlertasEnviados,
  verificarAlertas,
} = require("../src/logic/alertWatcher");
const { renderAlertEmailHtml } = require("../src/render/alertEmailTemplate");

const REF = "2026-10-26T12:00:00.000Z";
const ind = (valor, unidade, natureza = "observada", extra = {}) =>
  ({ valor, unidade, fonte: "INMET — estação automática", referenciaEm: REF, natureza, ...extra });
const chuva = (horaria, diaria) => motor.avaliarChuva({
  horaria: horaria === undefined ? undefined : ind(horaria, "mm/h"),
  diaria: diaria === undefined ? undefined : ind(diaria, "mm"),
});
const vento = (observada, prevista) => motor.avaliarVento({
  observada: observada === undefined ? undefined : ind(observada, "km/h"),
  prevista: prevista === undefined ? undefined : ind(prevista, "km/h", "prevista", { fonte: "Open-Meteo" }),
});
const calor = (protocolo, status = "operacional") => motor.avaliarCalor({
  status, protocolo, fonte: "Clima e Saúde — Ministério da Saúde", referenciaEm: REF,
});

// ---------------------------------------------------------------------------
// 1-3. Faixas, fronteiras e valores acima/abaixo dos limites
// ---------------------------------------------------------------------------

test("rajada: fronteiras exatas do protocolo (30, 40, 60 e 60,1 km/h)", () => {
  const casos = [
    [0, "NORMAL"], [29.9, "NORMAL"], [30, "ATENÇÃO"], [39.9, "ATENÇÃO"],
    [40, "ALERTA"], [48, "ALERTA"], [60, "ALERTA"], [60.1, "EMERGÊNCIA"], [95, "EMERGÊNCIA"],
  ];
  for (const [valor, esperado] of casos) {
    assert.equal(vento(valor).grau, esperado, `${valor} km/h`);
  }
});

test("chuva horária: 20, 30, 60 e acima de 60 mm/h", () => {
  const casos = [
    [0, "NORMAL"], [19.9, "NORMAL"], [20, "ATENÇÃO"], [29.9, "ATENÇÃO"],
    [30, "ALERTA"], [60, "ALERTA"], [60.1, "EMERGÊNCIA"],
  ];
  for (const [valor, esperado] of casos) {
    assert.equal(chuva(valor, 0).grau, esperado, `${valor} mm/h`);
  }
});

test("chuva diária: 50, 100 e acima de 100 mm; mínimo de ATENÇÃO preservado e sinalizado como pendência", () => {
  const casos = [
    [10, "NORMAL"], [20, "ATENÇÃO"], [49.9, "ATENÇÃO"], [50, "ALERTA"],
    [100, "ALERTA"], [100.1, "EMERGÊNCIA"],
  ];
  for (const [valor, esperado] of casos) {
    assert.equal(chuva(0, valor).grau, esperado, `${valor} mm/dia`);
  }
  // 20 mm/dia é anterior ao motor e não consta da tabela operacional.
  assert.equal(motor.LIMITES.chuvaDiariaMm.atencao, 20);
});

test("chuva: severidade final é o MAIOR nível, nunca a média", () => {
  const r = chuva(25, 85);
  assert.equal(r.grau, "ALERTA");
  assert.equal(r.gatilho.indicador, "chuvaDiaria");
  assert.deepEqual(r.indicadores.map((i) => i.grau), ["ATENÇÃO", "ALERTA"]);
  assert.equal(chuva(65, 5).grau, "EMERGÊNCIA");
  assert.equal(chuva(5, 120).grau, "EMERGÊNCIA");
});

test("calor: P1/P2/P3 da fonte viram ATENÇÃO/ALERTA/EMERGÊNCIA; sem excesso é NORMAL", () => {
  assert.equal(calor("P1").grau, "ATENÇÃO");
  assert.equal(calor("P2").grau, "ALERTA");
  assert.equal(calor("P3").grau, "EMERGÊNCIA");
  assert.equal(calor(null).grau, "NORMAL");
  assert.equal(calor("P2").gatilho.valor, "P2 — SEVERO");
});

// ---------------------------------------------------------------------------
// 4-5. Herança de recomendações
// ---------------------------------------------------------------------------

test("herança: cada nível soma os anteriores, na ordem operacional", () => {
  for (const fenomeno of ["chuva", "vento"]) {
    const a = RECOMENDACOES[fenomeno]["ATENÇÃO"];
    const l = RECOMENDACOES[fenomeno].ALERTA;
    const e = RECOMENDACOES[fenomeno]["EMERGÊNCIA"];
    assert.deepEqual(recomendacoes(fenomeno, "NORMAL"), []);
    assert.deepEqual(recomendacoes(fenomeno, "ATENÇÃO"), [...a]);
    assert.deepEqual(recomendacoes(fenomeno, "ALERTA"), [...a, ...l]);
    assert.deepEqual(recomendacoes(fenomeno, "EMERGÊNCIA"), [...a, ...l, ...e]);
  }
  assert.equal(recomendacoesPorProtocolo("P1").length, 3);
  assert.equal(recomendacoesPorProtocolo("P2").length, 10);
  assert.equal(recomendacoesPorProtocolo("P3").length, 13);
  assert.deepEqual(recomendacoesPorProtocolo("P3").slice(0, 3), recomendacoesPorProtocolo("P1"));
  assert.deepEqual(recomendacoesPorProtocolo(null), []);
});

test("herança: rajada de 45 km/h = Atenção + Alerta; 65 km/h = os três níveis", () => {
  const r45 = vento(45);
  assert.deepEqual(r45.recomendacoesPorNivel.map((g) => g.nivel), ["ATENÇÃO", "ALERTA"]);
  assert.ok(r45.recomendacoes.includes("Manter o monitoramento durante o dia."));
  assert.ok(!r45.recomendacoes.some((t) => /Evacuar áreas externas/.test(t)));
  const r65 = vento(65);
  assert.deepEqual(r65.recomendacoesPorNivel.map((g) => g.nivel), ["ATENÇÃO", "ALERTA", "EMERGÊNCIA"]);
  assert.ok(r65.recomendacoes.some((t) => /Evacuar áreas externas/.test(t)));
  assert.equal(r65.recomendacoes.length, 1 + 5 + 4);
});

test("textos operacionais da chuva incluem os itens exigidos em cada nível", () => {
  const texto = (grau) => recomendacoes("chuva", grau).join(" | ");
  assert.match(texto("ATENÇÃO"), /comunicação preventiva.*drenagem.*telhados.*abrigo interno/s);
  assert.match(texto("ALERTA"), /Controlar acesso a áreas alagáveis/);
  assert.match(texto("ALERTA"), /prontidão de saúde e equipes de contingência/);
  assert.match(texto("EMERGÊNCIA"), /Evacuar áreas vulneráveis conforme o plano de resposta local/);
  assert.match(texto("EMERGÊNCIA"), /risco elétrico/);
});

test("acúmulo remove duplicidades (acentos/caixa/espaços) preservando a ordem", () => {
  assert.deepEqual(semDuplicidade(["A  b", "a B", "c", "", null, "C"]), ["A  b", "c"]);
  const config = { x: { "ATENÇÃO": ["um", "dois"], ALERTA: ["DOIS", "três"], "EMERGÊNCIA": ["três", "quatro"] } };
  assert.deepEqual(acumularRecomendacoes("x", "EMERGÊNCIA", config), ["um", "dois", "três", "quatro"]);
  assert.deepEqual(acumularRecomendacoesPorNivel("x", "EMERGÊNCIA", config), [
    { nivel: "ATENÇÃO", itens: ["um", "dois"] },
    { nivel: "ALERTA", itens: ["três"] },
    { nivel: "EMERGÊNCIA", itens: ["quatro"] },
  ]);
  assert.deepEqual(acumularRecomendacoes("x", "emergencia", config).length, 4);
  assert.deepEqual(acumularRecomendacoes("x", "NORMAL", config), []);
  for (const fenomeno of ["chuva", "vento"]) {
    const lista = recomendacoes(fenomeno, "EMERGÊNCIA");
    assert.equal(new Set(lista).size, lista.length);
  }
});

// ---------------------------------------------------------------------------
// 9. Dados indisponíveis, validação de unidade/origem/horário
// ---------------------------------------------------------------------------

test("indicador inválido nunca vira zero nem NORMAL", () => {
  const invalidos = [
    [undefined, "ausente"],
    [{ ...ind(null, "km/h") }, "valor"],
    [{ ...ind("", "km/h") }, "valor"],
    [{ ...ind(-3, "km/h") }, "negativo"],
    [{ ...ind(50, "m/s") }, "unidade"],
    [{ ...ind(50, "km/h"), fonte: "" }, "fonte"],
    [{ ...ind(50, "km/h"), fonte: "Indisponível" }, "fonte"],
    [{ ...ind(50, "km/h"), referenciaEm: "ontem" }, "horário"],
    [{ ...ind(50, "km/h"), natureza: "talvez" }, "natureza"],
  ];
  for (const [entrada, parte] of invalidos) {
    const r = motor.validarIndicador(entrada, "km/h");
    assert.equal(r.valido, false, parte);
  }
  const r = motor.avaliarVento({ observada: ind(50, "m/s") });
  assert.equal(r.status, "indisponivel");
  assert.equal(r.grau, null);
});

test("chuva: um indicador crítico basta, mas NORMAL exige os dois critérios", () => {
  const critico = chuva(35, undefined);
  assert.equal(critico.grau, "ALERTA");
  assert.equal(critico.status, "avaliado");
  const incerto = chuva(5, undefined);
  assert.equal(incerto.grau, null);
  assert.equal(incerto.status, "indeterminado");
  assert.match(incerto.motivo, /NORMAL não pode ser declarado/);
  assert.equal(chuva(undefined, undefined).status, "indisponivel");
  assert.equal(chuva(5, 5).grau, "NORMAL");
});

test("calor: cache, falha ou nível desconhecido ficam indisponíveis (não NORMAL)", () => {
  for (const status of ["armazenado", "degradado", "indisponivel"]) {
    const r = calor("P3", status);
    assert.equal(r.status, "indisponivel");
    assert.equal(r.grau, null);
    assert.deepEqual(r.recomendacoes, []);
  }
  assert.equal(calor("P9").grau, null);
  assert.equal(motor.avaliarCalor(undefined).grau, null);
  assert.equal(motor.avaliarCalor({ status: "operacional", protocolo: "P1", referenciaEm: REF }).grau, null);
});

// ---------------------------------------------------------------------------
// Vento: observada x prevista
// ---------------------------------------------------------------------------

test("vento: observada e prevista permanecem separadas; previsão gera alerta preventivo", () => {
  const preventivo = vento(10, 48);
  assert.equal(preventivo.grau, "ALERTA");
  assert.equal(preventivo.preventivo, true);
  assert.equal(preventivo.gatilho.natureza, "prevista");
  assert.equal(preventivo.indicadores.find((i) => i.id === "rajadaObservada").valor, 10);

  const medido = vento(48, 10);
  assert.equal(medido.preventivo, false);
  assert.equal(medido.gatilho.natureza, "observada");

  // empate: a medição local é a base
  assert.equal(vento(45, 45).gatilho.natureza, "observada");
});

test("vento: ausência de rajada observada não zera nem inventa valor", () => {
  const r = vento(undefined, 65);
  assert.equal(r.grau, "EMERGÊNCIA");
  assert.equal(r.indicadores.find((i) => i.id === "rajadaObservada").status, "indisponivel");
  assert.equal(r.indicadores.find((i) => i.id === "rajadaObservada").valor, undefined);
  assert.equal(vento(undefined, undefined).grau, null);
  assert.equal(vento(undefined, 10).grau, "NORMAL");
});

// ---------------------------------------------------------------------------
// 8. Vários fenômenos
// ---------------------------------------------------------------------------

test("localidade: severidade geral = maior; recomendações continuam por fenômeno", () => {
  const r = motor.avaliarLocalidade({
    localidade: "Rio de Janeiro",
    chuva: { horaria: ind(25, "mm/h"), diaria: ind(85, "mm") },
    vento: { observada: ind(65, "km/h") },
    calor: { status: "operacional", protocolo: "P1", fonte: "Clima e Saúde", referenciaEm: REF },
  });
  assert.equal(r.severidadeGeral, "EMERGÊNCIA");
  assert.equal(r.cor, "vermelho");
  assert.deepEqual(
    Object.fromEntries(Object.entries(r.fenomenos).map(([k, f]) => [k, f.grau])),
    { chuva: "ALERTA", vento: "EMERGÊNCIA", calor: "ATENÇÃO" }
  );
  assert.deepEqual(r.fenomenos.chuva.recomendacoesPorNivel.map((g) => g.nivel), ["ATENÇÃO", "ALERTA"]);
  assert.deepEqual(r.fenomenos.vento.recomendacoesPorNivel.map((g) => g.nivel), ["ATENÇÃO", "ALERTA", "EMERGÊNCIA"]);
  assert.deepEqual(r.fenomenos.calor.recomendacoesPorNivel.map((g) => g.nivel), ["ATENÇÃO"]);
  // sem mistura entre fenômenos
  assert.ok(!r.recomendacoesPorFenomeno.chuva.some((t) => /Evacuar áreas externas/.test(t)));
  assert.ok(!r.recomendacoesPorFenomeno.calor.some((t) => /drenagem/.test(t)));
});

test("localidade: fenômeno sem dado não rebaixa os demais nem vira NORMAL", () => {
  const r = motor.avaliarLocalidade({
    localidade: "Macaé",
    chuva: {},
    vento: { observada: ind(45, "km/h") },
    calor: { status: "indisponivel" },
  });
  assert.equal(r.severidadeGeral, "ALERTA");
  assert.equal(r.completa, false);
  assert.equal(r.fenomenos.chuva.grau, null);
  assert.equal(r.fenomenos.calor.grau, null);
  assert.equal(motor.avaliarLocalidade({}).severidadeGeral, null);
});

// ---------------------------------------------------------------------------
// 6. Tipos de transição
// ---------------------------------------------------------------------------

test("tipos de transição cobrem todas as combinações de nível", () => {
  const T = motor.tipoTransicao;
  assert.equal(T("NORMAL", "ATENÇÃO"), "inicio");
  assert.equal(T("NORMAL", "ALERTA"), "inicio");
  assert.equal(T("NORMAL", "EMERGÊNCIA"), "critico");
  assert.equal(T("ATENÇÃO", "ALERTA"), "agravamento");
  assert.equal(T("ATENÇÃO", "EMERGÊNCIA"), "agravamento");
  assert.equal(T("ALERTA", "EMERGÊNCIA"), "agravamento");
  assert.equal(T("EMERGÊNCIA", "ALERTA"), "reducao");
  assert.equal(T("EMERGÊNCIA", "ATENÇÃO"), "reducao");
  assert.equal(T("ALERTA", "ATENÇÃO"), "reducao");
  assert.equal(T("ATENÇÃO", "NORMAL"), "normalizacao");
  assert.equal(T("ALERTA", "NORMAL"), "normalizacao");
  assert.equal(T("EMERGÊNCIA", "NORMAL"), "normalizacao");
  assert.equal(T("ALERTA", "ALERTA"), null);
  assert.equal(T(null, "NORMAL"), null);
});

// ---------------------------------------------------------------------------
// Histerese
// ---------------------------------------------------------------------------

const minutos = (n) => new Date(Date.UTC(2026, 9, 26, 12, n));
const CFG = { leituras: 3, minutos: 10 };

test("histerese: redução exige N leituras válidas e tempo mínimo; elevação é imediata", () => {
  let vigente = { grau: "EMERGÊNCIA" };
  const leitura = (grau) => ({ grau, valida: true, alerta: { grau } });
  let d = motor.decidirReducao(vigente, leitura("ALERTA"), minutos(0), CFG);
  assert.equal(d.confirmar, false);
  assert.equal(d.pendencia.leituras, 1);
  vigente = { ...vigente, reducaoPendente: d.pendencia };
  d = motor.decidirReducao(vigente, leitura("ALERTA"), minutos(5), CFG);
  vigente = { ...vigente, reducaoPendente: d.pendencia };
  assert.equal(d.confirmar, false);
  // 3 leituras, mas só 8 min: ainda não
  d = motor.decidirReducao(vigente, leitura("ALERTA"), minutos(8), CFG);
  assert.equal(d.confirmar, false);
  vigente = { ...vigente, reducaoPendente: d.pendencia };
  d = motor.decidirReducao(vigente, leitura("ALERTA"), minutos(11), CFG);
  assert.equal(d.confirmar, true);
  assert.equal(d.alvo.grauAlvo, "ALERTA");

  // uma leitura igual/maior ao vigente cancela a estabilização
  const cancelada = motor.decidirReducao(vigente, leitura("EMERGÊNCIA"), minutos(12), CFG);
  assert.equal(cancelada.pendencia, null);
});

test("histerese: destino é o maior nível visto na janela; leitura inválida não conta nem zera", () => {
  let vigente = { grau: "EMERGÊNCIA" };
  const passo = (leitura, t) => {
    const d = motor.decidirReducao(vigente, leitura, minutos(t), CFG);
    vigente = { ...vigente, reducaoPendente: d.pendencia };
    return d;
  };
  passo({ grau: "ALERTA", valida: true, alerta: { grau: "ALERTA" } }, 0);
  const invalida = passo({ grau: "NORMAL", valida: false }, 4);
  assert.equal(invalida.pendencia.leituras, 1);
  passo({ grau: "NORMAL", valida: true }, 6);
  const final = passo({ grau: "NORMAL", valida: true }, 12);
  assert.equal(final.confirmar, true);
  assert.equal(final.alvo.grauAlvo, "ALERTA");
});

// ---------------------------------------------------------------------------
// 7, 10, 11, 13. Ciclo completo no monitor (estado persistido em arquivo)
// ---------------------------------------------------------------------------

function ambiente() {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), "cim-gatilhos-"));
  const arquivoEstado = path.join(pasta, "estado.json");
  const arquivoHistorico = path.join(pasta, "historico.jsonl");
  process.env.GATILHOS_HISTORICO_ARQUIVO = arquivoHistorico;
  const carregar = () => {
    try { return JSON.parse(fs.readFileSync(arquivoEstado, "utf-8")); }
    catch (erro) { if (erro.code === "ENOENT") return {}; throw erro; }
  };
  const salvar = (estado) => fs.writeFileSync(arquivoEstado, JSON.stringify(estado), "utf-8");
  return {
    pasta, carregar, salvar, arquivoHistorico,
    limpar() { delete process.env.GATILHOS_HISTORICO_ARQUIVO; fs.rmSync(pasta, { recursive: true, force: true }); },
  };
}

function relatorioVento(rajadaObservada, rajadaPrevista = null) {
  return {
    avisosInmet: [],
    geradoEmISO: REF,
    rajadaMaxKmh: rajadaPrevista,
    rajadaObservadaMaxKmh: rajadaObservada,
    precipitacaoHorariaMaxMm: 0,
    precipitacaoTotalMm: 0,
    periodos: {},
    fontesPorCampo: {
      rajadaMaxKmh: "Open-Meteo — previsão complementar",
      rajadaObservadaMaxKmh: "INMET — estação automática (observado)",
      precipitacaoHorariaMaxMm: "INMET — estação automática (observado)",
      precipitacaoTotalMm: "INMET — estação automática (observado)",
    },
    monitoramentoApis: [{ id: "inmet-avisos", status: "operacional" }],
  };
}

test("ciclo completo do vento por localidade: elevações imediatas, reduções confirmadas, sem duplicidade", async () => {
  const amb = ambiente();
  try {
    let valor = 0;
    let instante = 0;
    const enviados = [];
    const rodar = async (v, t, chaves = ["macae"]) => {
      valor = v; instante = t;
      const antes = enviados.length;
      await verificarAlertas({
        chaves, carregar: amb.carregar, salvar: amb.salvar, auditar: true,
        montar: async () => relatorioVento(valor),
        onBase: async (base) => {
          marcarAlertasEnviados(base, { carregar: amb.carregar, salvar: amb.salvar, auditar: true });
          enviados.push(...base.alertas.map((a) => ({ chave: a.chaveEstado, de: a.grauAnterior || "NORMAL", para: a.grau, tipo: a.transicao, recs: a.recomendacoes?.length || 0 })));
        },
        agora: () => new Date(Date.UTC(2026, 9, 26, 12, instante)),
      });
      return enviados.slice(antes);
    };
    // 1ª passagem só registra a linha de base (nenhum alerta retroativo)
    assert.deepEqual(await rodar(0, 0), []);

    assert.deepEqual((await rodar(35, 1)).map((e) => [e.de, e.para, e.tipo]), [["NORMAL", "ATENÇÃO", "inicio"]]);
    assert.deepEqual(await rodar(36, 2), [], "mesmo nível: sem notificação duplicada");
    assert.deepEqual((await rodar(62, 3)).map((e) => [e.de, e.para, e.tipo, e.recs]), [["ATENÇÃO", "EMERGÊNCIA", "agravamento", 10]]);
    assert.deepEqual(await rodar(70, 4), []);

    // Redução: precisa de 3 leituras e 10 min; leituras isoladas não notificam
    assert.deepEqual(await rodar(45, 5), []);
    assert.deepEqual(await rodar(45, 8), []);
    assert.deepEqual(await rodar(45, 16), [{ chave: "macae|vento", de: "EMERGÊNCIA", para: "ALERTA", tipo: "reducao", recs: 6 }]);

    // Normalização: janela nova, destino NORMAL, recomendações encerradas
    assert.deepEqual(await rodar(5, 20), []);
    assert.deepEqual(await rodar(5, 25), []);
    const norm = await rodar(5, 31);
    assert.deepEqual(norm.map((e) => [e.de, e.para, e.tipo, e.recs]), [["ALERTA", "NORMAL", "normalizacao", 0]]);
    assert.deepEqual(await rodar(5, 40), []);

    // Auditoria: uma linha por notificação enviada, na ordem
    const historico = motor.lerHistorico({ arquivo: amb.arquivoHistorico });
    const enviadosLog = historico.filter((h) => h.evento === "notificacao_enviada");
    assert.deepEqual(enviadosLog.map((h) => h.transicao), ["inicio", "agravamento", "reducao", "normalizacao"]);
    assert.ok(enviadosLog.every((h) => h.fenomeno === "vento" && h.localidade === "macae"));
    assert.ok(historico.some((h) => h.evento === "reducao_aguardando_confirmacao"));
    assert.ok(historico.some((h) => h.evento === "reducao_confirmada"));
    assert.equal(enviadosLog[1].gatilho.valores.rajadaKmh, 62);
    assert.equal(enviadosLog[1].gatilho.unidade, "km/h");
  } finally {
    amb.limpar();
  }
});

test("NORMAL -> EMERGÊNCIA dispara notificação crítica imediata com recomendações cumulativas", async () => {
  const amb = ambiente();
  try {
    amb.salvar({ "macae|__monitor_inicializado__": { inicializadoEm: REF } });
    const recebidos = [];
    await verificarAlertas({
      chaves: ["macae"], carregar: amb.carregar, salvar: amb.salvar,
      montar: async () => relatorioVento(75),
      onBase: async (base) => recebidos.push(...base.alertas),
    });
    assert.equal(recebidos.length, 1);
    const [alerta] = recebidos;
    assert.equal(alerta.transicao, "critico");
    assert.equal(alerta.grau, "EMERGÊNCIA");
    assert.deepEqual(alerta.recomendacoesPorNivel.map((g) => g.nivel), ["ATENÇÃO", "ALERTA", "EMERGÊNCIA"]);
    assert.equal(alerta.valorGatilho.natureza, "observada");
    assert.equal(alerta.preventivo, false);
  } finally {
    amb.limpar();
  }
});

test("falha de API não normaliza, não conta leitura e preserva a estabilização", async () => {
  const amb = ambiente();
  try {
    amb.salvar({
      "macae|__monitor_inicializado__": { inicializadoEm: REF },
      "macae|vento": { grau: "ALERTA", gravidade: "alto", tipo: "Vento", fonteDados: "x", reducaoPendente: { desde: REF, leituras: 2, grauAlvo: "ATENÇÃO", ultimaLeituraEm: REF } },
    });
    // Exceção ao montar o relatório
    const falha = await verificarAlertas({
      chaves: ["macae"], carregar: amb.carregar, salvar: amb.salvar,
      montar: async () => { throw new Error("INMET fora do ar"); },
    });
    assert.equal(falha.totalNovos, 0);
    assert.equal(falha.falhas.length, 1);
    // Relatório sem rajada alguma (fonte indisponível): sem leitura válida
    const semDado = await verificarAlertas({
      chaves: ["macae"], carregar: amb.carregar, salvar: amb.salvar,
      montar: async () => relatorioVento(null, null),
    });
    assert.equal(semDado.totalNovos, 0);
    const estado = amb.carregar();
    assert.equal(estado["macae|vento"].grau, "ALERTA");
    assert.equal(estado["macae|vento"].reducaoPendente.leituras, 2);
  } finally {
    amb.limpar();
  }
});

test("persistência: a janela de estabilização sobrevive ao reinício do servidor", async () => {
  const amb = ambiente();
  try {
    amb.salvar({
      "macae|__monitor_inicializado__": { inicializadoEm: REF },
      "macae|vento": { grau: "ALERTA", gravidade: "alto", tipo: "Vento", fonteDados: "x" },
    });
    const semNotificar = async (t) => verificarAlertas({
      chaves: ["macae"], carregar: amb.carregar, salvar: amb.salvar,
      montar: async () => relatorioVento(5),
      agora: () => new Date(Date.UTC(2026, 9, 26, 12, t)),
    });
    await semNotificar(0);
    assert.equal(amb.carregar()["macae|vento"].reducaoPendente.leituras, 1);
    // "reinício": nada em memória, só o arquivo
    delete require.cache[require.resolve("../src/logic/alertWatcher")];
    const recarregado = require("../src/logic/alertWatcher");
    const novos = [];
    for (const t of [5, 12]) {
      await recarregado.verificarAlertas({
        chaves: ["macae"], carregar: amb.carregar, salvar: amb.salvar,
        montar: async () => relatorioVento(5),
        onBase: async (base) => novos.push(...base.alertas),
        agora: () => new Date(Date.UTC(2026, 9, 26, 12, t)),
      });
    }
    assert.deepEqual(novos.map((a) => [a.grauAnterior, a.grau, a.transicao]), [["ALERTA", "NORMAL", "normalizacao"]]);
  } finally {
    amb.limpar();
  }
});

test("localidades e fenômenos têm estado independente (chuva em Macaé não altera vento no Rio)", () => {
  const estado = {
    "macae|chuva": { grau: "ALERTA", gravidade: "alto", tipo: "Chuva" },
    "rio_de_janeiro|vento": { grau: "ATENÇÃO", gravidade: "atencao", tipo: "Vento" },
  };
  const opcoes = { agora: minutos(0), confirmacao: { leituras: 1, minutos: 0 } };
  const macae = filtrarNovidades("macae", [], estado, () => true, opcoes);
  assert.deepEqual(macae.map((a) => a.assinatura), ["chuva"]);
  const rio = filtrarNovidades("rio_de_janeiro", [{ assinatura: "vento", grau: "ALERTA", gravidade: "alto" }], estado, () => true, opcoes);
  assert.deepEqual(rio.map((a) => [a.assinatura, a.transicao]), [["vento", "agravamento"]]);
});

test("normalização de chuva só ocorre com os dois critérios disponíveis", async () => {
  const amb = ambiente();
  try {
    amb.salvar({
      "macae|__monitor_inicializado__": { inicializadoEm: REF },
      "macae|chuva": { grau: "ALERTA", gravidade: "alto", tipo: "Chuva", fonteDados: "x" },
    });
    const r = { ...relatorioVento(0), precipitacaoHorariaMaxMm: 0, precipitacaoTotalMm: null };
    const res = await verificarAlertas({
      chaves: ["macae"], carregar: amb.carregar, salvar: amb.salvar,
      montar: async () => r,
      agora: () => minutos(0),
    });
    assert.equal(res.totalNovos, 0);
    assert.equal(amb.carregar()["macae|chuva"].reducaoPendente, undefined);
  } finally {
    amb.limpar();
  }
});

// ---------------------------------------------------------------------------
// Detecção a partir de relatórios reais e renderização
// ---------------------------------------------------------------------------

test("detecção: rajada observada gera alerta; previsão gera alerta preventivo identificado", () => {
  const observado = detectarAlertasGraves(relatorioVento(48, 10)).find((a) => a.assinatura === "vento");
  assert.equal(observado.grau, "ALERTA");
  assert.equal(observado.preventivo, false);
  assert.match(observado.detalhe, /Rajada medida pela estação INMET: 48 km\/h/);
  assert.match(observado.fonteDados, /INMET/);
  assert.equal(observado.valorGatilho.unidade, "km/h");

  const preventivo = detectarAlertasGraves(relatorioVento(12, 48)).find((a) => a.assinatura === "vento");
  assert.equal(preventivo.grau, "ALERTA");
  assert.equal(preventivo.preventivo, true);
  assert.match(preventivo.detalhe, /Rajada prevista \(alerta preventivo\): 48 km\/h/);
  assert.match(preventivo.detalhe, /Rajada observada na estação INMET: 12 km\/h/);
  assert.doesNotMatch(preventivo.detalhe, /medida pela estação/);
  assert.match(preventivo.fonteDados, /Open-Meteo/);

  assert.equal(detectarAlertasGraves(relatorioVento(10, 12)).some((a) => a.assinatura === "vento"), false);
});

test("e-mail do alerta mostra recomendações agrupadas por nível e não antecipa o nível seguinte", () => {
  const report = relatorioVento(48);
  const alerta = detectarAlertasGraves(report).find((a) => a.assinatura === "vento");
  const html = renderAlertEmailHtml({ cidade: { nome: "Macaé", uf: "RJ" }, report, alertas: [{ ...alerta, motivo: "novo" }] });
  const $ = cheerio.load(html);
  assert.deepEqual($("[data-alert-recommendation-level]").map((_, el) => $(el).attr("data-alert-recommendation-level")).get(), ["ATENÇÃO", "ALERTA"]);
  assert.match($.root().text(), /Manter o monitoramento durante o dia/);
  assert.match($.root().text(), /Paralisar atividades externas gerais/);
  assert.doesNotMatch($.root().text(), /Evacuar áreas externas/);
  assert.match($.root().text(), /VENTO — ALERTA/);
});

test("emergência de vento no e-mail traz os três níveis de recomendações", () => {
  const report = relatorioVento(75);
  const alerta = detectarAlertasGraves(report).find((a) => a.assinatura === "vento");
  const html = renderAlertEmailHtml({ cidade: { nome: "Macaé", uf: "RJ" }, report, alertas: [{ ...alerta, motivo: "novo" }] });
  const $ = cheerio.load(html);
  assert.deepEqual($("[data-alert-recommendation-level]").map((_, el) => $(el).attr("data-alert-recommendation-level")).get(), ["ATENÇÃO", "ALERTA", "EMERGÊNCIA"]);
  assert.match($.root().text(), /Evacuar áreas externas conforme os procedimentos locais/);
});

test("normalização no e-mail não mantém recomendações emergenciais", () => {
  const report = relatorioVento(5);
  const normalizacao = filtrarNovidades("macae", [], {
    "macae|vento": { grau: "EMERGÊNCIA", gravidade: "severo", tipo: "Vento", fonteDados: "x" },
  }, () => true, { agora: minutos(0), confirmacao: { leituras: 1, minutos: 0 } });
  assert.equal(normalizacao.length, 1);
  const html = renderAlertEmailHtml({ cidade: { nome: "Macaé", uf: "RJ" }, report, alertas: normalizacao });
  assert.match(html, /NORMALIZAÇÃO DAS CONDIÇÕES METEOROLÓGICAS/);
  assert.doesNotMatch(html, /Evacuar áreas externas|data-alert-recommendation-level/);
});

test("alerta de calor usa P1/P2/P3 da fonte e herança de P1 em P2", () => {
  const report = {
    ...relatorioVento(0),
    climaSaude: {
      status: "operacional",
      dados: {
        source: "Clima e Saúde — Ministério da Saúde",
        consultadoEm: REF,
        ehf: { classificacao: "Severo", valor: 2.1 },
        riscoCombinado: "Alto",
        nivel: { grau: "ALERTA", protocolo: "P2", gravidade: "alto", significado: "x" },
        recomendacoes: recomendacoesPorProtocolo("P2"),
      },
    },
  };
  const calorAlerta = detectarAlertasGraves(report).find((a) => a.assinatura === "calor-ehf");
  assert.equal(calorAlerta.grau, "ALERTA");
  assert.equal(calorAlerta.valorGatilho.valor, "P2");
  assert.deepEqual(calorAlerta.recomendacoesPorNivel.map((g) => g.nivel), ["ATENÇÃO", "ALERTA"]);
  assert.equal(calorAlerta.recomendacoes.length, 10);
});

test("calor com fonte não operacional não gera alerta nem normaliza", () => {
  const report = {
    ...relatorioVento(0),
    climaSaude: { status: "armazenado", dados: { nivel: { grau: "EMERGÊNCIA", protocolo: "P3", gravidade: "severo" } } },
  };
  assert.equal(detectarAlertasGraves(report).some((a) => a.assinatura === "calor-ehf"), false);
  const novos = filtrarNovidades("macae", [], {
    "macae|calor-ehf": { grau: "ALERTA", gravidade: "alto", tipo: "Calor", fonteDados: "Clima" },
  }, (assinatura) => assinatura !== "calor-ehf", { agora: minutos(0), confirmacao: { leituras: 1, minutos: 0 } });
  assert.deepEqual(novos, []);
});

test("regressão: ASSINATURA_MONITOR e limites oficiais permanecem inalterados", () => {
  assert.equal(ASSINATURA_MONITOR, "__monitor_inicializado__");
  assert.deepEqual({ ...motor.LIMITES.rajadaKmh }, { atencao: 30, alerta: 40, emergenciaAcimaDe: 60 });
  assert.deepEqual({ ...motor.LIMITES.chuvaHorariaMmH }, { atencao: 20, alerta: 30, emergenciaAcimaDe: 60 });
  assert.equal(motor.LIMITES.chuvaDiariaMm.alerta, 50);
  assert.equal(motor.LIMITES.chuvaDiariaMm.emergenciaAcimaDe, 100);
});

test("disparo efetivo: monitor -> fila -> envio -> estado; mesmo nível não reenvia e reinício não duplica", async () => {
  const fila = require("../src/logic/alertQueue");
  const { processarAlertaBase } = require("../src/scheduler");
  const amb = ambiente();
  const arquivoFila = path.join(amb.pasta, "fila.json");
  const emails = [];
  const opcoesFila = { arquivo: arquivoFila };
  const processar = (base) => processarAlertaBase(base, {
    listar: () => ["ponto.focal@exemplo.com"],
    enfileirar: (b, d) => fila.enfileirar(b, d, opcoesFila),
    assumir: (id) => fila.assumir(id, opcoesFila),
    marcarEnviado: (id, envio) => fila.marcarEnviado(id, envio, opcoesFila),
    marcarFalha: (id, erro) => fila.marcarFalha(id, erro, opcoesFila),
    enviar: async (b, o) => {
      const html = renderAlertEmailHtml(b);
      emails.push({ para: o.destinatariosOverride, html, alertas: b.alertas.map((a) => `${a.assinatura}:${a.grau}:${a.transicao}`) });
      return { messageId: `smtp-${emails.length}`, destinatarios: o.destinatariosOverride };
    },
    confirmar: (b) => marcarAlertasEnviados(b, { carregar: amb.carregar, salvar: amb.salvar, auditar: true }),
  });
  const ciclo = (valor) => verificarAlertas({
    chaves: ["macae"], carregar: amb.carregar, salvar: amb.salvar, auditar: true,
    montar: async () => relatorioVento(valor),
    onBase: processar,
  });
  try {
    await ciclo(0); // linha de base
    await ciclo(45);
    assert.deepEqual(emails.map((e) => e.alertas), [["vento:ALERTA:inicio"]]);
    assert.deepEqual(emails[0].para, ["ponto.focal@exemplo.com"]);
    assert.match(cheerio.load(emails[0].html).text(), /VENTO — ALERTA/);

    await ciclo(46);
    await ciclo(47);
    assert.equal(emails.length, 1, "nível inalterado não reenvia");

    // "Reinício": fila e estado só em arquivo; mesma condição não reenvia
    await ciclo(48);
    assert.equal(emails.length, 1);

    await ciclo(65);
    assert.deepEqual(emails.map((e) => e.alertas.join()), ["vento:ALERTA:inicio", "vento:EMERGÊNCIA:agravamento"]);
    const fila2 = JSON.parse(fs.readFileSync(arquivoFila, "utf-8"));
    assert.equal(Object.keys(fila2.eventos).length, 2);
    assert.ok(Object.values(fila2.eventos).every((e) => e.status === "enviado"));
  } finally {
    amb.limpar();
  }
});
