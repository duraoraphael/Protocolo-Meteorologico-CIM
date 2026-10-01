const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buscarMar,
  buscarMarComFallback,
  OPEN_METEO_MARINE_TIMEOUT_MS,
  OPEN_METEO_MARINE_TENTATIVAS,
} = require("../src/sources/marine");
const {
  buscarQualidadeAr,
  OPEN_METEO_AIR_TIMEOUT_MS,
  OPEN_METEO_AIR_TENTATIVAS,
} = require("../src/sources/airQuality");

function horas() {
  return Array.from({ length: 24 }, (_, hora) => `2026-09-30T${String(hora).padStart(2, "0")}:00`);
}

function respostaMarine() {
  const time = horas();
  return {
    hourly: {
      time,
      wave_height: time.map(() => 0.8),
      wave_period: time.map(() => 7),
      wave_direction: time.map(() => 135),
      swell_wave_height: time.map(() => 0.5),
      swell_wave_period: time.map(() => 8),
      sea_surface_temperature: time.map(() => 24.5),
    },
  };
}

function respostaAir() {
  const time = horas();
  return {
    hourly: {
      time,
      pm10: time.map(() => 18),
      pm2_5: time.map(() => 12),
      uv_index: time.map((_, hora) => hora === 12 ? 9 : 2),
      dust: time.map(() => 4),
      carbon_monoxide: time.map(() => 100),
    },
  };
}

function clienteTransitorio(json, chamadas, esperas) {
  return async (url, opcoes) => {
    chamadas.push({ url, opcoes });
    if (chamadas.length === 1) throw Object.assign(new Error("rede"), { name: "TypeError" });
    if (chamadas.length === 2) throw Object.assign(new Error("timeout"), { name: "TimeoutError" });
    return { ok: true, json: async () => json };
  };
}

test("Marine usa 15 segundos e retry progressivo sem alterar as demais fontes", async () => {
  const chamadas = [];
  const esperas = [];
  const resultado = await buscarMar(-22.9068, -43.1729, {
    fetchImpl: clienteTransitorio(respostaMarine(), chamadas, esperas),
    esperarFn: async (ms) => { esperas.push(ms); },
  });
  assert.equal(OPEN_METEO_MARINE_TIMEOUT_MS, 15000);
  assert.equal(OPEN_METEO_MARINE_TENTATIVAS, 3);
  assert.equal(chamadas.length, 3);
  assert.deepEqual(esperas, [1000, 2000]);
  assert.equal(resultado.fonte, "Open-Meteo Marine");
  assert.equal(resultado.alturaMaxDiaM, 0.8);
});

test("Air Quality usa 15 segundos e recupera após falhas transitórias", async () => {
  const chamadas = [];
  const esperas = [];
  const resultado = await buscarQualidadeAr(-22.9068, -43.1729, {
    fetchImpl: clienteTransitorio(respostaAir(), chamadas, esperas),
    esperarFn: async (ms) => { esperas.push(ms); },
  });
  assert.equal(OPEN_METEO_AIR_TIMEOUT_MS, 15000);
  assert.equal(OPEN_METEO_AIR_TENTATIVAS, 3);
  assert.equal(chamadas.length, 3);
  assert.deepEqual(esperas, [2000, 4000]);
  assert.equal(resultado.fonte, "Open-Meteo Air Quality");
  assert.equal(resultado.uvMax, 9);
  assert.equal(resultado.pm25Medio, 12);
});

test("Marine e Air Quality não repetem erro HTTP permanente", async () => {
  for (const consultar of [buscarMar, buscarQualidadeAr]) {
    let chamadas = 0;
    await assert.rejects(
      consultar(-22.9068, -43.1729, {
        fetchImpl: async () => {
          chamadas += 1;
          return { ok: false, status: 400 };
        },
        esperarFn: async () => {},
      }),
      /HTTP 400/
    );
    assert.equal(chamadas, 1);
  }
});

test("Marine e Air Quality encerram após três timeouts", async () => {
  for (const [consultar, nome] of [
    [buscarMar, "Open-Meteo Marine"],
    [buscarQualidadeAr, "Open-Meteo Air Quality"],
  ]) {
    let chamadas = 0;
    await assert.rejects(
      consultar(-22.9068, -43.1729, {
        timeoutMs: 25,
        fetchImpl: async () => {
          chamadas += 1;
          throw Object.assign(new Error("timeout"), { name: "TimeoutError" });
        },
        esperarFn: async () => {},
      }),
      new RegExp(`${nome}: tempo de resposta esgotado \\(0\\.025s\\) após 3 tentativas`)
    );
    assert.equal(chamadas, 3);
  }
});

test("Marine usa cache válido como degradado e nunca fabrica zero", async () => {
  const consultadoEm = "2026-10-01T09:00:00.000Z";
  const armazenado = {
    macae: {
      consultadoEm,
      dados: { fonte: "Open-Meteo Marine", alturaMaxDiaM: 0.7, estadoMarDia: "Leve", periodos: [] },
    },
  };
  const resultado = await buscarMarComFallback({
    chave: "macae", latitude: -22.28, longitude: -41.96,
  }, {
    consultar: async () => { throw Object.assign(new Error("reset"), { code: "ECONNRESET" }); },
    carregarCache: () => armazenado,
    salvarCache: () => assert.fail("não deve sobrescrever cache em falha"),
    agora: () => new Date("2026-10-01T12:00:00.000Z"),
  });

  assert.equal(resultado.health.status, "degradado");
  assert.equal(resultado.health.lastSuccessAt, consultadoEm);
  assert.equal(resultado.dados.alturaMaxDiaM, 0.7);
  assert.equal(resultado.dados.desatualizado, true);
});

test("Marine sem coleta válida fica indisponível e mantém dado nulo", async () => {
  const resultado = await buscarMarComFallback({
    chave: "macae", latitude: -22.28, longitude: -41.96,
  }, {
    consultar: async () => { throw Object.assign(new Error("dns"), { code: "ENOTFOUND" }); },
    carregarCache: () => ({}),
    salvarCache: () => assert.fail("não deve gravar"),
  });
  assert.equal(resultado.health.status, "indisponivel");
  assert.equal(resultado.dados, null);
});
