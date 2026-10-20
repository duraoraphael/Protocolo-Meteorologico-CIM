const test = require("node:test");
const assert = require("node:assert/strict");
const {
  ENDPOINT,
  FONTE,
  numero,
  numeroNoIntervalo,
  normalizarResposta,
  validarPontos,
  buscarOceanop,
  mapearOceanopParaMar,
  mapearOceanopParaVento,
  limparCacheOceanop,
  obterDiagnosticoOceanop,
} = require("../src/sources/oceanop");

const UNIDADES = Object.freeze({
  AlturaOnda: "m", AlturaMaximaOnda: "m", PeriodoOnda: "s",
  PeriodoPicoOnda: "s", DirecaoOnda: "graus", AlturaOndulacao: "m",
  VelocidadeVento: "m/s", VelocidadeVento_10M_Rajada: "m/s", DirecaoVento: "graus",
});

function ponto(ID = "PONTO-A", extra = {}) {
  return {
    ID, latitude: -22.9, longitude: -42.6, habilitado: true,
    fusoHorario: "America/Sao_Paulo", unidades: UNIDADES, referencia: `Referência ${ID}`,
    ...extra,
  };
}

function registro(PointID, inicio, extra = {}) {
  return {
    PointID,
    Local: `Local ${PointID}`,
    DataInicial: `19/10/2026 ${inicio}:00`,
    DataFinal: `19/10/2026 ${String(Number(inicio.slice(0, 2)) + 1).padStart(2, "0")}:59:59`,
    DataEscrita: "19/10/2026 04:30:00",
    AlturaOnda: "1,05",
    AlturaMaximaOnda: "2,10",
    PeriodoOnda: "9,7",
    PeriodoPicoOnda: "11,2",
    DirecaoOnda: "135",
    AlturaOndulacao: "0,8",
    PeriodoOndulacao: "12",
    VelocidadeVento: "9,52",
    VelocidadeVento_10M_Rajada: "11,99",
    DirecaoVento: "180",
    Precipitacao: "0",
    Condicao_Clima: "partly_cloudy",
    Confiabilidaae: "alta",
    ...extra,
  };
}

test("converte vírgula decimal, preserva zero e não fabrica ausentes", () => {
  assert.equal(numero("24,67"), 24.67);
  assert.equal(numero("0"), 0);
  for (const valor of ["", null, " ", "2,3,4", undefined, NaN]) assert.equal(numero(valor), null);
  assert.equal(numeroNoIntervalo("361", "DirecaoOnda"), null);
  assert.equal(numeroNoIntervalo("360", "DirecaoOnda"), 360);
});

test("valida lista, coordenadas, IDs únicos e não aceita ponto implícito", () => {
  assert.deepEqual(validarPontos([ponto()]), [{ ID: "PONTO-A", Lat: -22.9, Lon: -42.6 }]);
  assert.throws(() => validarPontos([]), /1 a 50/);
  assert.throws(() => validarPontos([ponto("A"), ponto("A")]), /duplicado/);
  assert.throws(() => validarPontos([{ ID: "A", Lat: 91, Lon: 0 }]), /latitude/);
  assert.throws(() => validarPontos([{ Lat: 0, Lon: 0 }]), /ID autorizado/);
});

test("POST envia vários pontos no contrato ID/Lat/Lon e associa por PointID", async () => {
  limparCacheOceanop();
  const pontos = [ponto("PONTO-B", { latitude: -20, longitude: -40 }), ponto("PONTO-A")];
  let chamada;
  const resultado = await buscarOceanop(pontos, {
    usarCache: false,
    tentativas: 1,
    logger: null,
    agora: () => new Date("2026-10-19T08:00:00Z"),
    fetchImpl: async (url, init) => {
      chamada = { url: String(url), init };
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true, data: [registro("PONTO-B", "12:00"), registro("PONTO-A", "05:00")] }),
      };
    },
  });
  assert.equal(chamada.url, ENDPOINT);
  assert.equal(chamada.init.method, "POST");
  assert.equal(chamada.init.headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(chamada.init.body), [
    { ID: "PONTO-B", Lat: -20, Lon: -40 },
    { ID: "PONTO-A", Lat: -22.9, Lon: -42.6 },
  ]);
  assert.equal(resultado.fonte, FONTE);
  assert.deepEqual(resultado.previsoes.map((item) => item.pointId), ["PONTO-A", "PONTO-B"]);
  assert.equal(resultado.previsoes[0].inicioEm, "2026-10-19T08:00:00.000Z");
  assert.equal(resultado.previsoes[0].valores.Precipitacao, 0);
  assert.equal(resultado.previsoes[0].condicaoClimaPt, "Parcialmente nublado");
});

test("rejeita resposta com PointID diferente e payload sem success/data", () => {
  const pontos = [{ ID: "SOLICITADO", Lat: 0, Lon: 0 }];
  assert.throws(() => normalizarResposta({ success: true, data: [registro("OUTRO", "05:00")] }, { pontos }), { code: "OCEANOP_POINT_MISMATCH" });
  for (const valor of [{ success: false, data: [] }, { success: true, data: {} }, null]) {
    assert.throws(() => normalizarResposta(valor), { code: "OCEANOP_INVALID_PAYLOAD" });
  }
});

test("normaliza vários períodos em ordem e mantém campo Confiabilidaae", () => {
  const [primeiro, segundo] = normalizarResposta({
    success: true,
    data: [registro("PONTO-A", "18:00"), registro("PONTO-A", "05:00", { Latitude: "0", Longitude: "0" })],
  }, {
    pontos: [{ ID: "PONTO-A", Lat: -22.9, Lon: -42.6 }],
    fusoPorPonto: { "PONTO-A": "America/Sao_Paulo" },
  });
  assert.equal(primeiro.inicio, "19/10/2026 05:00:00");
  assert.equal(segundo.inicio, "19/10/2026 18:00:00");
  assert.equal(primeiro.valores.Confiabilidaae, "alta");
  assert.equal(primeiro.valores.Latitude, 0);
  assert.equal(primeiro.valores.Longitude, 0);
});

test("mapeia mar e vento apenas com unidade, altura e fuso homologados", () => {
  const p = ponto("PONTO-A", { usarVento: true, alturaVelocidadeVentoM: 10 });
  const previsoes = normalizarResposta({
    success: true,
    data: [registro("PONTO-A", "05:00"), registro("PONTO-A", "12:00"), registro("PONTO-A", "18:00")],
  }, {
    pontos: [{ ID: "PONTO-A", Lat: -22.9, Lon: -42.6 }],
    fusoPorPonto: { "PONTO-A": p.fusoHorario },
  });
  const resultado = { fonte: FONTE, consultadoEm: "2026-10-19T07:35:00.000Z", previsoes };
  const opcoes = { agora: new Date("2026-10-19T07:40:00Z"), inicioHora: 5, fimHora: 24 };
  const mar = mapearOceanopParaMar(resultado, p, opcoes);
  assert.equal(mar.fonte, FONTE);
  assert.equal(mar.alturaMaxDiaM, 2.1);
  assert.equal(mar.periodos[0].alturaOndaM, 1.1);
  assert.equal(mar.periodos[0].periodoPicoOndaS, 11.2);
  assert.equal(mar.periodos[0].direcaoOnda, "SE");
  assert.equal(mar.periodos[0].marulhoMaxM, 0.8);
  const vento = mapearOceanopParaVento(resultado, p, opcoes);
  assert.equal(vento.manha.velocidadeMediaKmh, 34.3);
  assert.equal(vento.manha.rajadaMaxKmh, 43.2);
  assert.equal(vento.manha.direcao, "S");
});

test("não promove unidades, fuso ou vento não confirmados", () => {
  const resultado = { consultadoEm: "2026-10-19T07:00:00Z", previsoes: [] };
  assert.throws(() => mapearOceanopParaMar(resultado, ponto("A", { unidades: {} })), { code: "OCEANOP_UNITS_OR_TIMEZONE_UNCONFIRMED" });
  assert.throws(() => mapearOceanopParaVento(resultado, ponto("A", { usarVento: true })), { code: "OCEANOP_WIND_METADATA_UNCONFIRMED" });
});

test("rejeita períodos vencidos em vez de reutilizá-los como atuais", () => {
  const p = ponto();
  const previsoes = normalizarResposta({ success: true, data: [registro("PONTO-A", "05:00")] }, {
    pontos: [{ ID: "PONTO-A", Lat: -22.9, Lon: -42.6 }], fusoPorPonto: { "PONTO-A": p.fusoHorario },
  });
  assert.throws(() => mapearOceanopParaMar({ consultadoEm: "2026-10-19T08:00:00Z", previsoes }, p, {
    agora: new Date("2026-10-19T16:00:00Z"), inicioHora: 5, fimHora: 24,
  }), { code: "OCEANOP_NO_CURRENT_DATA" });
});

test("deduplica chamadas simultâneas e usa cache temporário", async () => {
  limparCacheOceanop();
  let chamadas = 0;
  const fetchImpl = async () => {
    chamadas += 1;
    await new Promise((resolve) => setTimeout(resolve, 5));
    return { ok: true, status: 200, json: async () => ({ success: true, data: [registro("PONTO-A", "05:00")] }) };
  };
  const opcoes = { fetchImpl, tentativas: 1, logger: null, agora: () => new Date("2026-10-19T08:00:00Z") };
  const [a, b] = await Promise.all([buscarOceanop([ponto()], opcoes), buscarOceanop([ponto()], opcoes)]);
  const c = await buscarOceanop([ponto()], opcoes);
  assert.equal(chamadas, 1);
  assert.equal(a.previsoes.length, 1);
  assert.equal(b.previsoes.length, 1);
  assert.equal(c.cache, true);
  assert.deepEqual(obterDiagnosticoOceanop(), {
    status: "DEGRADADO",
    ultimaConsulta: "2026-10-19T08:00:00.000Z",
    ultimaConsultaBemSucedida: "2026-10-19T08:00:00.000Z",
    localidadesConsultadas: 1,
    localidadesComDadosValidos: 1,
    origemDados: "cache_valido",
    errosRecentes: [],
  });
});

test("erros HTTP de autenticação e falhas de conexão não vazam resposta privada", async () => {
  limparCacheOceanop();
  await assert.rejects(buscarOceanop([ponto()], {
    usarCache: false, tentativas: 1, logger: null,
    fetchImpl: async () => ({ ok: false, status: 403, json: async () => ({ segredo: "não expor" }) }),
  }), (erro) => erro.httpStatus === 403 && erro.code === "HTTP_403" && !/segredo/.test(erro.message));
  await assert.rejects(buscarOceanop([ponto()], {
    usarCache: false, tentativas: 1, logger: null,
    fetchImpl: async () => { throw Object.assign(new TypeError("rede"), { cause: { code: "ENOTFOUND" } }); },
  }), (erro) => erro.tipo === "dns" && erro.code === "ENOTFOUND");
  const diagnostico = obterDiagnosticoOceanop();
  assert.equal(diagnostico.status, "INDISPONIVEL");
  assert.equal(diagnostico.localidadesConsultadas, 1);
  assert.equal(diagnostico.localidadesComDadosValidos, 0);
  assert.deepEqual(diagnostico.errosRecentes.map((erro) => erro.codigo), ["ENOTFOUND", "HTTP_403"]);
  assert.doesNotMatch(JSON.stringify(diagnostico), /segredo/);
});
