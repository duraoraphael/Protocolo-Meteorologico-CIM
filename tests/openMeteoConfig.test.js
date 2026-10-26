const test = require("node:test");
const assert = require("node:assert/strict");

const {
  aplicarConfiguracaoOpenMeteo,
  removerCredenciaisOpenMeteo,
} = require("../src/sources/openMeteoConfig");

test("Open-Meteo bloqueia consulta sem licença comercial também fora de produção", () => {
  for (const NODE_ENV of ["test", "development", "production", undefined]) {
    assert.throws(
      () => aplicarConfiguracaoOpenMeteo("https://api.open-meteo.com/v1/forecast?latitude=-22.9", { NODE_ENV }),
      (erro) => erro.code === "OPEN_METEO_COMMERCIAL_LICENSE_REQUIRED",
    );
  }
});

test("Open-Meteo bloqueia chamada sem chave comercial", () => {
  assert.throws(
    () => aplicarConfiguracaoOpenMeteo(
      "https://api.open-meteo.com/v1/forecast?latitude=-22.9",
      { NODE_ENV: "test" },
    ),
    (erro) => erro.code === "OPEN_METEO_COMMERCIAL_LICENSE_REQUIRED",
  );
});

test("Open-Meteo usa endpoint customer-* e chave comercial", () => {
  const url = new URL(aplicarConfiguracaoOpenMeteo(
    "https://air-quality-api.open-meteo.com/v1/air-quality?latitude=-22.9",
    { NODE_ENV: "production", OPEN_METEO_API_KEY: "segredo-teste" },
  ));
  assert.equal(url.hostname, "customer-air-quality-api.open-meteo.com");
  assert.equal(url.searchParams.get("apikey"), "segredo-teste");
});

test("Open-Meteo não devolve a chave comercial em objetos e caches", () => {
  const segura = new URL(removerCredenciaisOpenMeteo(
    "https://customer-marine-api.open-meteo.com/v1/marine?latitude=-22.9&apikey=segredo-teste",
  ));
  assert.equal(segura.searchParams.get("apikey"), null);
  assert.equal(segura.searchParams.get("latitude"), "-22.9");
  assert.doesNotMatch(segura.toString(), /segredo-teste/);
});

test("OPEN_METEO_USAR_API_PUBLICA libera o endpoint público só quando explícito e sem chave", () => {
  const publico = new URL(aplicarConfiguracaoOpenMeteo(
    "https://marine-api.open-meteo.com/v1/marine?latitude=-22.9",
    { OPEN_METEO_USAR_API_PUBLICA: "true" },
  ));
  assert.equal(publico.hostname, "marine-api.open-meteo.com");
  assert.equal(publico.searchParams.has("apikey"), false);
  for (const valor of ["false", "", "1", undefined]) {
    assert.throws(
      () => aplicarConfiguracaoOpenMeteo("https://marine-api.open-meteo.com/v1/marine?latitude=-22.9", { OPEN_METEO_USAR_API_PUBLICA: valor }),
      (erro) => erro.code === "OPEN_METEO_COMMERCIAL_LICENSE_REQUIRED",
    );
  }
  // A chave comercial continua tendo prioridade.
  const comChave = new URL(aplicarConfiguracaoOpenMeteo(
    "https://marine-api.open-meteo.com/v1/marine?latitude=-22.9",
    { OPEN_METEO_USAR_API_PUBLICA: "true", OPEN_METEO_API_KEY: "segredo-teste" },
  ));
  assert.equal(comChave.hostname, "customer-marine-api.open-meteo.com");
  // Hosts desconhecidos continuam recusados.
  assert.throws(() => aplicarConfiguracaoOpenMeteo("https://exemplo.com/x", { OPEN_METEO_USAR_API_PUBLICA: "true" }), /Host Open-Meteo não reconhecido/);
});
