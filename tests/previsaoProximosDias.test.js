const test = require("node:test");
const assert = require("node:assert/strict");

const p3d = require("../src/sources/previsaoProximosDias");
const { renderPdfHtml } = require("../src/render/pdfTemplate");
const { CIDADES } = require("../src/config/cities");

function respostaOpenMeteo({ fuso = "America/Sao_Paulo", time, sobrescrever = {}, unidades = {} } = {}) {
  return {
    latitude: -22.31986,
    longitude: -41.97519,
    utc_offset_seconds: -10800,
    timezone: fuso,
    daily_units: {
      time: "iso8601", weather_code: "wmo code", temperature_2m_max: "°C", temperature_2m_min: "°C",
      wind_gusts_10m_max: "km/h", precipitation_sum: "mm", uv_index_max: "", ...unidades,
    },
    daily: {
      time,
      weather_code: [81, 95, 0],
      temperature_2m_max: [25.1, 21.1, 31.0],
      temperature_2m_min: [20.5, 20.0, 20.1],
      wind_gusts_10m_max: [24.1, 24.8, 34.6],
      precipitation_sum: [55.3, 59.2, 0],
      uv_index_max: [4.6, 1.45, 8.55],
      ...sobrescrever,
    },
  };
}

function fetchFalso(corpo, status = 200) {
  const chamadas = [];
  const fn = async (url) => {
    chamadas.push(url);
    return new Response(JSON.stringify(corpo), { status });
  };
  fn.chamadas = chamadas;
  return fn;
}

function silenciar(t) {
  t.mock.method(console, "error", () => {});
  t.mock.method(console, "warn", () => {});
}

const DATAS_MACAE = ["2026-10-02", "2026-10-03", "2026-10-04"];
// 01/10/2026 14:30 em Brasília.
const AGORA = new Date("2026-10-01T17:30:00Z");

test("três dias seguintes, sem o dia atual, no fuso da localidade", () => {
  assert.deepEqual(p3d.proximasDatas(AGORA, "America/Sao_Paulo"), DATAS_MACAE);
  // Virada de mês/ano.
  assert.deepEqual(p3d.proximasDatas(new Date("2026-12-30T15:00:00Z"), "America/Sao_Paulo"),
    ["2026-12-31", "2027-01-01", "2027-01-02"]);
  // 00:30 em Brasília ainda é 23:30 do dia anterior em Manaus.
  const instante = new Date("2026-10-02T03:30:00Z");
  assert.deepEqual(p3d.proximasDatas(instante, "America/Sao_Paulo"), ["2026-10-03", "2026-10-04", "2026-10-05"]);
  assert.deepEqual(p3d.proximasDatas(instante, p3d.fusoDaCidade(CIDADES.manaus)), DATAS_MACAE);
  assert.equal(p3d.fusoDaCidade(CIDADES.macae), "America/Sao_Paulo");
});

test("consulta a mesma localidade do informativo, no fuso dela e só nas três datas", async () => {
  const fetchImpl = fetchFalso(respostaOpenMeteo({ time: DATAS_MACAE }));
  const r = await p3d.obterPrevisaoProximosDias(CIDADES.macae, { agora: AGORA, fetchImpl });
  const url = new URL(fetchImpl.chamadas[0]);
  assert.equal(url.searchParams.get("latitude"), String(CIDADES.macae.latitude));
  assert.equal(url.searchParams.get("longitude"), String(CIDADES.macae.longitude));
  assert.equal(url.searchParams.get("timezone"), "America/Sao_Paulo");
  assert.equal(url.searchParams.get("start_date"), "2026-10-02");
  assert.equal(url.searchParams.get("end_date"), "2026-10-04");
  assert.match(url.searchParams.get("daily"), /wind_gusts_10m_max/);
  assert.doesNotMatch(url.searchParams.get("daily"), /wind_speed|probability/);

  assert.equal(r.status, "ok");
  assert.equal(r.localidade.nome, "Macaé");
  assert.deepEqual(r.dias.map((d) => d.dataFormatada), ["02/10/2026", "03/10/2026", "04/10/2026"]);
  assert.deepEqual(r.dias[0], {
    data: "2026-10-02", dataFormatada: "02/10/2026", diaSemana: "sexta-feira",
    tempMaxC: 25.1, tempMinC: 20.5, rajadaMaxKmh: 24.1, chuvaMm: 55.3, uvMax: 4.6,
    codigoTempo: 81, condicao: "Pancadas de chuva",
  });
  assert.equal(r.dias[1].condicao, "Chuva com trovoadas");
  assert.equal(r.dias[2].condicao, "Ensolarado");
  assert.equal(r.dias[2].chuvaMm, 0, "zero real da fonte é mantido");
});

test("valor ausente vira null e nunca é preenchido com outro dia", async (t) => {
  silenciar(t);
  // A fonte devolve só dois dias e um campo nulo.
  const corpo = respostaOpenMeteo({
    time: ["2026-10-02", "2026-10-03"],
    sobrescrever: { uv_index_max: [null, 1.45], weather_code: [81, 95], temperature_2m_max: [25.1, 21.1],
      temperature_2m_min: [20.5, 20], wind_gusts_10m_max: [24.1, 24.8], precipitation_sum: [55.3, 59.2] },
  });
  const r = await p3d.obterPrevisaoProximosDias(CIDADES.macae, { agora: AGORA, fetchImpl: fetchFalso(corpo) });
  assert.equal(r.status, "parcial");
  assert.equal(r.dias[0].uvMax, null);
  assert.equal(r.dias[1].uvMax, 1.45);
  assert.equal(r.dias[2].data, "2026-10-04");
  assert.equal(r.dias[2].tempMaxC, null);
  assert.equal(r.dias[2].condicao, null);
});

test("unidade inesperada não é exibida com rótulo errado", async (t) => {
  silenciar(t);
  const corpo = respostaOpenMeteo({ time: DATAS_MACAE, unidades: { wind_gusts_10m_max: "m/s" } });
  const r = await p3d.obterPrevisaoProximosDias(CIDADES.macae, { agora: AGORA, fetchImpl: fetchFalso(corpo) });
  assert.ok(r.dias.every((d) => d.rajadaMaxKmh === null));
  assert.equal(r.dias[0].tempMaxC, 25.1);
});

test("falha da fonte não lança e mantém as três datas sem valores", async (t) => {
  silenciar(t);
  const r = await p3d.obterPrevisaoProximosDias(CIDADES.macae, {
    agora: AGORA, fetchImpl: fetchFalso({ erro: true }, 500), esperarFn: async () => {},
  });
  assert.equal(r.status, "indisponivel");
  assert.deepEqual(r.dias.map((d) => d.data), DATAS_MACAE);
  assert.ok(r.dias.every((d) => d.tempMaxC === null && d.chuvaMm === null && d.condicao === null));
});

test("fuso divergente na resposta é rejeitado", async (t) => {
  silenciar(t);
  const corpo = respostaOpenMeteo({ time: DATAS_MACAE, fuso: "GMT" });
  const r = await p3d.obterPrevisaoProximosDias(CIDADES.macae, { agora: AGORA, fetchImpl: fetchFalso(corpo) });
  assert.equal(r.status, "indisponivel");
});

function reportMinimo(previsaoProximosDias) {
  return {
    cidade: { chave: "macae", nome: "Macaé", uf: "RJ" },
    dataFormatadaLonga: "quinta-feira, 1 de outubro de 2026",
    dataFormatadaCurta: "01/10/2026",
    horaConsulta: "14:30",
    tabelaTemperaturaUmidade: [],
    ventoPorPeriodo: [],
    chuvaPorPeriodo: [],
    deslocamento: { pedestres: [], transporte: [], condutores: [] },
    edificacao: [{ titulo: "Seção final existente", itens: ["Item"] }],
    previsaoProximosDias,
  };
}

test("PDF: seção ao final, com unidades nos títulos e 'Não disponível' em vez de zero", async (t) => {
  silenciar(t);
  const corpo = respostaOpenMeteo({ time: DATAS_MACAE, sobrescrever: { uv_index_max: [4.6, null, 8.55] } });
  const previsao = await p3d.obterPrevisaoProximosDias(CIDADES.macae, { agora: AGORA, fetchImpl: fetchFalso(corpo) });
  const html = renderPdfHtml(reportMinimo(previsao));

  const titulo = html.indexOf("4. Previsão para os próximos 3 dias");
  assert.ok(titulo > html.indexOf("Seção final existente"), "seção depois das existentes");
  const secao = html.slice(titulo);
  const cabecalhos = ["Data", "Temperatura Máx./Mín. (°C)", "Rajada prevista (km/h)", "Chuva acumulada (mm)", "Índice UV (máx.)", "Calor", "Condição geral"];
  const posicoes = cabecalhos.map((cabecalho) => secao.indexOf(`${cabecalho}</th>`));
  assert.ok(posicoes.every((p) => p >= 0), "todas as colunas presentes");
  assert.deepEqual([...posicoes].sort((a, b) => a - b), posicoes, "ordem: Data, Temperatura, Rajada, Chuva, UV, Calor, Condição");
  assert.ok(secao.includes("<strong>02/10/2026</strong>"));
  assert.ok(secao.includes("<strong>04/10/2026</strong>"));
  assert.ok(!secao.includes("01/10/2026</strong>"), "dia atual não entra");
  assert.ok(secao.includes(">55,3<"));
  assert.ok(secao.includes(">0,0<"), "zero real exibido como zero");
  assert.ok(secao.includes(">4,6<") && secao.includes(">8,6<"), "UV real de cada data");
  assert.equal((secao.match(/Não disponível<\/span>/g) || []).length, 1, "só o UV ausente");
  assert.ok(secao.includes("índice UV = máximo previsto no dia"));
  assert.equal((secao.match(/class="calor-nd">Indisponível</g) || []).length, 3, "sem fonte de calor: indisponível, não Normal");
  assert.ok(secao.includes('<p class="fonte-tabela">Fonte de dados meteorológicos: Open-Meteo'));
  assert.ok(secao.includes("Fonte de dados de calor:"));
  assert.ok(secao.includes("Macaé — RJ"));
});

test("PDF: calor por data segue a fonte Clima e Saúde, sem repetir o nível de hoje", async (t) => {
  silenciar(t);
  const previsao = await p3d.obterPrevisaoProximosDias(CIDADES.macae, { agora: AGORA, fetchImpl: fetchFalso(respostaOpenMeteo({ time: DATAS_MACAE })) });
  const html = renderPdfHtml({ ...reportMinimo(previsao), climaSaude: { status: "operacional", dados: {
    source: "Clima e Saúde — Ministério da Saúde", dataConsulta: "2026-10-01", ehf: { classificacao: "Severo" },
    previsaoDias: [
      { data: "2026-10-01", classificacao: "Severo" },
      { data: "2026-10-02", classificacao: "Baixo" },
      { data: "2026-10-03", classificacao: "Sem excesso" },
    ],
  } } });
  const secao = html.slice(html.indexOf("4. Previsão para os próximos 3 dias"));
  const linhas = secao.split("<tr").slice(2);
  assert.match(linhas[0], /color:#[0-9A-F]{6};">Atenção</i, "02/10: Baixo → Atenção");
  assert.match(linhas[1], /color:#2E7D32;">Normal</, "03/10: Sem excesso → Normal");
  assert.match(linhas[2], /class="calor-nd">Indisponível</, "04/10 sem dado na fonte");
  assert.doesNotMatch(secao.slice(0, secao.indexOf("</table>")), /Alerta/, "o Alerta de hoje não é repetido");
});

test("PDF: fonte indisponível mantém a seção com as datas", async (t) => {
  silenciar(t);
  const previsao = await p3d.obterPrevisaoProximosDias(CIDADES.macae, {
    agora: AGORA, fetchImpl: async () => { throw new TypeError("fetch failed"); }, esperarFn: async () => {},
  });
  const html = renderPdfHtml(reportMinimo(previsao));
  const secao = html.slice(html.indexOf("4. Previsão para os próximos 3 dias"));
  assert.ok(secao.includes("Fonte indisponível nesta emissão"));
  assert.equal((secao.match(/<strong>0[234]\/10\/2026<\/strong>/g) || []).length, 3);
  assert.equal((secao.match(/Não disponível<\/span>/g) || []).length, 15);
  assert.equal((secao.match(/class="calor-nd">Indisponível</g) || []).length, 3);
});
