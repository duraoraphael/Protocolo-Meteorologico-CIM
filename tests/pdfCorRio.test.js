// Card "Comunicado oficial COR-Rio" no PDF do informativo e preparação dos
// dados no relatório (mesmo estado usado pelo painel).
const test = require("node:test");
const assert = require("node:assert/strict");
const cheerio = require("cheerio");

const { renderPdfHtml } = require("../src/render/pdfTemplate");
const { anexarCorRioAoRelatorio, interpretarComunicados } = require("../src/sources/corRio");
const CorRio = require("../public/cor-rio-compartilhado");

const CORES = { 1: "#22C55E", 2: "#FACC15", 3: "#F97316", 4: "#EF4444", 5: "#A855F7" };

function relatorio(extra = {}) {
  return {
    cidade: { chave: "rio_de_janeiro", nome: "Rio de Janeiro", uf: "RJ" },
    dataFormatadaLonga: "sexta-feira, 2 de outubro de 2026", dataFormatadaCurta: "02/10/2026", horaConsulta: "11:00",
    tabelaTemperaturaUmidade: [], ventoPorPeriodo: [], chuvaPorPeriodo: [], mar: null, qualidadeAr: null,
    severidade: { grau: "NORMAL", eventos: [] },
    avisosInmet: [{ descricao: "Tempestade", severidade: "Perigo Potencial", inicio: "02/10/2026 09:00", fim: "02/10/2026 23:59", riscos: ["Chuva."], instrucoes: ["Abrigue-se."] }],
    divergencias: [], avisosColeta: [],
    fontesAutomatizadas: [{ nome: "Open-Meteo", uso: "Previsão" }],
    fontesManuais: [{ nome: "COR-Rio", uso: "Estágio operacional da cidade — sem API pública estável" }],
    deslocamento: { pedestres: [], transporte: [], condutores: [] }, edificacao: [],
    ...extra,
  };
}

function post(id, { horas = 2, paragrafos = "<p>Conteúdo oficial.</p><ul><li>Orientação 1.</li></ul>" } = {}) {
  const base = Date.parse("2026-10-02T14:00:00Z");
  return {
    id, date_gmt: new Date(base - horas * 3600e3).toISOString().slice(0, 19), modified_gmt: new Date(base - horas * 3600e3).toISOString().slice(0, 19),
    link: `https://cor.rio/post-${id}/`, title: { rendered: `Comunicado ${id}` }, excerpt: { rendered: "<p>Resumo.</p>" },
    content: { rendered: paragrafos },
  };
}

function estado({ nivel = 2, estagioStatus = "operacional", comStatus = "operacional", posts = [post(1), post(2, { horas: 5 })], vigenteDesde = "2026-10-02T10:00:00Z" } = {}) {
  return {
    fonte: "COR-Rio — Centro de Operações e Resiliência (Prefeitura do Rio)", abrangencia: "Município do Rio de Janeiro",
    estagio: {
      status: estagioStatus,
      dados: nivel ? { nivel, rotulo: `Estágio ${nivel}`, vigenteDesde, mensagens: [], urlPublica: "https://cor.rio/estagios-operacionais-da-cidade/" } : null,
      consultadoEm: nivel ? "2026-10-02T13:55:00Z" : null,
      falha: estagioStatus === "operacional" ? null : "a fonte não respondeu a tempo",
    },
    comunicados: {
      status: comStatus, janelaHoras: 24,
      consultadoEm: comStatus === "indisponivel" ? null : "2026-10-02T13:56:00Z",
      falha: comStatus === "operacional" ? null : "falha de conexão com a fonte",
      itens: comStatus === "indisponivel" ? [] : interpretarComunicados(posts),
    },
  };
}

async function html(est, cidade = { integracaoCorRio: true }) {
  const r = relatorio();
  await anexarCorRioAoRelatorio(r, cidade, { servico: { obter: async () => est }, logger: { error() {} } });
  return { r, html: renderPdfHtml(r), $: cheerio.load(renderPdfHtml(r)) };
}

test("mapa de cores compartilhado: mesmos HEX do site e texto escuro com contraste ≥ 4,5:1", () => {
  assert.deepEqual(Object.fromEntries(Object.entries(CorRio.ESTAGIOS).map(([n, e]) => [n, e.cor])), CORES);
  const lum = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
  for (const { cor } of Object.values(CorRio.ESTAGIOS)) {
    const [a, b] = [lum(cor), lum(CorRio.TINTA)].sort((x, y) => y - x);
    assert.ok((a + 0.05) / (b + 0.05) >= 4.5, `${cor} com texto ${CorRio.TINTA}`);
  }
  assert.equal(CorRio.tomClaro("#FACC15", 0.1), "#FFFAE8");
});

test("cada estágio colore faixa, borda e selo; fundo é um tom claro da mesma cor", async () => {
  for (const nivel of [1, 2, 3, 4, 5]) {
    const { $ } = await html(estado({ nivel }));
    const card = $(".cor-card").first();
    assert.match(card.attr("style"), new RegExp(`border-color:${CORES[nivel]};background:${CorRio.tomClaro(CORES[nivel], 0.1)};`));
    const selo = card.find(".cor-selo");
    assert.equal(selo.text(), `ESTÁGIO ${nivel}`);
    assert.equal(selo.attr("style"), `background:${CORES[nivel]};color:#0B1A12;`);
    assert.equal($(".cor-selo").length, 1, "só o selo do estágio atual, sem sequência 1–5");
  }
});

test("conteúdo: título, conteúdo/orientações, abrangência, publicação, fonte, consulta e link oficial", async () => {
  const { $ } = await html(estado());
  const card = $(".cor-card").first();
  assert.equal(card.find(".cor-titulo").text(), "Comunicado oficial COR-Rio");
  assert.equal(card.find(".cor-com-titulo strong").text(), "Comunicado 1");
  assert.match(card.text(), /Conteúdo oficial\./);
  assert.equal(card.find(".cor-lista li").text(), "Orientação 1.");
  const meta = Object.fromEntries(card.find("table.cor-meta tr").map((_, tr) => [[$(tr).find("th").text(), $(tr).find("td").text()]]).get());
  assert.equal(meta["Abrangência"], "Município do Rio de Janeiro");
  assert.equal(meta["Publicação"], "02/10/2026 09:00 (Brasília)");
  assert.match(meta["Fonte"], /^COR-Rio/);
  assert.equal(meta["Consulta à fonte"], "02/10/2026 10:56 (Brasília)");
  assert.equal(card.find('a[href="https://cor.rio/post-1/"]').text(), "Consultar publicação oficial");
  assert.match(card.text(), /Estágio 2, em vigor desde 02\/10\/2026 07:00 \(Brasília\)\. Consulta à fonte: 02\/10\/2026 10:55/);
  assert.match($(".cor-outros").text(), /Comunicado 2/);
});

test("card fica antes dos avisos INMET", async () => {
  const { html: h } = await html(estado());
  assert.ok(h.indexOf("Comunicado oficial COR-Rio") < h.indexOf("Aviso oficial INMET"));
});

test("comunicado anterior ao início do estágio é sinalizado; estágio não é atribuído a ele", async () => {
  const antigo = await html(estado({ vigenteDesde: "2026-10-02T13:00:00Z" }));
  assert.match(antigo.$(".cor-nota").text(), /publicado antes do início do estágio atual/);
  const novo = await html(estado({ vigenteDesde: "2026-10-01T10:00:00Z" }));
  assert.doesNotMatch(novo.$(".cor-nota").text(), /antes do início/);
  assert.match(novo.$(".cor-nota").text(), /estágio e comunicado são publicados separadamente/);
});

test("sem comunicado vigente, desatualizado e indisponível são estados distintos", async () => {
  const nenhum = await html(estado({ posts: [] }));
  assert.match(nenhum.$(".cor-card").text(), /Nenhum comunicado vigente disponibilizado pela fonte/);
  assert.equal(nenhum.$(".cor-selo").text(), "ESTÁGIO 2");

  const velho = await html(estado({ nivel: 4, estagioStatus: "desatualizado", comStatus: "desatualizado" }));
  assert.equal(velho.$(".cor-desatualizado").length, 2);
  assert.match(velho.$(".cor-desatualizado").first().text(), /Dados desatualizados.*Última consulta bem-sucedida dos comunicados: 02\/10\/2026 10:56/s);

  const fora = await html(estado({ nivel: null, estagioStatus: "indisponivel", comStatus: "indisponivel" }));
  const card = fora.$(".cor-card");
  assert.equal(card.find(".cor-selo").text(), "ESTÁGIO INDISPONÍVEL");
  assert.ok(card.find(".cor-selo").hasClass("cor-selo-neutro"));
  assert.match(card.attr("style"), /border-color:#8A9894;background:#F3F5F4;/);
  assert.match(card.text(), /Estágio indisponível/);
  assert.match(card.text(), /Não foi possível consultar os comunicados/);
  assert.doesNotMatch(fora.html, /ESTÁGIO [1-5]</, "nunca presume estágio");
});

test("comunicado longo: partes de continuação identificadas, sem omitir texto; curto fica num card só", async () => {
  const longos = Array.from({ length: 60 }, (_, i) => `<p>Parágrafo ${i + 1} ${"texto ".repeat(30)}</p>`).join("");
  const { $ } = await html(estado({ posts: [post(9, { paragrafos: longos })] }));
  const cards = $(".cor-card");
  assert.ok(cards.length > 2);
  cards.slice(1).each((i, el) => assert.match($(el).find(".cor-titulo").text(), new RegExp(`continuação \\(parte ${i + 2} de ${cards.length}\\)`)));
  for (let i = 1; i <= 60; i++) assert.match($.text(), new RegExp(`Parágrafo ${i} `));
  assert.equal(cards.last().find(".cor-continua").length, 0);

  const curto = await html(estado());
  assert.equal(curto.$(".cor-card").length, 1);
});

test("fontes: coleta automática só quando a consulta funcionou; falha vai para verificação manual", async () => {
  const ok = await html(estado());
  assert.deepEqual(ok.r.fontesAutomatizadas.map((f) => f.nome), ["Open-Meteo", "COR-Rio — estágio operacional", "COR-Rio — comunicados"]);
  assert.ok(!ok.r.fontesManuais.some((f) => /COR-Rio/.test(f.nome)), "linha manual genérica removida");
  assert.match(ok.r.fontesAutomatizadas[1].uso, /consultado automaticamente em 02\/10\/2026 10:55/);

  const velho = await html(estado({ estagioStatus: "desatualizado" }));
  assert.ok(!velho.r.fontesAutomatizadas.some((f) => f.nome === "COR-Rio — estágio operacional"));
  assert.match(velho.r.fontesManuais.find((f) => f.nome === "COR-Rio — estágio operacional").uso, /falhou nesta geração.*última consulta bem-sucedida/);
  assert.ok(velho.r.avisosColeta.some((a) => /COR-Rio/.test(a)));
});

test("outras cidades: sem consulta, sem card e fontes intactas", async () => {
  const r = relatorio({ cidade: { chave: "macae", nome: "Macaé", uf: "RJ" }, fontesManuais: [] });
  const resultado = await anexarCorRioAoRelatorio(r, { chave: "macae" }, { servico: { obter: async () => assert.fail("não deve consultar") } });
  assert.equal(resultado, null);
  assert.equal(r.corRio, undefined);
  assert.doesNotMatch(renderPdfHtml(r), /COR-Rio/);
});

test("falha inesperada do serviço não impede o PDF: card indisponível", async () => {
  const r = relatorio();
  await anexarCorRioAoRelatorio(r, { integracaoCorRio: true }, { servico: { obter: async () => { throw new Error("boom"); } }, logger: { error() {} } });
  const h = renderPdfHtml(r);
  assert.match(h, /ESTÁGIO INDISPONÍVEL/);
  assert.match(h, /Aviso oficial INMET/);
});
