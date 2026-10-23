const test = require("node:test");
const assert = require("node:assert/strict");
const {
  ENDPOINT, ENDPOINT_PONTOS, FONTE, numero, numeroNoIntervalo, normalizarResposta,
  validarConsulta, validarPonto, buscarOceanop, buscarOceanopPorCoordenadas, mapearOceanopParaVento,
  mapearOceanopParaProximosDias, limparCacheOceanop, obterDiagnosticoOceanop,
  normalizarIdentificadorLocal,
} = require("../src/sources/oceanop");
const oceanopAreas = require("../src/config/oceanopAreas");
const { CIDADES } = require("../src/config/cities");
const oceanopPontos = require("../src/config/oceanopPontos");

const UNIDADES = Object.freeze({
  VelocidadeVento: "m/s",
  VelocidadeVento_10M_Rajada: "m/s",
  DirecaoVento: "graus",
});
function area(extra = {}) {
  return {
    local: "AREA-A", habilitado: true, referencia: "Área A",
    fusoHorario: "America/Sao_Paulo", usarVento: true, unidades: UNIDADES,
    ...extra,
  };
}
function registro(data, inicio, extra = {}) {
  const horaFim = String(Number(inicio.slice(0, 2)) + 1).padStart(2, "0");
  return {
    Local: "Área A", DataInicial: `${data} ${inicio}:00`, DataFinal: `${data} ${horaFim}:59:59`,
    DataEscrita: `${data} 04:30:00`, VelocidadeVento: "2,91",
    VelocidadeVento_10M_Rajada: "4,99", DirecaoVento: "180", Precipitacao: "0",
    Condicao_Clima: "cloudy", ...extra,
  };
}
function resposta(data = [registro("20/10/2026", "05:00")]) {
  return { ok: true, status: 200, json: async () => ({ success: true, data }) };
}

test("converte vírgula decimal, preserva zero e não fabrica ausentes", () => {
  assert.equal(numero("24,67"), 24.67);
  assert.equal(numero("0"), 0);
  for (const valor of ["", null, " ", "2,3,4", undefined, NaN]) assert.equal(numero(valor), null);
  assert.equal(numeroNoIntervalo("361", "DirecaoVento"), null);
  assert.equal(numeroNoIntervalo("360", "DirecaoVento"), 360);
});

test("POST por coordenadas usa contrato Swagger e associa retorno ao ID da base", async () => {
  limparCacheOceanop();
  const chamadas = [];
  const ponto = oceanopPontos.brasilia;
  const dados = [registro("22/10/2026", "12:00", { Local: "brasilia" })];
  const resultado = await buscarOceanopPorCoordenadas(ponto, {
    fetchImpl: async (url, opcoes) => {
      chamadas.push({ url: String(url), opcoes });
      return resposta(dados);
    },
    tentativas: 1,
    env: { OCEANOP_API_KEY: "segredo-de-teste" },
  });
  assert.equal(chamadas[0].url, ENDPOINT_PONTOS);
  assert.equal(chamadas[0].opcoes.method, "POST");
  assert.deepEqual(JSON.parse(chamadas[0].opcoes.body), [{ ID: "brasilia", Lat: CIDADES.brasilia.latitude, Lon: CIDADES.brasilia.longitude }]);
  assert.equal(chamadas[0].opcoes.headers["X-API-Key"], "segredo-de-teste");
  assert.equal(resultado.consulta.id, "brasilia");
  assert.equal(resultado.previsoes[0].local, "brasilia");
});

test("cache por coordenadas é isolado entre bases e deduplica chamadas simultâneas", async () => {
  limparCacheOceanop();
  let chamadas = 0;
  const fetchImpl = async (_url, opcoes) => {
    chamadas += 1;
    const [{ ID }] = JSON.parse(opcoes.body);
    await new Promise((resolve) => setTimeout(resolve, 5));
    return resposta([registro("22/10/2026", "12:00", { Local: ID })]);
  };
  const opcoes = {
    fetchImpl, tentativas: 1, logger: null,
    agora: () => new Date("2026-10-22T12:00:00Z"),
  };
  const [primeiro, duplicado] = await Promise.all([
    buscarOceanopPorCoordenadas(oceanopPontos.brasilia, opcoes),
    buscarOceanopPorCoordenadas(oceanopPontos.brasilia, opcoes),
  ]);
  const rio = await buscarOceanopPorCoordenadas(oceanopPontos.rio_de_janeiro, opcoes);
  const cacheBrasilia = await buscarOceanopPorCoordenadas(oceanopPontos.brasilia, opcoes);
  assert.equal(chamadas, 2);
  assert.equal(primeiro.previsoes[0].local, "brasilia");
  assert.equal(duplicado.previsoes[0].local, "brasilia");
  assert.equal(rio.previsoes[0].local, "rio_de_janeiro");
  assert.equal(cacheBrasilia.cache, true);
});

test("pontos cobrem todas as bases e Brasília não habilita produto marítimo", () => {
  assert.deepEqual(Object.keys(oceanopPontos).sort(), Object.keys(CIDADES).sort());
  Object.values(oceanopPontos).forEach(validarPonto);
  assert.equal(oceanopPontos.brasilia.usarVento, true);
  assert.equal(oceanopPontos.brasilia.usarMar, false);
  assert.deepEqual([oceanopPontos.brasilia.latitude, oceanopPontos.brasilia.longitude], [-15.7939869, -47.8828]);
});

test("valida apenas identificador local e nunca aceita coordenadas no lugar dele", () => {
  assert.deepEqual(validarConsulta(" sururu "), { local: "sururu" });
  assert.deepEqual(validarConsulta(area()), { local: "AREA-A" });
  assert.throws(() => validarConsulta({ latitude: -22, longitude: -43 }), /identificador local/);
  assert.throws(() => validarConsulta("lo\ncal"), /identificador local/);
});

test("normaliza somente variações textuais equivalentes do identificador local", () => {
  assert.equal(normalizarIdentificadorLocal("  Macaé  "), "macae");
  assert.equal(normalizarIdentificadorLocal("RIO-DE JANEIRO"), "rio de janeiro");
  assert.notEqual(normalizarIdentificadorLocal("Brasília"), normalizarIdentificadorLocal("Rio de Janeiro"));
});

test("habilita as sete bases informadas em km/h e preserva o fuso de Manaus", () => {
  assert.deepEqual(Object.keys(oceanopAreas).sort(), [
    "araucaria", "brasilia", "macae", "manaus", "rio_de_janeiro", "santos", "vitoria",
  ]);
  for (const areaConfigurada of Object.values(oceanopAreas)) {
    assert.equal(areaConfigurada.habilitado, true);
    assert.equal(areaConfigurada.usarVento, true);
    assert.equal(areaConfigurada.unidades.VelocidadeVento, "km/h");
    assert.equal(areaConfigurada.unidades.VelocidadeVento_10M_Rajada, "km/h");
  }
  assert.equal(oceanopAreas.manaus.fusoHorario, "America/Manaus");
  assert.equal(oceanopAreas.santos.fusoHorario, "America/Sao_Paulo");
});

test("não converte novamente a rajada que a OCEANOP fornece em km/h", () => {
  const areaKmh = oceanopAreas.santos;
  const previsoes = normalizarResposta({
    success: true,
    data: [registro("20/10/2026", "05:00", { VelocidadeVento_10M_Rajada: "4,99" })],
  }, { fusoHorario: areaKmh.fusoHorario });
  const vento = mapearOceanopParaVento({ previsoes }, areaKmh, {
    agora: new Date("2026-10-20T07:30:00Z"), inicioHora: 5, fimHora: 15,
  });
  assert.equal(vento.resumo.rajadaMaxKmh, 5);
});

test("GET sem token envia somente a query local codificada", async () => {
  limparCacheOceanop();
  let chamada;
  const resultado = await buscarOceanop(area({ local: "Área Sururu" }), {
    usarCache: false, tentativas: 1, logger: null,
    agora: () => new Date("2026-10-20T08:00:00Z"),
    fetchImpl: async (url, init) => {
      chamada = { url: String(url), init };
      return resposta([registro("20/10/2026", "05:00", { Local: "Área Sururu" })]);
    },
  });
  const url = new URL(chamada.url);
  assert.equal(url.origin + url.pathname, ENDPOINT);
  assert.deepEqual([...url.searchParams], [["local", "Área Sururu"]]);
  assert.equal(chamada.init.method, "GET");
  assert.equal(chamada.init.body, undefined);
  assert.equal(chamada.init.headers.Accept, "application/json");
  assert.equal(chamada.init.headers.Authorization, undefined);
  assert.equal(resultado.previsoes[0].valores.VelocidadeVento_10M_Rajada, 4.99);
  assert.equal(resultado.previsoes[0].valores.Precipitacao, 0);
});

test("descarta resposta de outra localidade antes de armazenar ou promover dados", async () => {
  limparCacheOceanop();
  const areaBrasilia = oceanopAreas.brasilia;
  const fetchImpl = async () => resposta([
    registro("20/10/2026", "05:00", { Local: "Rio de Janeiro" }),
  ]);
  await assert.rejects(
    buscarOceanop(areaBrasilia, { fetchImpl, tentativas: 1, logger: null }),
    { code: "OCEANOP_LOCATION_MISMATCH" },
  );
  assert.equal(obterDiagnosticoOceanop().status, "INDISPONIVEL");
});

test("cache OCEANOP permanece isolado entre Brasília e Rio de Janeiro", async () => {
  limparCacheOceanop();
  const chamadas = [];
  const fetchImpl = async (url) => {
    const local = new URL(url).searchParams.get("local");
    chamadas.push(local);
    return resposta([registro("20/10/2026", "05:00", { Local: local })]);
  };
  const opcoes = { fetchImpl, tentativas: 1, logger: null, agora: () => new Date("2026-10-20T08:00:00Z") };
  const brasilia = await buscarOceanop(oceanopAreas.brasilia, opcoes);
  const rio = await buscarOceanop(oceanopAreas.rio_de_janeiro, opcoes);
  const brasiliaCache = await buscarOceanop(oceanopAreas.brasilia, opcoes);
  assert.deepEqual(chamadas, [oceanopAreas.brasilia.local, oceanopAreas.rio_de_janeiro.local]);
  assert.equal(brasilia.previsoes[0].local, oceanopAreas.brasilia.local);
  assert.equal(rio.previsoes[0].local, oceanopAreas.rio_de_janeiro.local);
  assert.equal(brasiliaCache.cache, true);
  assert.equal(brasiliaCache.previsoes[0].local, oceanopAreas.brasilia.local);
});

test("Brasília usa somente vento OCEANOP e nunca recebe produto marítimo", () => {
  assert.notEqual(CIDADES.brasilia.costeira, true);
  assert.equal(oceanopAreas.brasilia.usarVento, true);
  assert.notEqual(oceanopAreas.brasilia.usarMar, true);
});

test("valida success/data não vazio, datas e ordenação cronológica", () => {
  const previsoes = normalizarResposta({ success: true, data: [
    registro("20/10/2026", "18:00"), registro("20/10/2026", "05:00", { VelocidadeVento: "" }),
  ] }, { fusoHorario: "America/Sao_Paulo" });
  assert.equal(previsoes[0].inicio, "20/10/2026 05:00:00");
  assert.equal(previsoes[0].inicioEm, "2026-10-20T08:00:00.000Z");
  assert.equal(previsoes[0].valores.VelocidadeVento, null);
  assert.equal(previsoes[1].valores.Condicao_Clima, "cloudy");
  for (const payload of [{ success: false, data: [] }, { success: true, data: {} }, null]) {
    assert.throws(() => normalizarResposta(payload), { code: "OCEANOP_INVALID_PAYLOAD" });
  }
});

test("seleciona a maior rajada da janela 05h–15h e registra horário/área/fonte", () => {
  const a = area();
  const previsoes = normalizarResposta({ success: true, data: [
    registro("20/10/2026", "05:00", { VelocidadeVento_10M_Rajada: "5" }),
    registro("20/10/2026", "12:00", { VelocidadeVento_10M_Rajada: "12", DirecaoVento: "90" }),
    registro("20/10/2026", "18:00", { VelocidadeVento_10M_Rajada: "30" }),
  ] }, { fusoHorario: a.fusoHorario });
  const vento = mapearOceanopParaVento({ previsoes }, a, {
    agora: new Date("2026-10-20T07:30:00Z"), inicioHora: 5, fimHora: 15,
  });
  assert.equal(vento.resumo.rajadaMaxKmh, 43.2);
  assert.equal(vento.resumo.rajadaPrevistaEm, "2026-10-20T15:00:00.000Z");
  assert.equal(vento.resumo.local, "Área A");
  assert.equal(vento.resumo.fonte, FONTE);
  assert.equal(vento.noite, null);
});

test("janela 15h–00h não mistura a rajada da manhã", () => {
  const a = area();
  const previsoes = normalizarResposta({ success: true, data: [
    registro("20/10/2026", "05:00", { VelocidadeVento_10M_Rajada: "30" }),
    registro("20/10/2026", "15:00", { VelocidadeVento_10M_Rajada: "8" }),
    registro("20/10/2026", "20:00", { VelocidadeVento_10M_Rajada: "10" }),
  ] }, { fusoHorario: a.fusoHorario });
  const vento = mapearOceanopParaVento({ previsoes }, a, {
    agora: new Date("2026-10-20T17:30:00Z"), inicioHora: 15, fimHora: 24,
  });
  assert.equal(vento.resumo.rajadaMaxKmh, 36);
  assert.equal(vento.manha, null);
});

test("direção média trata corretamente a passagem por 360 graus", () => {
  const a = area();
  const previsoes = normalizarResposta({ success: true, data: [
    registro("20/10/2026", "05:00", { DirecaoVento: "350" }),
    registro("20/10/2026", "06:00", { DirecaoVento: "10" }),
  ] }, { fusoHorario: a.fusoHorario });
  const vento = mapearOceanopParaVento({ previsoes }, a, {
    agora: new Date("2026-10-20T07:30:00Z"), inicioHora: 5, fimHora: 15,
  });
  assert.equal(vento.manha.direcaoGraus, 0);
  assert.equal(vento.manha.direcao, "N");
});

test("não converte nem promove vento sem unidade e fuso homologados", () => {
  assert.throws(() => mapearOceanopParaVento({ previsoes: [] }, area({ unidades: {} })), { code: "OCEANOP_WIND_METADATA_UNCONFIRMED" });
  assert.throws(() => mapearOceanopParaVento({ previsoes: [] }, area({ fusoHorario: null })), { code: "OCEANOP_WIND_METADATA_UNCONFIRMED" });
});

test("extrai máximas OCEANOP para D+1 a D+3", () => {
  const a = area();
  const previsoes = normalizarResposta({ success: true, data: [
    registro("21/10/2026", "05:00", { VelocidadeVento_10M_Rajada: "10" }),
    registro("21/10/2026", "15:00", { VelocidadeVento_10M_Rajada: "15" }),
    registro("22/10/2026", "12:00", { VelocidadeVento_10M_Rajada: "8" }),
  ] }, { fusoHorario: a.fusoHorario });
  const dias = mapearOceanopParaProximosDias({ previsoes }, a, { agora: new Date("2026-10-20T12:00:00Z") });
  assert.deepEqual(dias.map((d) => [d.data, d.rajadaMaxKmh]), [["2026-10-21", 54], ["2026-10-22", 28.8]]);
});

test("deduplica concorrência, usa cache e não repete a consulta", async () => {
  limparCacheOceanop(); let chamadas = 0;
  const fetchImpl = async () => { chamadas += 1; await new Promise((r) => setTimeout(r, 5)); return resposta(); };
  const opcoes = { fetchImpl, tentativas: 1, logger: null, agora: () => new Date("2026-10-20T08:00:00Z") };
  const [a, b] = await Promise.all([buscarOceanop(area(), opcoes), buscarOceanop(area(), opcoes)]);
  const c = await buscarOceanop(area(), opcoes);
  assert.equal(chamadas, 1); assert.equal(a.previsoes.length, 1); assert.equal(b.previsoes.length, 1); assert.equal(c.cache, true);
  assert.equal(obterDiagnosticoOceanop().status, "DEGRADADO");
});

test("trata 401, 403, 404, 500 e DNS sem vazar o corpo privado", async () => {
  for (const status of [401, 403, 404, 500]) {
    await assert.rejects(buscarOceanop(area(), {
      usarCache: false, tentativas: 1, logger: null,
      fetchImpl: async () => ({ ok: false, status, json: async () => ({ segredo: "não expor" }) }),
    }), (erro) => erro.httpStatus === status && erro.code === `HTTP_${status}` && !/segredo/.test(erro.message));
  }
  await assert.rejects(buscarOceanop(area(), {
    usarCache: false, tentativas: 1, logger: null,
    fetchImpl: async () => { throw Object.assign(new TypeError("rede"), { cause: { code: "ENOTFOUND" } }); },
  }), (erro) => erro.tipo === "dns" && erro.code === "ENOTFOUND");
});
