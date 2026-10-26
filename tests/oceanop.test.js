const test = require("node:test");
const assert = require("node:assert/strict");
const {
  ENDPOINT_PONTOS, ENDPOINT_AREA, FONTE, normalizarResposta, validarPonto, buscarOceanopPorCoordenadas, buscarOceanopDaBase,
  mapearOceanopParaVento, mapearOceanopParaProximosDias, limparCacheOceanop, cabecalhosAutorizacao,
} = require("../src/sources/oceanop");
const pontos = require("../src/config/oceanopPontos");
const { aplicarRajadaOceanop } = require("../src/logic/weatherSourcePolicy");
const { aplicarRajadasOceanop } = require("../src/sources/previsaoProximosDias");

const AREA = Object.freeze({
  id: "santos", latitude: -23.96, longitude: -46.33, referencia: "Santos — SP",
  fusoHorario: "America/Sao_Paulo", usarVento: true,
  unidades: { VelocidadeVento: "m/s", VelocidadeVento_10M_Rajada: "m/s", DirecaoVento: "graus" },
});
// Formato do exemplo da documentação: Local é o nome do campo, PointID é o ID enviado.
function registro(hora, rajada, extra = {}) {
  const h = String(hora).padStart(2, "0");
  return {
    PointID: "santos", Local: "Sururu", DataInicial: `23/10/2026 ${h}:00:00`, DataFinal: `23/10/2026 ${h}:59:59`,
    DirecaoVento: "97", VelocidadeVento: "9,52", VelocidadeVento_10M_Rajada: rajada, VelocidadeVento_50M_Rajada: "",
    DataEscrita: "23/10/2026 04:00:59", ...extra,
  };
}
const resposta = (data) => ({ ok: true, status: 200, json: async () => ({ success: true, data }) });
const AGORA = new Date("2026-10-23T08:10:00-03:00");

test("POST por coordenadas segue o contrato e aceita Local diferente do ID (PointID confere)", async () => {
  limparCacheOceanop();
  let chamada;
  const fetchImpl = async (url, init) => { chamada = { url: String(url), init }; return resposta([registro(9, "11,99")]); };
  const r = await buscarOceanopPorCoordenadas(AREA, { fetchImpl, tentativas: 1, logger: null, env: { OCEANOP_API_KEY: "k" } });
  assert.equal(chamada.url, ENDPOINT_PONTOS);
  assert.equal(chamada.init.method, "POST");
  assert.deepEqual(JSON.parse(chamada.init.body), [{ ID: "santos", Lat: -23.96, Lon: -46.33 }]);
  assert.equal(chamada.init.headers["X-API-Key"], "k");
  assert.equal(r.fonte, FONTE);
  assert.equal(r.previsoes[0].valores.VelocidadeVento_10M_Rajada, 11.99);
});

test("descarta resposta de outro ponto e resposta fora do contrato", async () => {
  limparCacheOceanop();
  const outro = async () => resposta([registro(9, "11,99", { PointID: "macae" })]);
  await assert.rejects(buscarOceanopPorCoordenadas(AREA, { fetchImpl: outro, tentativas: 1, logger: null, usarCache: false }), { code: "OCEANOP_POINT_MISMATCH" });
  assert.throws(() => normalizarResposta({ success: false, data: [] }), { code: "OCEANOP_INVALID_PAYLOAD" });
  assert.throws(() => validarPonto({ id: "", latitude: 0, longitude: 0 }), { code: "OCEANOP_INVALID_POINT" });
});

test("rajada em m/s é convertida para km/h e a maior da janela vira o pico", () => {
  const previsoes = normalizarResposta({ success: true, data: [registro(9, "10"), registro(11, "12,5"), registro(14, "8"), registro(2, "30")] }, { fusoHorario: AREA.fusoHorario });
  const vento = mapearOceanopParaVento({ previsoes }, AREA, { agora: AGORA, inicioHora: 8, fimHora: 15 });
  assert.equal(vento.resumo.rajadaMaxKmh, 45); // 12,5 m/s × 3,6; 02h fora da janela
  assert.equal(vento.resumo.rajadaPrevistaEm, "2026-10-23T11:00"); // registro das 11h locais (14:00Z)
  assert.equal(vento.resumo.periodoReferencia, "23/10/2026 11:00–11:59");
  assert.equal(vento.manha.rajadaMaxKmh, 45);
  assert.equal(vento.tarde.rajadaMaxKmh, 28.8);
  assert.equal(vento.noite, null);
});

test("sem unidade válida o ponto é recusado e nada é inventado", () => {
  const previsoes = normalizarResposta({ success: true, data: [registro(9, "10")] }, { fusoHorario: AREA.fusoHorario });
  const semUnidade = { ...AREA, unidades: { DirecaoVento: "graus" } };
  assert.throws(() => mapearOceanopParaVento({ previsoes }, semUnidade, { agora: AGORA }), { code: "OCEANOP_WIND_METADATA_UNCONFIRMED" });
  assert.throws(() => mapearOceanopParaVento({ previsoes: [] }, AREA, { agora: AGORA }), { code: "OCEANOP_NO_CURRENT_DATA" });
});

test("rajada OCEANOP substitui a Open-Meteo por período e no total, preservando a contingência", () => {
  const previsoes = normalizarResposta({ success: true, data: [registro(9, "10"), registro(20, "5")] }, { fusoHorario: AREA.fusoHorario });
  const ventoOceanop = { ...mapearOceanopParaVento({ previsoes }, AREA, { agora: AGORA, inicioHora: 8, fimHora: 24 }), unidadeOriginal: "m/s" };
  const base = { rajadaMaxKmh: 20, periodos: { manha: { rajadaMaxKmh: 20, fonteRajada: "Open-Meteo" }, tarde: { rajadaMaxKmh: 15, fonteRajada: "Open-Meteo" }, noite: { rajadaMaxKmh: 10 } } };
  const fontes = {};
  aplicarRajadaOceanop({ base, ventoOceanop, fontesPorCampo: fontes });
  assert.equal(base.periodos.manha.rajadaMaxKmh, 36);
  assert.equal(base.periodos.manha.fonteRajada, FONTE);
  assert.equal(base.periodos.tarde.rajadaMaxKmh, 15); // sem registro OCEANOP: mantém Open-Meteo
  assert.equal(base.periodos.tarde.fonteRajada, "Open-Meteo");
  assert.equal(base.periodos.noite.rajadaMaxKmh, 18);
  assert.equal(base.rajadaMaxKmh, 36);
  assert.equal(base.rajadaPrioritariaReferencia.fonte, FONTE);
  assert.equal(fontes.rajadaMaxKmh, FONTE);
  const semOceanop = { rajadaMaxKmh: 20, periodos: {} };
  aplicarRajadaOceanop({ base: semOceanop, ventoOceanop: null, fontesPorCampo: {} });
  assert.equal(semOceanop.rajadaMaxKmh, 20);
});

test("próximos dias recebem a máxima diária OCEANOP e mantêm os demais dias", () => {
  const dia = (d, h, r) => registro(h, r, { DataInicial: `${d}/10/2026 ${String(h).padStart(2, "0")}:00:00`, DataFinal: `${d}/10/2026 ${String(h).padStart(2, "0")}:59:59` });
  const previsoes = normalizarResposta({ success: true, data: [dia(24, 9, "10"), dia(24, 15, "12"), dia(26, 9, "5")] }, { fusoHorario: AREA.fusoHorario });
  const dias = mapearOceanopParaProximosDias({ previsoes }, AREA, { agora: AGORA });
  assert.deepEqual(dias.map((d) => [d.data, d.rajadaMaxKmh]), [["2026-10-24", 43.2], ["2026-10-26", 18]]);
  const previsao = { dias: [{ data: "2026-10-24", rajadaMaxKmh: 99, fonteRajada: "Open-Meteo" }, { data: "2026-10-25", rajadaMaxKmh: 30, fonteRajada: "Open-Meteo" }], fontesCampo: {} };
  const final = aplicarRajadasOceanop(previsao, dias);
  assert.equal(final.dias[0].rajadaMaxKmh, 43.2);
  assert.equal(final.dias[0].fonteRajada, FONTE);
  assert.equal(final.dias[1].fonteRajada, "Open-Meteo");
});

test("todas as bases do projeto têm acesso OCEANOP padronizado", () => {
  const { CIDADES } = require("../src/config/cities");
  assert.deepEqual(Object.keys(pontos).sort(), Object.keys(CIDADES).sort());
  for (const [chave, ponto] of Object.entries(pontos)) {
    assert.ok(["coordenadas", "area", "ausente"].includes(ponto.modo), chave);
    assert.equal(ponto.habilitado, ponto.modo !== "ausente", chave);
    assert.equal(ponto.unidades.VelocidadeVento_10M_Rajada, "nós");
    assert.equal(ponto.fusoDados, "UTC");
    assert.equal(ponto.fusoHorario, CIDADES[chave].fusoHorario || "America/Sao_Paulo");
    if (ponto.modo === "coordenadas") validarPonto(ponto);
    if (ponto.modo === "area") assert.ok(ponto.localArea && ponto.locaisAceitos.length, chave);
    if (ponto.modo === "ausente") assert.match(ponto.motivo, /OCEANOP/, chave);
  }
});

test("20,42 nós = 37,8 km/h na base de Santos", () => {
  const previsoes = normalizarResposta({ success: true, data: [registro(14, "20,42")] }, { fusoHorario: pontos.santos.fusoDados });
  const { resumo } = mapearOceanopParaVento({ previsoes }, pontos.santos, { agora: AGORA, inicioHora: 0, fimHora: 24, exigirFuturo: false });
  assert.equal(resumo.rajadaMaxKmh, 37.8);
});

test("datas do OCEANOP são lidas em UTC e a janela usa o fuso local da base", () => {
  // 11:00 UTC = 08:00 em Santos; entra na janela 08h–15h locais.
  const previsoes = normalizarResposta({ success: true, data: [registro(11, "10"), registro(5, "30")] }, { fusoHorario: "UTC" });
  assert.equal(previsoes[1].inicioEm, "2026-10-23T11:00:00.000Z");
  const ponto = { ...AREA, unidades: { ...AREA.unidades, VelocidadeVento_10M_Rajada: "nós" } };
  const vento = mapearOceanopParaVento({ previsoes }, ponto, { agora: new Date("2026-10-23T10:00:00Z"), inicioHora: 8, fimHora: 15 });
  assert.equal(vento.resumo.rajadaMaxKmh, 18.5); // o registro de 05h UTC (02h local) fica fora
});

test("resposta vazia vira 'sem cobertura', não 'ponto errado'", async () => {
  limparCacheOceanop();
  const vazio = async () => resposta([]);
  await assert.rejects(buscarOceanopPorCoordenadas(AREA, { fetchImpl: vazio, tentativas: 1, logger: null, usarCache: false }), { code: "OCEANOP_NO_COVERAGE" });
});

test("modo área: GET por nome, filtra apenas os locais aceitos", async () => {
  limparCacheOceanop();
  const ponto = { ...pontos.macae };
  let url;
  const fetchImpl = async (u) => { url = new URL(String(u)); return resposta([
    registro(11, "12", { PointID: undefined, Local: "Macaé" }),
    registro(11, "15", { PointID: undefined, Local: "Macaé (SBME)" }),
    registro(11, "99", { PointID: undefined, Local: "Outra Área" }),
  ]); };
  const r = await buscarOceanopDaBase(ponto, { fetchImpl, tentativas: 1, logger: null, usarCache: false });
  assert.equal(`${url.origin}${url.pathname}`, ENDPOINT_AREA);
  assert.equal(url.searchParams.get("local"), "macaé");
  assert.equal(r.modo, "area");
  assert.deepEqual(r.previsoes.map((p) => p.local).sort(), ["Macaé", "Macaé (SBME)"]);
  const vazio = async () => resposta([registro(11, "9", { Local: "Outra Área" })]);
  await assert.rejects(buscarOceanopDaBase(ponto, { fetchImpl: vazio, tentativas: 1, logger: null, usarCache: false }), { code: "OCEANOP_NO_COVERAGE" });
});

test("base sem ponto cadastrado não consulta a API", async () => {
  let chamadas = 0;
  await assert.rejects(buscarOceanopDaBase(pontos.manaus, { fetchImpl: async () => { chamadas++; }, usarCache: false }), { code: "OCEANOP_NOT_CONFIGURED" });
  assert.equal(chamadas, 0);
});

test("usuário e senha viram HTTP Basic só quando não há chave nem token", () => {
  const basic = `Basic ${Buffer.from("maria:s3nh@").toString("base64")}`;
  assert.deepEqual(cabecalhosAutorizacao({ OCEANOP_USUARIO: "maria", OCEANOP_SENHA: "s3nh@" }), { Authorization: basic });
  assert.deepEqual(cabecalhosAutorizacao({ OCEANOP_USUARIO: "maria" }), {});
  assert.deepEqual(cabecalhosAutorizacao({ OCEANOP_USUARIO: "maria", OCEANOP_SENHA: "x", OCEANOP_API_KEY: "k" }), { "X-API-Key": "k" });
  assert.deepEqual(cabecalhosAutorizacao({ OCEANOP_USUARIO: "maria", OCEANOP_SENHA: "x", OCEANOP_ACCESS_TOKEN: "t" }), { Authorization: "Bearer t" });
});
