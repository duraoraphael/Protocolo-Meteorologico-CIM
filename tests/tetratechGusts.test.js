const test = require("node:test");
const assert = require("node:assert/strict");
const {
  API_BASE,
  FONTE,
  CAMPO_RAJADA,
  METROS_POR_SEGUNDO_POR_NO,
  converterParaKmH,
  calcularPicosDiarios,
  buscarRajadasTetraTech,
  limparCacheTetraTech,
} = require("../src/sources/tetratechGusts");
const portais = require("../src/config/rajadaPortais");

const UUID_SANTOS = "11111111-2222-4333-8444-555555555555";
const rawMs = (nos) => nos * METROS_POR_SEGUNDO_POR_NO;
const resposta = (json, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => JSON.stringify(json),
});

test("converte nós para km/h, preserva km/h e rejeita unidade desconhecida", () => {
  assert.equal(converterParaKmH(10, "kt"), 18.52);
  assert.ok(Math.abs(converterParaKmH("15,5", "nós") - 28.706) < 1e-12);
  assert.equal(converterParaKmH("36", "km/h"), 36);
  assert.equal(converterParaKmH("", "kt"), null);
  assert.equal(converterParaKmH(-1, "kt"), null);
  assert.equal(converterParaKmH(10, "m/s"), null);
});

test("seleciona o maior pico de cada dia, mantém o primeiro empate e não usa média", () => {
  const payload = {
    timestamps: [
      Date.parse("2026-10-20T03:00:00Z"),
      Date.parse("2026-10-20T15:00:00Z"),
      Date.parse("2026-10-20T18:00:00Z"),
      Date.parse("2026-10-20T21:00:00Z"),
      Date.parse("2026-10-21T15:00:00Z"),
    ],
    [CAMPO_RAJADA]: [rawMs(12), rawMs(28), rawMs(28), rawMs(24), rawMs(30)],
    info: { forecast_reference_time: "2026-10-20T00:00:00Z" },
  };
  const picos = calcularPicosDiarios(payload, {
    cidade: "Santos",
    areaName: "Santos",
    fusoHorario: "America/Sao_Paulo",
    consultadoEm: "2026-10-20T10:00:00Z",
  });
  assert.equal(picos.length, 2);
  assert.equal(picos[0].data, "2026-10-20");
  assert.equal(picos[0].horarioPico, "12:00");
  assert.ok(Math.abs(picos[0].rajadaOriginal - 28) < 1e-9);
  assert.equal(picos[0].rajadaPrevistaKmH, 51.86);
  assert.equal(picos[0].unidadeOriginal, "kt");
  assert.equal(picos[0].registroOrigem.indice, 1);
  assert.equal(picos[1].data, "2026-10-21");
  assert.ok(Math.abs(picos[1].rajadaPrevistaKmH - 55.56) < 1e-9);
});

test("agrupa pela data de Manaus, não pela data UTC", () => {
  const picos = calcularPicosDiarios({
    timestamps: [Date.parse("2026-10-21T02:00:00Z"), Date.parse("2026-10-21T04:00:00Z")],
    [CAMPO_RAJADA]: [rawMs(20), rawMs(10)],
  }, {
    cidade: "Manaus", areaName: "Manaus", fusoHorario: "America/Manaus",
    consultadoEm: "2026-10-20T12:00:00Z",
  });
  assert.deepEqual(picos.map((item) => [item.data, item.horarioPico]), [
    ["2026-10-20", "22:00"],
    ["2026-10-21", "00:00"],
  ]);
});

test("consulta áreas e boletim oficiais com X-API-Key sem inventar ID", async () => {
  limparCacheTetraTech();
  const chamadas = [];
  const fetchImpl = async (url, init) => {
    chamadas.push({ url: String(url), init });
    if (String(url) === `${API_BASE}/areas/json`) {
      return resposta([{ id: UUID_SANTOS, name: "Santos", type: "Terrestre" }]);
    }
    if (String(url) === `${API_BASE}/bulletins/${UUID_SANTOS}`) {
      return resposta({
        timestamps: [Date.parse("2026-10-20T15:00:00Z")],
        [CAMPO_RAJADA]: [rawMs(25)],
      });
    }
    throw new Error(`URL inesperada: ${url}`);
  };
  const resultado = await buscarRajadasTetraTech("Santos", portais.santos, {
    env: { TETRATECH_API_KEY: "chave-de-teste" },
    fetchImpl,
    tentativas: 1,
    usarCache: false,
    usarCachePersistente: false,
    agora: () => new Date("2026-10-20T10:00:00Z"),
  });
  assert.deepEqual(chamadas.map((item) => item.url), [
    `${API_BASE}/areas/json`, `${API_BASE}/bulletins/${UUID_SANTOS}`,
  ]);
  assert.ok(chamadas.every((item) => item.init.headers["X-API-Key"] === "chave-de-teste"));
  assert.ok(chamadas.every((item) => item.init.headers.Authorization === undefined));
  assert.equal(resultado.fonte, FONTE);
  assert.equal(resultado.area.id, UUID_SANTOS);
  assert.equal(resultado.picosDiarios[0].rajadaPrevistaKmH, 46.3);
});

test("sem credencial oficial falha imediatamente e mantém o fallback disponível", async () => {
  limparCacheTetraTech();
  await assert.rejects(
    buscarRajadasTetraTech("Santos", portais.santos, {
      env: {}, fetchImpl: async () => { throw new Error("não deveria consultar"); }, tentativas: 1,
      usarCachePersistente: false,
    }),
    { code: "TETRATECH_CREDENTIALS_MISSING" }
  );
});

test("armazena o horizonte e reutiliza somente datas ainda válidas quando o token expira", async () => {
  limparCacheTetraTech();
  let estado = {};
  const carregarCachePersistente = () => structuredClone(estado);
  const gravarCachePersistente = (novoEstado) => { estado = structuredClone(novoEstado); };
  const fetchImpl = async (url) => {
    if (String(url) === `${API_BASE}/areas/json`) {
      return resposta([{ id: UUID_SANTOS, name: "Santos", type: "Terrestre" }]);
    }
    return resposta({
      timestamps: [Date.parse("2026-10-20T15:00:00Z"), Date.parse("2026-10-21T15:00:00Z")],
      [CAMPO_RAJADA]: [rawMs(25), rawMs(30)],
    });
  };
  await buscarRajadasTetraTech("Santos", portais.santos, {
    env: { TETRATECH_API_KEY: "chave-de-teste" }, fetchImpl, tentativas: 1, usarCache: false,
    agora: () => new Date("2026-10-20T10:00:00Z"), carregarCachePersistente, gravarCachePersistente,
  });

  limparCacheTetraTech();
  const armazenado = await buscarRajadasTetraTech("Santos", portais.santos, {
    env: {}, fetchImpl: async () => { throw new Error("não deveria consultar sem credencial"); },
    tentativas: 1, usarCache: false, agora: () => new Date("2026-10-20T18:00:00Z"),
    carregarCachePersistente, gravarCachePersistente,
  });
  assert.equal(armazenado.desatualizado, true);
  assert.equal(armazenado.cache, true);
  assert.equal(armazenado.erroAtual.code, "TETRATECH_CREDENTIALS_MISSING");
  assert.deepEqual(armazenado.picosDiarios.map((pico) => pico.data), ["2026-10-20", "2026-10-21"]);

  await assert.rejects(buscarRajadasTetraTech("Santos", portais.santos, {
    env: {}, usarCache: false, agora: () => new Date("2026-10-22T12:00:00Z"),
    carregarCachePersistente, gravarCachePersistente,
  }), { code: "TETRATECH_CREDENTIALS_MISSING" });
});

test("mapeia as páginas por cidade e bloqueia Climatempo e Araucária sem autorização", () => {
  assert.equal(portais.rio_de_janeiro.pagina.endsWith("/Rio%20de%20Janeiro"), true);
  assert.equal(portais.macae.pagina.endsWith("/Maca%C3%A9"), true);
  assert.equal(portais.brasilia.pagina.endsWith("/Bras%C3%ADlia"), true);
  assert.equal(portais.salvador.areaName, "Salvador");
  assert.equal(portais.manaus.fusoHorario, "America/Manaus");
  assert.equal(portais.aracaju.habilitado, false);
  assert.match(portais.aracaju.motivo, /não autorizado/i);
  assert.equal(portais.araucaria.habilitado, false);
  assert.match(portais.araucaria.motivo, /não validada/i);
});
