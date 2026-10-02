// Painel "Comunicados COR-Rio": coleta do estágio operacional e dos
// comunicados, preservação do último dado válido e renderização por estágio.
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  criarServicoCorRio, interpretarEstagio, interpretarComunicados, comunicadosVigentes,
  URL_ESTAGIO, URL_COMUNICADOS,
} = require("../src/sources/corRio");
const { carregarPainel } = require("./helpers/fakeDom");
const { subirApp } = require("./helpers/servidor");

const AGORA = Date.parse("2026-10-02T15:00:00Z");

// Formatos reais conferidos em 02/10/2026.
const estagioBruto = (estagio = "Estágio 1", extra = {}) => ({ cor: "#228d46", estagio, mensagem: "", mensagem2: "", id: 1, inicio: "2026-09-30T08:00:47Z", ...extra });
function postBruto(id, sobrescrever = {}) {
  return {
    id,
    date_gmt: "2026-10-02T08:51:22",
    modified_gmt: "2026-10-02T09:10:00",
    link: `https://cor.rio/post-${id}/`,
    title: { rendered: `Comunicado ${id} &#8211; chuva` },
    excerpt: { rendered: "<p>Resumo do comunicado [&hellip;]</p>" },
    content: { rendered: "<p><strong>PREVISÃO</strong></p><p>Linha 1<br />\nLinha 2</p><ul><li>Item A</li></ul><script>alert(1)</script>" },
    ...sobrescrever,
  };
}

function respostaJson(json, status = 200) {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(json) };
}
function fetchFalso(rotas) {
  const chamadas = [];
  const fn = async (url) => {
    chamadas.push(url);
    const r = rotas[url];
    if (r instanceof Error) throw r;
    if (typeof r === "function") return r();
    return r;
  };
  fn.chamadas = chamadas;
  return fn;
}
const silencioso = { log() {}, error() {}, warn() {} };
function servico(rotas, opcoes = {}) {
  const fetchImpl = fetchFalso(rotas);
  let agora = AGORA;
  const s = criarServicoCorRio({
    fetchImpl, agora: () => agora, carregar: () => ({}), salvar: () => {}, logger: silencioso,
    tentativas: 1, esperarFn: async () => {}, ...opcoes,
  });
  return { s, fetchImpl, avancar: (ms) => { agora += ms; } };
}

test("estágio: só o texto oficial 'Estágio N' (1–5) define o nível", () => {
  for (const n of [1, 2, 3, 4, 5]) {
    const e = interpretarEstagio(estagioBruto(`Estágio ${n}`));
    assert.equal(e.nivel, n);
    assert.equal(e.rotulo, `Estágio ${n}`);
    assert.equal(e.vigenteDesde, "2026-09-30T08:00:47.000Z");
  }
  for (const invalido of [{}, estagioBruto(""), estagioBruto("Estágio 0"), estagioBruto("Estágio 6"), estagioBruto(null), estagioBruto("Calor 2")]) {
    assert.throws(() => interpretarEstagio(invalido), /estágio ausente/);
  }
  assert.deepEqual(interpretarEstagio(estagioBruto("Estágio 3", { mensagem: "<b>Chuva forte</b>" })).mensagens, ["Chuva forte"]);
});

test("comunicados: texto limpo, link só do cor.rio, sem duplicados, mais recente primeiro", () => {
  const lista = interpretarComunicados([
    postBruto(1, { date_gmt: "2026-10-01T10:00:00", modified_gmt: "2026-10-01T10:00:00" }),
    postBruto(2),
    postBruto(2), // mesmo id repetido
    postBruto(3, { title: { rendered: "Comunicado 2 – chuva" }, modified_gmt: "2026-10-02T12:00:00" }), // mesmo título, versão mais nova
    postBruto(4, { link: "https://exemplo.com/falso/" }),
    postBruto(5, { title: { rendered: "" } }),
  ]);
  assert.deepEqual(lista.map((c) => c.id), ["3", "1"]);
  const c = lista[0];
  assert.equal(c.titulo, "Comunicado 2 – chuva");
  assert.equal(c.resumo, "Resumo do comunicado…");
  assert.equal(c.publicadoEm, "2026-10-02T08:51:22.000Z");
  assert.equal(c.atualizadoEm, "2026-10-02T12:00:00.000Z");
  assert.equal(c.abrangencia, "Município do Rio de Janeiro");
  assert.deepEqual(c.paragrafos, [
    { texto: "PREVISÃO", destaque: true },
    { texto: "Linha 1\nLinha 2" },
    { texto: "Item A", item: true },
  ]);
  assert.ok(!JSON.stringify(lista).includes("alert(1)"));
  assert.throws(() => interpretarComunicados({ code: "rest_no_route" }), /não é uma lista/);
});

test("comunicados vigentes: publicados ou atualizados nas últimas 24 h", () => {
  const itens = [
    { id: "a", publicadoEm: "2026-10-02T10:00:00.000Z", atualizadoEm: null },
    { id: "b", publicadoEm: "2026-09-30T10:00:00.000Z", atualizadoEm: "2026-10-02T01:00:00.000Z" },
    { id: "c", publicadoEm: "2026-09-30T10:00:00.000Z", atualizadoEm: null },
  ];
  assert.deepEqual(comunicadosVigentes(itens, AGORA).map((c) => c.id), ["a", "b"]);
});

test("serviço: estágio e comunicados com horários próprios; falha preserva o último válido", async () => {
  let estagio = estagioBruto("Estágio 2");
  const rotas = {
    [URL_ESTAGIO]: () => respostaJson(estagio),
    [URL_COMUNICADOS]: () => respostaJson([postBruto(10)]),
  };
  const { s, fetchImpl, avancar } = servico(rotas, { ttlMs: 60_000 });

  let e = await s.obter();
  assert.equal(e.estagio.status, "operacional");
  assert.equal(e.estagio.dados.nivel, 2);
  assert.equal(e.comunicados.status, "operacional");
  assert.equal(e.comunicados.itens.length, 1);
  assert.equal(e.estagio.consultadoEm, new Date(AGORA).toISOString());

  // dentro do TTL não consulta de novo
  await s.obter();
  assert.equal(fetchImpl.chamadas.length, 2);

  // mudança de estágio chega na próxima consulta
  avancar(60_000);
  estagio = estagioBruto("Estágio 4");
  e = await s.obter();
  assert.equal(e.estagio.dados.nivel, 4);

  // estágio falha, comunicados seguem: cada parte com seu status
  avancar(60_000);
  rotas[URL_ESTAGIO] = () => respostaJson({}, 503);
  e = await s.obter();
  assert.equal(e.estagio.status, "desatualizado");
  assert.equal(e.estagio.dados.nivel, 4, "mantém o último estágio válido");
  assert.equal(e.estagio.consultadoEm, new Date(AGORA + 60_000).toISOString(), "horário da última consulta válida");
  assert.match(e.estagio.falha, /HTTP 503/);
  assert.equal(e.comunicados.status, "operacional");
  assert.equal(e.comunicados.consultadoEm, new Date(AGORA + 120_000).toISOString());
});

test("serviço: sem dado válido fica indisponível — nunca assume o estágio 1", async () => {
  const { s } = servico({
    [URL_ESTAGIO]: () => respostaJson(estagioBruto("Estágio desconhecido")),
    [URL_COMUNICADOS]: Object.assign(new TypeError("fetch failed"), { cause: { code: "ENOTFOUND" } }),
  });
  const e = await s.obter();
  assert.equal(e.estagio.status, "indisponivel");
  assert.equal(e.estagio.dados, null);
  assert.match(e.estagio.falha, /formato não reconhecido/);
  assert.equal(e.comunicados.status, "indisponivel");
  assert.deepEqual(e.comunicados.itens, []);
  assert.equal(e.comunicados.consultadoEm, null);
});

test("serviço: lista vazia da fonte é 'nenhum comunicado', não falha", async () => {
  const { s } = servico({ [URL_ESTAGIO]: () => respostaJson(estagioBruto()), [URL_COMUNICADOS]: () => respostaJson([]) });
  const e = await s.obter();
  assert.equal(e.comunicados.status, "operacional");
  assert.deepEqual(e.comunicados.itens, []);
  assert.ok(e.comunicados.consultadoEm);
});

test("serviço: retoma a última coleta válida gravada, com o horário original", async () => {
  let salvo = null;
  const primeiro = servico(
    { [URL_ESTAGIO]: () => respostaJson(estagioBruto("Estágio 3")), [URL_COMUNICADOS]: () => respostaJson([postBruto(7)]) },
    { salvar: (estado) => { salvo = estado; } }
  );
  await primeiro.s.obter();
  assert.equal(salvo.estagio.dados.nivel, 3);

  const falha = () => respostaJson({}, 500);
  const reinicio = servico({ [URL_ESTAGIO]: falha, [URL_COMUNICADOS]: falha }, { carregar: () => salvo });
  const e = await reinicio.s.obter();
  assert.equal(e.estagio.status, "desatualizado");
  assert.equal(e.estagio.dados.nivel, 3);
  assert.equal(e.estagio.consultadoEm, salvo.estagio.consultadoEm);
  assert.equal(e.comunicados.status, "desatualizado");
});

test("/api/cor-rio responde só para a base Rio de Janeiro; /api/cidades marca a base", async (t) => {
  const estadoFalso = { estagio: { status: "operacional", dados: { nivel: 3 } }, comunicados: { status: "operacional", itens: [] } };
  let consultas = 0;
  const { base, fechar } = await subirApp({ servicoCorRio: { obter: async () => { consultas += 1; return estadoFalso; } } });
  t.after(fechar);

  const rio = await (await fetch(`${base}/api/cor-rio?cidade=rio_de_janeiro`)).json();
  assert.equal(rio.aplicavel, true);
  assert.equal(rio.estagio.dados.nivel, 3);

  const macae = await (await fetch(`${base}/api/cor-rio?cidade=macae`)).json();
  assert.deepEqual(macae, { ok: true, aplicavel: false });
  assert.equal(consultas, 1, "outras bases não consultam o COR-Rio");

  assert.equal((await fetch(`${base}/api/cor-rio?cidade=inexistente`)).status, 400);

  const cidades = await (await fetch(`${base}/api/cidades`)).json();
  assert.deepEqual(cidades.disponiveis.filter((c) => c.corRio).map((c) => c.chave), ["rio_de_janeiro"]);
});

// ---------------------------------------------------------------------
// Renderização
// ---------------------------------------------------------------------
const CORES = { 1: "#22C55E", 2: "#FACC15", 3: "#F97316", 4: "#EF4444", 5: "#A855F7" };
function resposta({ nivel = 3, estagioStatus = "operacional", itens, comStatus = "operacional", comConsultado = "2026-10-02T14:00:00Z" } = {}) {
  return {
    fonte: "COR-Rio", abrangencia: "Município do Rio de Janeiro",
    estagio: {
      status: estagioStatus,
      dados: nivel ? { nivel, rotulo: `Estágio ${nivel}`, vigenteDesde: "2026-10-02T10:00:00Z", mensagens: [] } : null,
      consultadoEm: nivel ? "2026-10-02T14:30:00Z" : null,
      falha: estagioStatus === "operacional" ? null : "a fonte não respondeu a tempo",
    },
    comunicados: {
      status: comStatus, janelaHoras: 24, consultadoEm: comConsultado,
      falha: comStatus === "operacional" ? null : "falha de conexão com a fonte",
      itens: itens ?? interpretarComunicados([postBruto(21, { date_gmt: "2026-10-02T13:00:00" }), postBruto(20)]),
    },
  };
}
function renderizar(estado) {
  const painel = carregarPainel();
  painel.contexto.__estado = estado;
  return { html: painel.executar("Dashboard.corRio(__estado)"), painel };
}

test("mapa de cores único e exato para os cinco estágios", () => {
  const painel = carregarPainel();
  const mapa = JSON.parse(painel.executar("JSON.stringify(Dashboard.ESTAGIOS_COR_RIO)"));
  assert.deepEqual(Object.fromEntries(Object.entries(mapa).map(([n, e]) => [n, e.cor])), CORES);
});

test("cada estágio aplica sua cor ao painel, ao indicador e à escala; só o atual é 'Atual'", () => {
  for (const nivel of [1, 2, 3, 4, 5]) {
    const { html, painel } = renderizar({ resposta: resposta({ nivel }) });
    assert.match(html, new RegExp(`<section class="cor-rio" data-cor-estagio="${nivel}"`));
    assert.match(html, new RegExp(`<aside class="cor-rio-estagio" data-cor-estagio="${nivel}"`));
    assert.match(html, new RegExp(`ESTÁGIO ${nivel}<`));
    assert.equal((html.match(/cor-rio-atual-txt/g) || []).length, 1);
    assert.equal((html.match(/aria-current="step"/g) || []).length, 1);
    assert.match(html, new RegExp(`<li data-cor-estagio="${nivel}" class="atual" aria-current="step">`));
    for (const n of [1, 2, 3, 4, 5]) assert.match(html, new RegExp(`<li data-cor-estagio="${n}"`), "cada número tem a própria cor");
    assert.doesNotMatch(html, /<button[^>]*data-estagio|<input/, "escala não é controle");

    // CSSOM: as propriedades vêm do mapa, inclusive a tinta escura
    const definidas = [];
    const el = (n) => ({ dataset: { corEstagio: String(n) }, style: { setProperty: (p, v) => definidas.push([n, p, v]) } });
    const raiz = Object.assign(el(nivel), { querySelectorAll: () => [1, 2, 3, 4, 5].map(el) });
    painel.contexto.__raiz = raiz;
    painel.executar("Dashboard.aplicarCoresEstagio(__raiz)");
    assert.deepEqual(definidas.filter(([n, p]) => n === nivel && p === "--estagio").map(([, , v]) => v), [CORES[nivel], CORES[nivel]]);
    assert.ok(definidas.some(([, p, v]) => p === "--estagio-tinta" && v === "#0B1A12"));
  }
});

test("comunicado: título, resumo, abrangência, data, fonte e botão Ver comunicado", () => {
  const { html } = renderizar({ resposta: resposta() });
  assert.match(html, /Comunicados COR-Rio/);
  assert.match(html, /<h3 class="cor-rio-com-titulo"[^>]*>Comunicado 21 – chuva<\/h3>/, "mais recente primeiro");
  assert.match(html, /Resumo do comunicado…/);
  assert.match(html, /Abrangência: Município do Rio de Janeiro/);
  assert.match(html, /Publicado em 02\/10\/2026 10:00</, "atualização anterior à publicação não é exibida");
  assert.match(html, /Fonte: COR-Rio/);
  assert.match(html, /data-detail="cor-rio:21">Ver comunicado/);
  assert.match(html, /data-detail="cor-rio">Ver outro comunicado vigente/);
  assert.match(html, /Em vigor desde 02\/10\/2026 07:00/, "horário do estágio separado do comunicado");
});

test("estados vazios e de falha são distintos", () => {
  const nenhum = renderizar({ resposta: resposta({ itens: [] }) }).html;
  assert.match(nenhum, /Nenhum comunicado vigente/);
  assert.doesNotMatch(nenhum, /Não foi possível consultar/);

  const semFonte = renderizar({ resposta: resposta({ itens: [], comStatus: "indisponivel", comConsultado: null }) }).html;
  assert.match(semFonte, /Não foi possível consultar a fonte de comunicados do COR-Rio/);
  assert.doesNotMatch(semFonte, /Nenhum comunicado vigente/);

  const semEstagio = renderizar({ resposta: resposta({ nivel: null, estagioStatus: "indisponivel" }) }).html;
  assert.match(semEstagio, /<section class="cor-rio sem-estagio" aria-labelledby/);
  assert.doesNotMatch(semEstagio, /<section[^>]*data-cor-estagio/);
  assert.match(semEstagio, /Estágio indisponível/);
  assert.doesNotMatch(semEstagio, /ESTÁGIO \d|class="atual"/, "sem estágio padrão");
});

test("falha mantém o último estágio, marcado como desatualizado com o horário da consulta válida", () => {
  const html = renderizar({ resposta: resposta({ nivel: 4, estagioStatus: "desatualizado", comStatus: "desatualizado" }) }).html;
  assert.match(html, /ESTÁGIO 4/);
  assert.match(html, /Desatualizado · última consulta válida: 02\/10\/2026 11:30 \(a fonte não respondeu a tempo\)/);
  assert.match(html, /Comunicados desatualizados · última consulta válida: 02\/10\/2026 11:00/);

  // servidor do painel inacessível: mesmo dado, também desatualizado
  const offline = renderizar({ resposta: resposta({ nivel: 2 }), falhaServidor: true }).html;
  assert.match(offline, /ESTÁGIO 2/);
  assert.match(offline, /Desatualizado · última consulta válida/);
});

test("detalhes: conteúdo completo, link original e estágio identificado como informação separada", () => {
  const painel = carregarPainel();
  painel.contexto.__estado = { resposta: resposta() };
  const det = painel.executar("Dashboard.corRioDetalhes(__estado, '20')");
  assert.match(det, /<p class="cor-rio-par destaque">PREVISÃO<\/p>/);
  assert.match(det, /Publicado em 02\/10\/2026 05:51 · atualizado em 02\/10\/2026 06:10/);
  assert.match(det, /Linha 1\nLinha 2/);
  assert.match(det, /href="https:\/\/cor\.rio\/post-20\/" target="_blank" rel="noopener noreferrer"/);
  assert.match(det, /Outros comunicados vigentes[\s\S]*cor-rio:21/);
  assert.match(det, /publicado pelo COR-Rio separadamente dos comunicados/);
  assert.equal(painel.executar("Dashboard.corRioTitulo(__estado, '20')"), "Comunicado COR-Rio");
  assert.match(painel.executar("Dashboard.corRioDetalhes(__estado, '999')"), /não está mais entre os vigentes/);
});

test("painel consulta /api/cor-rio só na base do Rio, ao abrir", async () => {
  const urls = [];
  const responder = (url) => {
    urls.push(url);
    if (url.startsWith("/api/cidades")) return { ativa: "rio_de_janeiro", disponiveis: [{ chave: "rio_de_janeiro", nome: "Rio de Janeiro", uf: "RJ", corRio: true }, { chave: "macae", nome: "Macaé", uf: "RJ" }] };
    if (url.startsWith("/api/cor-rio")) return { ok: true, aplicavel: true, ...resposta({ nivel: 5 }) };
    return { ok: false, erro: "sem dados" };
  };
  const painel = carregarPainel({ responder });
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  assert.ok(urls.some((u) => u === "/api/cor-rio?cidade=rio_de_janeiro"));
  assert.equal(painel.executar("estadoCorRio.resposta.estagio.dados.nivel"), 5);
});
