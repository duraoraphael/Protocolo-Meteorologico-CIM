const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buscarObservacaoInmet,
  normalizarObservacao,
  agregarObservacoes,
  direcaoCardeal,
  TIMEOUT_MS,
  TENTATIVAS,
} = require("../src/sources/inmetObservations");

const cidade = {
  chave: "rio_de_janeiro",
  nome: "Rio de Janeiro",
  uf: "RJ",
  codigoIbge: "3304557",
  latitude: -22.9068,
  longitude: -43.1729,
};

const catalogo = [{
  CD_ESTACAO: "A636", DC_NOME: "RIO DE JANEIRO - JACAREPAGUÁ", SG_ESTADO: "RJ",
  SG_ENTIDADE: "INMET", TP_ESTACAO: "Automatica", CD_SITUACAO: "Operante",
  VL_LATITUDE: "-22.93999999", VL_LONGITUDE: "-43.40277777",
}];

function payload({ data = "2026-10-14", hora = "1300", tempMin = "24.1", tempMax = "28.7", tempAtual = "27.5", chuva = "2.5", vento = "4", rajada = "8", direcao = "90" } = {}) {
  return {
    estacao: {
      UF: "RJ", CODIGO: "A636", NOME: "RIO DE JANEIRO - JACAREPAGUÁ",
      LATITUDE: "-22.93999999", LONGITUDE: "-43.40277777", DISTANCIA_EM_KM: "6",
    },
    dados: {
      CD_ESTACAO: "A636", DC_NOME: "RIO DE JANEIRO - JACAREPAGUÁ", UF: "RJ",
      VL_LATITUDE: "-22.93999999", VL_LONGITUDE: "-43.40277777",
      DT_MEDICAO: data, HR_MEDICAO: hora, TEM_MIN: tempMin, TEM_MAX: tempMax, TEM_INS: tempAtual,
      UMD_MIN: "20", UMD_MAX: "99", UMD_INS: "70",
      CHUVA: chuva, VEN_VEL: vento, VEN_RAJ: rajada, VEN_DIR: direcao,
    },
  };
}

test("normaliza a observação oficial, preserva UTC e converte vento de m/s para km/h", () => {
  const observacao = normalizarObservacao(payload(), {
    cidade,
    catalogo: catalogo.map((item) => ({
      codigo: item.CD_ESTACAO, nome: item.DC_NOME, uf: item.SG_ESTADO,
      entidade: item.SG_ENTIDADE, tipo: item.TP_ESTACAO, situacao: item.CD_SITUACAO,
      latitude: Number(item.VL_LATITUDE), longitude: Number(item.VL_LONGITUDE),
    })),
    consultadoEm: "2026-10-14T13:30:00.000Z",
  });
  assert.equal(observacao.medidoEm, "2026-10-14T13:00:00.000Z");
  assert.equal(observacao.temperaturaMinC, 24.1);
  assert.equal(observacao.temperaturaMaxC, 28.7);
  assert.equal(observacao.temperaturaAtualC, 27.5);
  assert.equal(observacao.umidadeMinPct, 20);
  assert.equal(observacao.umidadeMaxPct, 99);
  assert.equal(observacao.umidadeAtualPct, 70);
  assert.equal(observacao.chuvaUltimaHoraMm, 2.5);
  assert.equal(observacao.ventoVelocidadeKmh, 14.4);
  assert.equal(observacao.rajadaKmh, 28.8);
  assert.equal(observacao.ventoDirecao, "E");
  assert.equal(observacao.tipoDado, "observado");
  assert.equal(observacao.estacao.situacao, "Operante");
  assert.equal(direcaoCardeal(225), "SO");
});

test("histórico agrupa somente o dia local e identifica cobertura parcial", () => {
  const ponto = (medidoEm, chuva, rajada, velocidade, tempMin, tempMax, direcao = "E") => ({
    medidoEm, chuvaUltimaHoraMm: chuva, rajadaKmh: rajada,
    ventoVelocidadeKmh: velocidade, ventoDirecao: direcao, ventoDirecaoGraus: 90,
    temperaturaMinC: tempMin, temperaturaMaxC: tempMax,
    umidadeMinPct: 45, umidadeMaxPct: 80, umidadeAtualPct: 60,
  });
  const agregado = agregarObservacoes([
    ponto("2026-10-14T11:00:00Z", 1, 20, 10, 21.4, 23.8),
    ponto("2026-10-14T14:00:00Z", 2, 30, 15, 22.7, 27.1),
    ponto("2026-10-14T18:00:00Z", 4, 45, 22, 26.5, 30.2, "SE"),
    ponto("2026-10-13T14:00:00Z", 99, 99, 99, 10, 40),
  ], { agora: new Date("2026-10-14T19:00:00Z"), fuso: "America/Sao_Paulo" });
  assert.equal(agregado.temperaturaMinC, 21.4);
  assert.equal(agregado.temperaturaMaxC, 30.2);
  assert.equal(agregado.periodos.manha.tempMin, 21.4);
  assert.equal(agregado.periodos.tarde.tempMax, 30.2);
  assert.equal(agregado.precipitacaoTotalMm, 7);
  assert.equal(agregado.precipitacaoHorariaMaxMm, 4);
  assert.equal(agregado.rajadaMaxKmh, 45);
  assert.equal(agregado.periodos.manha.precipitacaoMm, 3);
  assert.equal(agregado.periodos.tarde.precipitacaoMm, 4);
  assert.equal(agregado.chuvaPorHora[0].intervalo, "07:00–08:00");
  assert.equal(agregado.chuvaPorHora.at(-1).intervalo, "14:00–15:00");
  assert.equal(agregado.cobertura.parcial, true);
  assert.equal(agregado.cobertura.amostras, 3);
  assert.equal(agregado.coberturaTemperatura.amostras, 3);
  assert.equal(agregado.coberturaUmidade.amostras, 3);
});

test("serviço usa endpoints oficiais, persiste histórico e não chama provedor alternativo", async () => {
  const urls = [];
  let estado = { versao: 1, bases: {} };
  const resposta = (json) => ({ ok: true, status: 200, text: async () => JSON.stringify(json) });
  const resultado = await buscarObservacaoInmet(cidade, {
    fetchImpl: async (url, opcoes) => {
      urls.push(String(url));
      assert.ok(opcoes.signal instanceof AbortSignal);
      return resposta(String(url).includes("/estacoes/T") ? catalogo : payload());
    },
    esperarFn: async () => {},
    carregar: () => estado,
    salvar: (novo) => { estado = structuredClone(novo); },
    agora: () => new Date("2026-10-14T13:30:00.000Z"),
    logger: null,
  });
  assert.equal(TIMEOUT_MS, 15000);
  assert.equal(TENTATIVAS, 3);
  assert.ok(urls.some((url) => url === "https://apitempo.inmet.gov.br/estacoes/T"));
  assert.ok(urls.some((url) => url.endsWith("/estacao/proxima/3304557")));
  assert.equal(resultado.status, "operacional");
  assert.equal(estado.bases.rio_de_janeiro.historico.length, 1);
  assert.ok(urls.every((url) => /\.inmet\.gov\.br\//.test(url)));
});

test("falha atual usa somente a última observação INMET armazenada e a marca desatualizada", async () => {
  const ultima = normalizarObservacao(payload(), { cidade, consultadoEm: "2026-10-14T13:30:00.000Z" });
  const estado = { versao: 1, bases: { rio_de_janeiro: { ultimaValida: ultima, historico: [ultima] } } };
  const resultado = await buscarObservacaoInmet(cidade, {
    fetchImpl: async (url) => {
      if (String(url).includes("/estacoes/T")) return { ok: false, status: 503, text: async () => "" };
      throw Object.assign(new Error("rede"), { name: "TypeError" });
    },
    esperarFn: async () => {},
    carregar: () => estado,
    salvar: () => { throw new Error("não deveria salvar"); },
    agora: () => new Date("2026-10-14T18:30:00.000Z"),
    logger: null,
  });
  assert.equal(resultado.status, "degradado");
  assert.equal(resultado.observacao.status, "armazenado");
  assert.equal(resultado.observacao.desatualizado, true);
  assert.match(resultado.mensagem, /última observação INMET/);
});
