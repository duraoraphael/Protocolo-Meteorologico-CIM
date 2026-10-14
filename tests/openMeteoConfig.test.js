const test = require("node:test");
const assert = require("node:assert/strict");

const {
  aplicarConfiguracaoOpenMeteo,
  removerCredenciaisOpenMeteo,
} = require("../src/sources/openMeteoConfig");

test("Open-Meteo mantém endpoint público somente fora de produção", () => {
  const url = aplicarConfiguracaoOpenMeteo(
    "https://api.open-meteo.com/v1/forecast?latitude=-22.9",
    { NODE_ENV: "test" },
  );
  assert.equal(new URL(url).hostname, "api.open-meteo.com");
});

test("Open-Meteo bloqueia produção sem chave comercial", () => {
  assert.throws(
    () => aplicarConfiguracaoOpenMeteo(
      "https://api.open-meteo.com/v1/forecast?latitude=-22.9",
      { NODE_ENV: "production" },
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
