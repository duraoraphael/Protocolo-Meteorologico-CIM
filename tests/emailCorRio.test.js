// Corpo do e-mail: card "Comunicado oficial COR-Rio" só com o comunicado do
// dia (Brasília) e só com o conteúdo referente ao dia. PDF e site seguem
// completos a partir do mesmo estado.
const test = require("node:test");
const assert = require("node:assert/strict");
const cheerio = require("cheerio");

const { renderEmailHtml } = require("../src/render/emailTemplate");
const { renderPdfHtml } = require("../src/render/pdfTemplate");
const { comunicadoDoDia, conteudoDoDia, diasCitados } = require("../src/render/corRioEmail");
const { interpretarComunicados } = require("../src/sources/corRio");

// Sexta-feira, 02/10/2026, 11:00 em Brasília.
const GERADO = "2026-10-02T14:00:00.000Z";
const REF = { ano: 2026, mes: 10, dia: 2 };

// Estrutura real do post de 02/10/2026 (categorias e parágrafos conferidos na API).
const CONTEUDO_DO_DIA = [
  "<p>Segundo o Alerta Rio, nesta sexta-feira (2/10), o tempo ficará instável. Máxima prevista de 25°C.</p>",
  "<p><strong>ORIENTAÇÕES</strong></p><ul><li>Evite áreas alagadas.</li><li>Em emergência, ligue 199.</li></ul>",
  "<p><strong>PREVISÃO PARA OS PRÓXIMOS DIAS:</strong></p>",
  "<p>No sábado (3/10), predomínio de céu encoberto e chuva fraca a moderada.</p>",
  "<p>No domingo (4/10) o tempo será influenciado por uma nova frente fria.</p>",
  "<p>Na segunda e terça-feira (5/10 e 6/10), céu nublado com chuva fraca.</p>",
].join("");

function post(id, { publicado, titulo = `Sexta-feira (2/10) com chuva — comunicado ${id}`, categorias = [26, 46, 29, 23], conteudo = CONTEUDO_DO_DIA } = {}) {
  return {
    id, date_gmt: publicado.slice(0, 19), modified_gmt: publicado.slice(0, 19), link: `https://cor.rio/post-${id}/`,
    title: { rendered: titulo }, excerpt: { rendered: "<p>Resumo.</p>" }, content: { rendered: conteudo }, categories: categorias,
  };
}

const itens = (...posts) => interpretarComunicados(posts);

function relatorio(corRio, extra = {}) {
  return {
    cidade: { chave: "rio_de_janeiro", nome: "Rio de Janeiro", uf: "RJ" },
    dataFormatadaLonga: "sexta-feira, 2 de outubro de 2026", dataFormatadaCurta: "02/10/2026", horaConsulta: "11:00",
    geradoEmISO: GERADO, nomeArquivoBase: "teste",
    tabelaTemperaturaUmidade: [], ventoPorPeriodo: [], chuvaPorPeriodo: [], mar: null, qualidadeAr: null,
    severidade: { grau: "NORMAL", eventos: [] }, avisosInmet: [], divergencias: [], avisosColeta: [],
    fontesAutomatizadas: [], fontesManuais: [], deslocamento: { pedestres: [], transporte: [], condutores: [] }, edificacao: [],
    corRio, ...extra,
  };
}

function estado(lista, { nivel = 2, nivelCalor = 3, calorStatus = "operacional", comStatus = "operacional", estagioStatus = "operacional" } = {}) {
  return {
    fonte: "COR-Rio — Centro de Operações e Resiliência (Prefeitura do Rio)", abrangencia: "Município do Rio de Janeiro",
    estagio: {
      status: estagioStatus,
      dados: nivel ? { nivel, rotulo: `Estágio ${nivel}`, vigenteDesde: "2026-09-30T08:00:47Z", mensagens: [] } : null,
      consultadoEm: nivel ? "2026-10-02T13:55:00Z" : null, falha: estagioStatus === "operacional" ? null : "a fonte não respondeu a tempo",
    },
    calor: {
      status: calorStatus,
      dados: nivelCalor ? { nivel: nivelCalor, rotuloOficial: `Calor ${nivelCalor}`, rotulo: `Estágio de Calor ${nivelCalor}`, urlPublica: "https://cor.rio/niveis-de-calor/" } : null,
      consultadoEm: nivelCalor ? "2026-10-02T13:57:00Z" : null,
      falha: calorStatus === "operacional" ? null : "falha de conexão com a fonte",
    },
    comunicados: {
      status: comStatus, janelaHoras: 24, consultadoEm: comStatus === "indisponivel" ? null : "2026-10-02T13:56:00Z",
      falha: comStatus === "operacional" ? null : "falha de conexão com a fonte", itens: comStatus === "indisponivel" ? [] : lista,
    },
  };
}

const cardEmail = (html) => {
  const $ = cheerio.load(html);
  const td = $("td").filter((_, el) => $(el).children("table").first().text().includes("Comunicado oficial COR-Rio")).first();
  return { $, td, texto: td.text().replace(/\s+/g, " ") };
};

test("datas citadas: numéricas, por extenso e dias da semana, relativas a hoje", () => {
  assert.deepEqual(diasCitados("nesta sexta-feira (2/10)", REF), [0]);
  assert.deepEqual(diasCitados("Atualizado às 9h30 (2/10/2026)", REF), [0]);
  assert.deepEqual(diasCitados("entre 20h (1º/10) e 9h30 (2/10)", REF).sort(), [-1, 0]);
  assert.deepEqual(diasCitados("segunda e terça-feira (5/10 e 6/10)", REF), [3, 4]);
  assert.deepEqual(diasCitados("no dia 3 de outubro de 2026", REF), [1]);
  assert.deepEqual(diasCitados("No sábado haverá chuva", REF), [1]);
  assert.deepEqual(diasCitados("noite de quinta", REF), [-1]);
  assert.deepEqual(diasCitados("ventos de 18,5km/h a 51,9km/h, máxima de 25°C", REF), []);
  // virada de ano: 31/12 visto de 01/01
  assert.deepEqual(diasCitados("(31/12)", { ano: 2027, mes: 1, dia: 1 }), [-1]);
});

test("conteúdo do dia: remove a seção dos próximos dias e preserva condições e orientações", () => {
  const [c] = itens(post(1, { publicado: "2026-10-02T08:51:22" }));
  const dia = conteudoDoDia(c.paragrafos, REF);
  const textos = dia.map((p) => p.texto);
  assert.equal(textos[0], c.paragrafos[0].texto, "texto oficial preservado sem reescrita");
  assert.ok(textos.includes("ORIENTAÇÕES") && textos.includes("Evite áreas alagadas.") && textos.includes("Em emergência, ligue 199."));
  assert.ok(!textos.some((t) => /PRÓXIMOS DIAS|sábado|domingo|segunda/.test(t)));
});

test("conteúdo do dia: seção datada de hoje fica; parágrafo só de amanhã sai mesmo sem subtítulo", () => {
  const paragrafos = [
    { texto: "OCORRÊNCIAS ENTRE 20h (1º/10) E 9h30 (2/10)", destaque: true },
    { texto: "Bolsão d'água na Rua A (Catete)\nBolsão na Rua B", item: true },
    { texto: "Para amanhã, sábado (3/10), céu encoberto." },
    { texto: "Equipes seguem nas ruas." },
  ];
  assert.deepEqual(conteudoDoDia(paragrafos, REF).map((p) => p.texto), [paragrafos[0].texto, paragrafos[1].texto, paragrafos[3].texto]);
});

test("seleção: mais recente do dia até a geração; ignora véspera, futuro, não meteorológico e título de outro dia", () => {
  const lista = itens(
    post(1, { publicado: "2026-10-02T08:51:22" }), // 05:51 de hoje
    post(2, { publicado: "2026-10-02T12:30:00", titulo: "Sexta-feira (2/10) — atualização da tarde" }), // 09:30 de hoje — a mais recente válida
    post(3, { publicado: "2026-10-02T15:00:00" }), // depois da geração
    post(4, { publicado: "2026-10-02T13:00:00", categorias: [46, 28], titulo: "Interdição de túnel nesta sexta (2/10)" }), // não meteorológico
    post(5, { publicado: "2026-10-02T13:30:00", titulo: "Sábado (3/10) terá chuva forte" }), // trata de amanhã
    post(6, { publicado: "2026-10-02T00:53:37", titulo: "Rio teve chuva na noite de quinta (1º/10) e madrugada de sexta (2/10)" }), // 21:53 de ontem em Brasília
  );
  const escolhido = comunicadoDoDia(lista, { geradoEm: GERADO });
  assert.equal(escolhido.id, "2");
  assert.equal(comunicadoDoDia(itens(post(6, { publicado: "2026-10-02T00:53:37" })), { geradoEm: GERADO }), null, "publicação de ontem (Brasília) não vira comunicado de hoje");
});

test("e-mail: só o comunicado do dia, sem próximos dias e sem outros comunicados; dados e link preservados", () => {
  const lista = itens(post(1, { publicado: "2026-10-02T08:51:22" }), post(9, { publicado: "2026-10-01T19:56:44", titulo: "Quinta (1/10) com chuva" }));
  const { td, texto, $ } = cardEmail(renderEmailHtml(relatorio(estado(lista))));
  assert.match(texto, /Sexta-feira \(2\/10\) com chuva — comunicado 1/);
  assert.match(texto, /nesta sexta-feira \(2\/10\)/);
  assert.match(texto, /Evite áreas alagadas\./);
  assert.doesNotMatch(texto, /PRÓXIMOS DIAS|No sábado|No domingo|terça-feira \(5\/10/);
  assert.doesNotMatch(texto, /Outros comunicados|Quinta \(1\/10\)/);
  assert.match(texto, /Abrangência: Município do Rio de Janeiro/);
  assert.match(texto, /Publicação: 02\/10\/2026 05:51 \(Brasília\)/);
  assert.match(texto, /Fonte: COR-Rio/);
  assert.match(texto, /Consulta à fonte: 02\/10\/2026 10:56 \(Brasília\)/);
  assert.equal(td.find('a[href="https://cor.rio/post-1/"]').text(), "Consultar publicação oficial");
  const selo = td.find("span").filter((_, el) => $(el).text() === "ESTÁGIO 2");
  assert.match(selo.attr("style"), /background:#FACC15;color:#0B1A12;/);
  assert.equal(td.find("span").filter((_, el) => $(el).text() === "ESTÁGIO DE CALOR 3").length, 1);
  assert.match(texto, /Estágio de calor: Estágio de Calor 3\. Consulta à fonte: 02\/10\/2026 10:57/);
  assert.match($("table").filter((_, el) => /border-left:7px solid #FACC15/.test($(el).attr("style") || "")).attr("style"), /background:#FFFAE8;.*border-radius:8px/);
});

test("e-mail sem publicação do dia: mensagem própria, estágio válido mantido mesmo vigente desde outro dia", () => {
  const lista = itens(post(9, { publicado: "2026-10-01T19:56:44", titulo: "Quinta (1/10) com chuva" }));
  const { texto } = cardEmail(renderEmailHtml(relatorio(estado(lista, { nivel: 1 }))));
  assert.match(texto, /Nenhum comunicado do dia disponível até o horário da consulta\./);
  assert.doesNotMatch(texto, /Quinta \(1\/10\) com chuva/);
  assert.match(texto, /ESTÁGIO 1/);
  assert.match(texto, /Estágio 1, em vigor desde 30\/09\/2026 05:00 \(Brasília\)/);
});

test("e-mail: falha da fonte ≠ ausência do comunicado do dia; sem estágio fica neutro", () => {
  const { texto } = cardEmail(renderEmailHtml(relatorio(estado([], { nivel: null, estagioStatus: "indisponivel", comStatus: "indisponivel" }))));
  assert.match(texto, /Não foi possível consultar os comunicados do COR-Rio/);
  assert.doesNotMatch(texto, /Nenhum comunicado do dia/);
  assert.match(texto, /ESTÁGIO INDISPONÍVEL/);
  assert.doesNotMatch(texto, /ESTÁGIO [1-5]/);
});

test("PDF do mesmo relatório continua completo (alteração restrita ao e-mail)", () => {
  const lista = itens(post(1, { publicado: "2026-10-02T08:51:22" }), post(9, { publicado: "2026-10-01T19:56:44", titulo: "Quinta (1/10) com chuva" }));
  const pdf = renderPdfHtml(relatorio(estado(lista)));
  assert.match(pdf, /PREVISÃO PARA OS PRÓXIMOS DIAS/);
  assert.match(pdf, /No sábado \(3\/10\)/);
  assert.match(pdf, /Outros comunicados vigentes do COR-Rio/);
});

test("e-mail de outra base não tem card do COR-Rio", () => {
  const html = renderEmailHtml(relatorio(undefined, { cidade: { chave: "macae", nome: "Macaé", uf: "RJ" } }));
  assert.doesNotMatch(html, /COR-Rio/);
});

// ---------------------------------------------------------------------------
// PDF anexado ao e-mail (renderPdfHtml com corRioSomenteDoDia)
// ---------------------------------------------------------------------------
test("PDF do anexo: só o comunicado do dia, sem próximos dias nem outros comunicados; dados e link preservados", () => {
  const lista = itens(post(1, { publicado: "2026-10-02T08:51:22" }), post(9, { publicado: "2026-10-01T19:56:44", titulo: "Quinta (1/10) com chuva" }));
  const $ = cheerio.load(renderPdfHtml(relatorio(estado(lista)), { corRioSomenteDoDia: true }));
  const card = $(".cor-card");
  assert.equal(card.length, 1);
  const texto = card.text().replace(/\s+/g, " ");
  assert.match(texto, /Sexta-feira \(2\/10\) com chuva — comunicado 1/);
  assert.match(texto, /Evite áreas alagadas\./);
  assert.doesNotMatch(texto, /PRÓXIMOS DIAS|No sábado|No domingo/);
  assert.equal($(".cor-outros").length, 0);
  assert.doesNotMatch($.text(), /Outros comunicados vigentes|Quinta \(1\/10\) com chuva/);
  assert.equal(card.find(".cor-selo").attr("style"), "background:#FACC15;color:#0B1A12;");
  assert.match(card.attr("style"), /border-color:#FACC15;background:#FFFAE8;/);
  const meta = Object.fromEntries(card.find("table.cor-meta tr").map((_, tr) => [[$(tr).find("th").text(), $(tr).find("td").text()]]).get());
  assert.equal(meta["Abrangência"], "Município do Rio de Janeiro");
  assert.equal(meta["Publicação"], "02/10/2026 05:51 (Brasília)");
  assert.match(meta["Fonte"], /^COR-Rio/);
  assert.equal(meta["Consulta à fonte"], "02/10/2026 10:56 (Brasília)");
  assert.equal(card.find('a[href="https://cor.rio/post-1/"]').text(), "Consultar publicação oficial");
});

test("PDF do anexo: várias publicações → a mais recente até a geração", () => {
  const lista = itens(
    post(1, { publicado: "2026-10-02T08:51:22" }),
    post(2, { publicado: "2026-10-02T12:30:00", titulo: "Sexta-feira (2/10) — atualização da tarde" }),
    post(3, { publicado: "2026-10-02T15:00:00", titulo: "Sexta-feira (2/10) — depois da geração" }),
  );
  const texto = cheerio.load(renderPdfHtml(relatorio(estado(lista)), { corRioSomenteDoDia: true }))(".cor-card").text();
  assert.match(texto, /atualização da tarde/);
  assert.doesNotMatch(texto, /comunicado 1|depois da geração/);
});

test("PDF do anexo sem publicação do dia: mensagem própria, sem publicação anterior; estágio mantido", () => {
  const lista = itens(post(9, { publicado: "2026-10-01T19:56:44", titulo: "Quinta (1/10) com chuva" }));
  const texto = cheerio.load(renderPdfHtml(relatorio(estado(lista, { nivel: 3 })), { corRioSomenteDoDia: true }))(".cor-card").text().replace(/\s+/g, " ");
  assert.match(texto, /Nenhum comunicado do dia disponível até o horário da consulta\./);
  assert.doesNotMatch(texto, /Quinta \(1\/10\) com chuva/);
  assert.match(texto, /ESTÁGIO 3/);
  assert.match(texto, /Estágio 3, em vigor desde 30\/09\/2026 05:00 \(Brasília\)/);
});

test("PDF completo (download pelo site) não muda quando a opção não é usada", () => {
  const lista = itens(post(1, { publicado: "2026-10-02T08:51:22" }), post(9, { publicado: "2026-10-01T19:56:44", titulo: "Quinta (1/10) com chuva" }));
  const r = relatorio(estado(lista));
  assert.equal(renderPdfHtml(r), renderPdfHtml(r, { corRioSomenteDoDia: false }));
  assert.match(renderPdfHtml(r), /PREVISÃO PARA OS PRÓXIMOS DIAS/);
});
