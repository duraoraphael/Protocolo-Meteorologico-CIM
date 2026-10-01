const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ms = require("../src/sources/monitorSecas");
const { renderPdfHtml } = require("../src/render/pdfTemplate");
const { CIDADES } = require("../src/config/cities");

const AGOSTO = ms.competenciaConfigurada("2026-08");
// PNG mínimo válido (1×1) para os testes não dependerem de rede.
const PNG_1X1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");

const TEXTOS = {
  33: "No Rio de Janeiro, em decorrência das chuvas acima da normalidade, a seca fraca (S0) recuou no centro e leste. Os impactos são de curto e longo prazo (CL) no sudoeste e de curto prazo (C) nas demais áreas.",
  13: "No Amazonas, a seca moderada (S1) avançou no noroeste. Os impactos são de curto prazo (C).",
  32: "No Espírito Santo, o norte do estado registrou avanço da seca moderada (S1), que agora cobre todo o território capixaba. Os impactos são de curto prazo (C).",
  41: "No Paraná, as chuvas acima da média favoreceram o desaparecimento da seca fraca (S0), deixando todo estado sem seca relativa (SSR).",
};

function respostaApi(sobrescrever = {}) {
  return {
    data: {
      list: [{
        id: 307, nome: "Agosto de 2026", mes: 8, ano: 2026, final: true,
        path: "uploads/mapas/146_agosto2026.png", data_criacao: "2026-09-16T14:47:49",
        descricao: [
          ...Object.entries(TEXTOS).map(([area, descricao]) => ({ mapa_id: 307, tipo_area: 1, area: Number(area), descricao })),
          { mapa_id: 307, tipo_area: 8, area: 3, descricao: "Texto regional, não estadual." },
        ],
        ...sobrescrever,
      }],
    },
  };
}

function fetchFalso(api = respostaApi()) {
  const chamadas = [];
  const fn = async (url) => {
    chamadas.push(url);
    if (url.startsWith("https://apimsbr.ana.gov.br/")) return new Response(JSON.stringify(api), { status: 200 });
    if (url.endsWith(".png")) return new Response(PNG_1X1, { status: 200 });
    return new Response("", { status: 404 });
  };
  fn.chamadas = chamadas;
  return fn;
}

function silenciar(t) {
  const { warn, error, log } = console;
  console.warn = () => {};
  console.error = () => {};
  console.log = () => {};
  t.after(() => Object.assign(console, { warn, error, log }));
}

function pastaTemporaria(t) {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), "ms-"));
  t.after(() => fs.rmSync(pasta, { recursive: true, force: true }));
  return pasta;
}

test("competência configurada valida AAAA-MM e gera rótulo", () => {
  assert.deepEqual(AGOSTO, { mes: 8, ano: 2026, chave: "2026-08", rotulo: "Agosto/2026" });
  assert.throws(() => ms.competenciaConfigurada("2026-13"));
  assert.throws(() => ms.competenciaConfigurada("agosto"));
});

test("interpretarApi aceita só a competência pedida, final e com o nome do mês", () => {
  const api = ms.interpretarApi(respostaApi(), AGOSTO);
  assert.equal(api.dataElaboracao, "2026-09-16T14:47:49");
  assert.equal(api.descricoesUf["32"], TEXTOS[32]);
  assert.equal(api.descricoesUf["3"], undefined, "texto regional não vira texto estadual");

  assert.throws(() => ms.interpretarApi(respostaApi({ mes: 9, nome: "Setembro de 2026" }), AGOSTO), /em vez de 8\/2026/);
  assert.throws(() => ms.interpretarApi(respostaApi({ final: false }), AGOSTO), /versão final/);
  assert.throws(() => ms.interpretarApi(respostaApi({ nome: "Julho de 2026" }), AGOSTO), /não corresponde/);
  assert.throws(() => ms.interpretarApi({ data: { list: [] } }, AGOSTO), /não publicou/);
});

test("caminhos de arquivo da API ficam restritos a uploads/mapas no bucket oficial", () => {
  assert.match(ms.urlArquivo("uploads/mapas/146_agosto2026.png"), /^https:\/\/ana-monitor-secas-files\.s3\.sa-east-1\.amazonaws\.com\/uploads\/mapas\//);
  assert.throws(() => ms.urlArquivo("../etc/passwd"));
  assert.throws(() => ms.urlArquivo("uploads/mapas/../../x.png"));
  assert.throws(() => ms.urlArquivo("https://outro.host/uploads/mapas/a.png"));
});

test("coleta recorta pela UF do destino e reutiliza o cache sem rede", async (t) => {
  silenciar(t);
  const pasta = pastaTemporaria(t);
  const fetchFn = fetchFalso();
  const rj = await ms.obterMonitorSecas({ uf: "RJ", competencia: AGOSTO, fetchFn, pasta });
  assert.equal(rj.status, "operacional");
  assert.deepEqual(rj.resumosUf, [{ uf: "RJ", nome: "Rio de Janeiro", texto: TEXTOS[33] }]);

  const semRede = async () => { throw new Error("não deveria acessar a rede"); };
  const es = await ms.obterMonitorSecas({ uf: "ES", competencia: AGOSTO, fetchFn: semRede, pasta });
  assert.equal(es.status, "cache");
  assert.deepEqual(es.resumosUf.map((u) => u.uf), ["ES"]);

  const sc = await ms.obterMonitorSecas({ uf: "SC", competencia: AGOSTO, fetchFn: semRede, pasta });
  assert.equal(sc.resumosUf[0].texto, null, "UF sem texto na fonte fica nula, sem herdar texto de outra");
});

test("falha na fonte devolve indisponível sem lançar e sem usar outro mês", async (t) => {
  silenciar(t);
  const pasta = pastaTemporaria(t);
  const r1 = await ms.obterMonitorSecas({ uf: "RJ", competencia: AGOSTO, fetchFn: async () => { throw new Error("rede fora"); }, pasta });
  assert.equal(r1.status, "indisponivel");
  assert.equal(r1.competencia.chave, "2026-08");

  const setembro = fetchFalso(respostaApi({ mes: 9, nome: "Setembro de 2026" }));
  const r2 = await ms.obterMonitorSecas({ uf: "RJ", competencia: AGOSTO, fetchFn: setembro, pasta });
  assert.equal(r2.status, "indisponivel");
  assert.equal(fs.existsSync(path.join(pasta, "2026-08")), false, "nada é gravado em cache");
});

function relatorio(cidade, monitorSecas) {
  return {
    cidade,
    dataFormatadaLonga: "1 de outubro de 2026", dataFormatadaCurta: "01/10/2026", horaConsulta: "08:00",
    tabelaTemperaturaUmidade: [], ventoPorPeriodo: [], chuvaPorPeriodo: [],
    severidade: { grau: "ALERTA", eventos: [{ tipo: "vento", grau: "ALERTA", titulo: "ALERTA — VENTO", recomendacoes: ["Suspender içamentos."] }] },
    fontesAutomatizadas: [{ nome: "Open-Meteo", uso: "Previsão" }],
    deslocamento: { pedestres: [], transporte: [], condutores: [] }, edificacao: [],
    monitorSecas,
  };
}

// Extrai só o HTML da seção de seca (do título até "Fontes Consultadas").
function secaoSeca(html) {
  const inicio = html.indexOf("Monitor de Secas — ");
  return html.slice(inicio, html.indexOf("Fontes Consultadas"));
}

test("PDF: cada destino mostra só a sua UF, entre recomendação e fontes", async (t) => {
  silenciar(t);
  const pasta = pastaTemporaria(t);
  await ms.obterMonitorSecas({ uf: "RJ", competencia: AGOSTO, fetchFn: fetchFalso(), pasta });
  // O template lê o mapa da pasta padrão; aponta para o PNG de teste.
  const original = ms.mapaDataUri;
  t.after(() => { ms.mapaDataUri = original; });
  ms.mapaDataUri = (comp) => original(comp, pasta);

  const esperado = { RJ: "Rio de Janeiro", AM: "Amazonas", ES: "Espírito Santo" };
  for (const chave of ["rio_de_janeiro", "macae", "cabiunas", "manaus", "vitoria", "linhares"]) {
    const cidade = CIDADES[chave];
    const dados = await ms.obterMonitorSecas({ uf: cidade.uf, competencia: AGOSTO, pasta });
    const html = renderPdfHtml(relatorio(cidade, dados));
    const secao = secaoSeca(html);

    const iRec = html.indexOf("Recomendações - Protocolo Meteorológico");
    assert.ok(iRec > 0 && iRec < html.indexOf("Monitor de Secas — Agosto/2026"), chave);
    assert.match(secao, /<img class="ms-mapa" src="data:image\/png;base64,/);
    assert.match(secao, new RegExp(`Situação da seca — ${esperado[cidade.uf]}`));
    assert.match(secao, new RegExp(`Resumo estadual — ${cidade.uf}; sem detalhamento municipal disponível na fonte\\.`));
    for (const [uf, nome] of Object.entries(esperado)) {
      if (uf !== cidade.uf) assert.doesNotMatch(secao, new RegExp(nome), `${chave} não pode citar ${nome}`);
    }
    assert.doesNotMatch(secao, /cadastr|ver abaixo/i);
  }
});

test("PDF: destaques só com o que o texto oficial cita", async (t) => {
  silenciar(t);
  const pasta = pastaTemporaria(t);
  const original = ms.mapaDataUri;
  t.after(() => { ms.mapaDataUri = original; });
  ms.mapaDataUri = (comp) => original(comp, pasta);

  const rj = await ms.obterMonitorSecas({ uf: "RJ", competencia: AGOSTO, fetchFn: fetchFalso(), pasta });
  const secaoRj = secaoSeca(renderPdfHtml(relatorio(CIDADES.rio_de_janeiro, rj)));
  const intensidadesRj = secaoRj.match(/Intensidades citadas[\s\S]*?<\/div>/)[0];
  assert.match(intensidadesRj, /S0 Seca Fraca/);
  assert.doesNotMatch(intensidadesRj, /S1/, "o texto do RJ não cita S1");
  assert.match(secaoRj, /Curto e longo prazo \(CL\)/);
  assert.match(secaoRj, /Curto prazo \(C\)/);
  assert.match(secaoRj, /Evolução no mês/);

  const pr = await ms.obterMonitorSecas({ uf: "PR", competencia: AGOSTO, pasta });
  const secaoPr = secaoSeca(renderPdfHtml(relatorio(CIDADES.araucaria, pr)));
  assert.match(secaoPr, /Sem Seca Relativa/);
  assert.doesNotMatch(secaoPr, /Tipos de impacto citados/, "PR não cita impactos na fonte");
});

test("PDF: seção indisponível aparece sem quebrar o relatório", () => {
  const html = renderPdfHtml(relatorio(CIDADES.rio_de_janeiro, {
    status: "indisponivel", competencia: AGOSTO,
    mensagem: "Dados do Monitor de Secas de Agosto/2026 indisponíveis nesta emissão.",
    urls: { pagina: ms.urlPaginaMapa(AGOSTO) },
  }));
  const iMs = html.indexOf("Monitor de Secas — Agosto/2026");
  assert.ok(iMs > html.indexOf("Recomendações - Protocolo Meteorológico") && iMs < html.indexOf("Fontes Consultadas"));
  assert.match(html, /Não disponível na fonte para agosto\/2026/);
});
