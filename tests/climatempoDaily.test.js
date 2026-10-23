const test = require("node:test");
const assert = require("node:assert/strict");

const climatempo = require("../src/sources/climatempoDaily");
const { CIDADES } = require("../src/config/cities");
const { aplicarChuvaClimatempo } = require("../src/sources/previsaoProximosDias");

function resposta(nome = "Araucária", uf = "PR") {
  return {
    id: 123,
    name: nome,
    state: uf,
    data: [
      { date: "2026-10-21", rain: { precipitation: 18.5, probability: 85 } },
      { date: "2026-10-22", rain: { precipitation: 0, probability: 0 } },
      { date: "2026-10-23", rain: { precipitation: null, probability: 140 } },
      { date: "2026-10-24", rain: { precipitation: 7.2, probability: 60 } },
    ],
  };
}

function fetchFalso(corpo) {
  const chamadas = [];
  const fn = async (url) => {
    chamadas.push(url);
    return new Response(JSON.stringify(corpo), { status: 200 });
  };
  fn.chamadas = chamadas;
  return fn;
}

test("sem token/ID não consulta nem simula dados", async () => {
  let chamadas = 0;
  const r = await climatempo.obterChuvaDiariaClimatempo(CIDADES.araucaria, {
    env: {}, fetchImpl: async () => { chamadas += 1; }, salvarEvidencia: false,
  });
  assert.equal(r.status, "nao_configurada");
  assert.deepEqual(r.dias, []);
  assert.equal(chamadas, 0);
});

test("as 11 bases ativas possuem chave própria para o ID oficial do Advisor", () => {
  const cidades = Object.values(CIDADES);
  assert.equal(cidades.length, 11);
  assert.equal(new Set(cidades.map((cidade) => cidade.climatempo?.localeIdEnv)).size, 11);
  assert.ok(cidades.every((cidade) => cidade.climatempo?.municipio));
  assert.equal(CIDADES.natal.latitude, -5.8115);
  assert.equal(CIDADES.natal.longitude, -35.2415);
  assert.equal(CIDADES.oiapoque.latitude, 3.861224);
  assert.equal(CIDADES.oiapoque.longitude, -51.796699);
});

test("Cabiúnas não integra o cadastro operacional", () => {
  assert.equal(Object.hasOwn(CIDADES, "cabiunas"), false);
});

test("API Advisor valida localidade, data, chuva e probabilidade sem expor token", async () => {
  climatempo._cache.clear();
  const fetchImpl = fetchFalso(resposta());
  const env = { CLIMATEMPO_API_TOKEN: "segredo", CLIMATEMPO_LOCALE_ID_ARAUCARIA: "123" };
  const r = await climatempo.obterChuvaDiariaClimatempo(CIDADES.araucaria, {
    env, fetchImpl, agora: () => new Date("2026-10-21T12:00:00Z"), salvarEvidencia: false,
  });
  assert.equal(r.status, "operacional");
  assert.equal(r.localidade.nome, "Araucária");
  assert.equal(r.endpoint.includes("segredo"), false);
  assert.equal(fetchImpl.chamadas[0].includes("token=segredo"), true);
  assert.deepEqual(r.dias.map((d) => [d.data, d.chuvaMm, d.probabilidadeChuvaPct]), [
    ["2026-10-21", 18.5, 85], ["2026-10-22", 0, 0], ["2026-10-23", null, null], ["2026-10-24", 7.2, 60],
  ]);
});

test("Araucária rejeita ID que devolva Wenceslau Braz", async () => {
  climatempo._cache.clear();
  const env = { CLIMATEMPO_API_TOKEN: "segredo", CLIMATEMPO_LOCALE_ID_ARAUCARIA: "123" };
  await assert.rejects(
    climatempo.obterChuvaDiariaClimatempo(CIDADES.araucaria, {
      env, fetchImpl: fetchFalso(resposta("Wenceslau Braz", "PR")), salvarEvidencia: false,
    }),
    /não corresponde a Araucária/
  );
});

test("D+1, D+2 e D+3 recebem somente valores da mesma data", () => {
  const previsao = {
    fonte: "INMET / Open-Meteo",
    dias: [
      { data: "2026-10-22", chuvaMm: 9, probabilidadeChuvaPct: 10 },
      { data: "2026-10-23", chuvaMm: 8, probabilidadeChuvaPct: 20 },
      { data: "2026-10-24", chuvaMm: 7, probabilidadeChuvaPct: 30 },
    ],
    fontesCampo: { chuva: "Open-Meteo", probabilidadeChuva: "Open-Meteo" },
  };
  const resultado = aplicarChuvaClimatempo(previsao, {
    status: "operacional",
    dias: climatempo.normalizarResposta(CIDADES.araucaria, resposta(), {
      localeId: "123", consultadoEm: "2026-10-21T12:00:00Z", endpoint: "https://exemplo/sem-token",
    }).dias,
  });
  assert.deepEqual(resultado.dias.map((d) => [d.data, d.chuvaMm, d.probabilidadeChuvaPct]), [
    ["2026-10-22", 0, 0], ["2026-10-23", 8, 20], ["2026-10-24", 7.2, 60],
  ]);
  assert.equal(resultado.fontesCampo.chuva, "Climatempo Advisor / Open-Meteo");
  assert.equal(resultado.fontesCampo.probabilidadeChuva, "Climatempo Advisor / Open-Meteo");
});
