const test = require("node:test");
const assert = require("node:assert/strict");

const { executarVerificacao, camposFaltando, situacaoDoErro, SITUACAO } = require("../src/logic/verificacaoFontes");
const { renderVerificacaoHtml, destinatariosVerificacao, enviarVerificacaoFontes } = require("../src/email/sendVerificacaoFontes");
const { executarVerificacaoFontes } = require("../src/scheduler");
const { getCidade } = require("../src/config/cities");
const climaSaude = require("../src/sources/climaSaudeService");
const { criarServicoCorRio } = require("../src/sources/corRio");

const RIO = getCidade("rio_de_janeiro");
const PERIODO = { resumo: "Poucas nuvens", tempMax: 31, tempMin: 20 };
const semEspera = async () => {};

function json(corpo, status = 200) {
  return new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } });
}

function fetchCorRio(url) {
  if (url.includes("estagio_cidade")) return Promise.resolve(json({ estagio: "Estágio 1", inicio: "2026-10-13T10:00:00" }));
  if (url.includes("calor_api")) return Promise.resolve(json("calor 1"));
  return Promise.resolve(json([]));
}

function fetchAna(comp) {
  return async (url) => {
    const mes = Number(new URL(url).searchParams.get("mes"));
    const ano = Number(new URL(url).searchParams.get("ano"));
    if (mes !== comp.mes || ano !== comp.ano) return json({ data: { list: [] } });
    return json({ data: { list: [{ id: 1, mes, ano, final: true, nome: comp.rotulo.replace("/", " de ") }] } });
  };
}

// Fontes saudáveis; cada teste troca só a que quer quebrar.
function fontesOk(extra = {}) {
  const { competenciaConfigurada } = require("../src/sources/monitorSecas");
  return {
    openMeteo: async () => ({ atual: { temperaturaC: 23 }, tempMin: 22, tempMax: 28, precipitacaoTotalMm: 0.8, rajadaMaxKmh: 31 }),
    qualidadeAr: async () => ({ uvMax: 9, pm25Medio: 35 }),
    mar: async () => ({ alturaMaxDiaM: 1.1, temperaturaMarC: 26.9 }),
    avisosInmet: async () => ({ avisos: [] }),
    previsaoInmet: async () => ({ data: "13/10/2026", periodos: { manha: PERIODO, tarde: PERIODO, noite: PERIODO } }),
    climaSaude: async () => ({ status: "operacional", dados: { dataConsulta: "2026-10-13", ehf: { classificacao: "Sem excesso" }, riscoCombinado: "Normal" } }),
    corRio: (opcoes) => criarServicoCorRio({ ...opcoes, fetchImpl: fetchCorRio, esperarFn: semEspera }),
    fetch: fetchAna(competenciaConfigurada()),
    ...extra,
  };
}

function itemDe(resultado, fonte) {
  return resultado.itens.find((i) => i.fonte === fonte);
}

test("todas as fontes saudáveis: nenhum problema; integrações sem configuração não contam como problema", async () => {
  const r = await executarVerificacao({ cidades: [RIO], env: {}, fontes: fontesOk() });
  assert.deepEqual(r.problemas, []);
  assert.equal(itemDe(r, "Oceanop").situacao, SITUACAO.NAO_CONFIGURADA);
  assert.equal(itemDe(r, "Licença Open-Meteo").situacao, SITUACAO.NAO_CONFIGURADA);
});

test("Clima e Saúde com layout alterado é classificado como formato alterado, não como fora do ar", async () => {
  const fetchFn = async () => new Response("<html><body><h1>Nova página</h1></body></html>", { status: 200 });
  const consultar = (cidade, opcoes) => climaSaude.consultar(cidade, {
    ...opcoes, fetchFn, tentativas: 1, carregar: () => ({}), salvar: () => {},
  });
  const r = await executarVerificacao({ cidades: [RIO], env: {}, fontes: fontesOk({ climaSaude: consultar }) });
  const item = itemDe(r, "Clima e Saúde");
  assert.equal(item.situacao, SITUACAO.FORMATO_ALTERADO);
  assert.match(item.detalhe, /layout mudou/);
});

test("Clima e Saúde fora do ar é indisponível e informa se há última coleta válida", async () => {
  const fetchFn = async () => new Response("erro", { status: 503 });
  const consultar = (cidade, opcoes) => climaSaude.consultar(cidade, {
    ...opcoes, fetchFn, tentativas: 1, salvar: () => {},
    carregar: () => ({ [cidade.chave]: { consultadoEm: "2026-10-13T08:00:00.000Z" } }),
  });
  const r = await executarVerificacao({ cidades: [RIO], env: {}, fontes: fontesOk({ climaSaude: consultar }) });
  const item = itemDe(r, "Clima e Saúde");
  assert.equal(item.situacao, SITUACAO.INDISPONIVEL);
  assert.match(item.detalhe, /última coleta válida de 13\/10\/2026 05:00/);
});

test("COR-Rio com resposta fora do formato aponta a parte afetada", async () => {
  const fetchImpl = (url) => (url.includes("calor_api") ? Promise.resolve(json({ inesperado: true })) : fetchCorRio(url));
  const corRio = (opcoes) => criarServicoCorRio({ ...opcoes, fetchImpl, esperarFn: semEspera });
  const r = await executarVerificacao({ cidades: [RIO], env: {}, fontes: fontesOk({ corRio }) });
  assert.equal(itemDe(r, "COR-Rio (estágio de calor)").situacao, SITUACAO.FORMATO_ALTERADO);
  assert.equal(itemDe(r, "COR-Rio (estágio operacional)").situacao, SITUACAO.OK);
});

test("INMET sem temperatura de um período gera campos ausentes; rajada e chuva não são exigidas", async () => {
  const previsaoInmet = async () => ({ periodos: { manha: PERIODO, tarde: { ...PERIODO, tempMax: null }, noite: PERIODO } });
  const r = await executarVerificacao({ cidades: [RIO], env: {}, fontes: fontesOk({ previsaoInmet }) });
  const item = itemDe(r, "INMET Previsão");
  assert.equal(item.situacao, SITUACAO.CAMPOS_AUSENTES);
  assert.match(item.detalhe, /temperatura máxima \(tarde\)/);
  assert.doesNotMatch(item.detalhe, /rajada|chuva/);
});

test("falha de DNS vira indisponível; licença Open-Meteo ausente em produção vira bloqueada", async () => {
  const dns = Object.assign(new Error("Open-Meteo: falha de resolução DNS"), { tipo: "dns" });
  const licenca = Object.assign(new Error("OPEN_METEO_API_KEY é obrigatória"), { code: "OPEN_METEO_COMMERCIAL_LICENSE_REQUIRED" });
  const r = await executarVerificacao({
    cidades: [RIO],
    env: { NODE_ENV: "production" },
    fontes: fontesOk({ openMeteo: async () => { throw licenca; }, mar: async () => { throw dns; } }),
  });
  assert.equal(itemDe(r, "Open-Meteo Weather").situacao, SITUACAO.BLOQUEADA);
  assert.equal(itemDe(r, "Open-Meteo Marine").situacao, SITUACAO.INDISPONIVEL);
  assert.equal(itemDe(r, "Licença Open-Meteo").situacao, SITUACAO.BLOQUEADA);
  assert.equal(r.problemas.length, 3);
});

test("ANA avisa quando já existe competência mais nova que a configurada", async () => {
  const { competenciaConfigurada } = require("../src/sources/monitorSecas");
  const comp = competenciaConfigurada();
  const base = fetchAna(comp);
  const seguinte = (comp.mes % 12) + 1;
  const proxima = { mes: seguinte, ano: comp.mes === 12 ? comp.ano + 1 : comp.ano };
  const fetchProxima = fetchAna({ ...proxima, rotulo: competenciaConfigurada(`${proxima.ano}-${String(seguinte).padStart(2, "0")}`).rotulo });
  const fetch = async (url) => (Number(new URL(url).searchParams.get("mes")) === seguinte ? fetchProxima(url) : base(url));
  const r = await executarVerificacao({ cidades: [RIO], env: {}, fontes: fontesOk({ fetch }) });
  const item = itemDe(r, "ANA Monitor de Secas");
  assert.equal(item.situacao, SITUACAO.OK);
  assert.match(item.detalhe, /MONITOR_SECAS_COMPETENCIA=/);
});

test("utilitários: campos faltando e classificação de erro", () => {
  assert.deepEqual(camposFaltando({ a: { b: 0 }, c: "" }, { "a.b": "B", c: "C", "d.e": "E" }), ["C", "E"]);
  assert.equal(situacaoDoErro(Object.assign(new Error("x"), { name: "ParserError" })), SITUACAO.FORMATO_ALTERADO);
  assert.equal(situacaoDoErro(Object.assign(new Error("x"), { tipo: "timeout" })), SITUACAO.INDISPONIVEL);
});

test("e-mail técnico: escapa conteúdo, só aceita endereços válidos e não envia sem destinatário", async () => {
  const resultado = {
    verificadoEm: "2026-10-13T07:30:00.000Z",
    itens: [{ fonte: "Clima e Saúde", escopo: "Rio", situacao: "formato_alterado", detalhe: "<script>x</script>" }],
    problemas: [{}],
  };
  const html = renderVerificacaoHtml(resultado);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /Formato alterado/);
  assert.deepEqual(destinatariosVerificacao({ EMAIL_ALERTA_FONTES: "a@b.com, invalido, c@d.com.br" }), ["a@b.com", "c@d.com.br"]);
  assert.deepEqual(await enviarVerificacaoFontes(resultado, { env: {} }), { enviado: false, motivo: "EMAIL_ALERTA_FONTES não configurado" });
});

test("agendador só aciona o aviso quando há problema e não derruba o processo em falha", async () => {
  let avisos = 0;
  const avisar = async () => { avisos += 1; return { enviado: false, motivo: "teste" }; };
  await executarVerificacaoFontes({ verificar: async () => ({ itens: [{}], problemas: [] }), avisar });
  assert.equal(avisos, 0);
  await executarVerificacaoFontes({
    verificar: async () => ({ itens: [{}], problemas: [{ situacao: "indisponivel", fonte: "X", escopo: "Y", detalhe: "Z" }] }),
    avisar,
  });
  assert.equal(avisos, 1);
  assert.equal(await executarVerificacaoFontes({ verificar: async () => { throw new Error("boom"); }, avisar }), null);
});
