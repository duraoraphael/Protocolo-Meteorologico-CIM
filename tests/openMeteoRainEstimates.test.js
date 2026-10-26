const test = require("node:test");
const assert = require("node:assert/strict");
const { agregarChuvaEstimada, validarResposta } = require("../src/sources/openMeteo");

const HOJE = new Date("2026-10-23T14:35:00Z"); // 11h35 em São Paulo.
function serie(valores) {
  const inicial = Date.parse("2026-10-22T06:00:00Z"); // 03h local.
  const time = valores.map((_, i) => new Date(inicial + i * 3600_000).toISOString().slice(0, 16)
    .replace("2026-10-22T", "2026-10-22T"));
  // Os instantes da API são horas locais sem offset.
  return { timezone: "America/Sao_Paulo", utc_offset_seconds: -10800,
    hourly: { time: time.map((t) => new Date(Date.parse(`${t}:00Z`) - 3 * 3600_000).toISOString().slice(0, 16)),
      precipitation: valores, rain: valores, showers: valores.map(() => 0),
      precipitation_probability: valores.map(() => 100) } };
}

test("estimativas respeitam dia local, última hora e 24 horas sem somar componentes", () => {
  const valores = Array(33).fill(1); // 22/10 03h até 23/10 11h.
  const dados = agregarChuvaEstimada(serie(valores), HOJE);
  assert.equal(dados.diaMm, 11);
  assert.equal(dados.ultimaHoraMm, 1);
  assert.equal(dados.ultimas24hMm, 24);
  assert.equal(dados.coberturaDia.parcial, false);
  assert.equal(dados.cobertura24h.parcial, false);
  assert.equal(dados.referenciaEm, "2026-10-23T11:00");
});

test("zero válido permanece zero; lacuna e valor implausível não viram zero", () => {
  const valores = Array(33).fill(0);
  const completos = agregarChuvaEstimada(serie(valores), HOJE);
  assert.equal(completos.diaMm, 0);
  assert.equal(completos.ultimaHoraMm, 0);
  valores[32] = null;
  valores[31] = 900;
  const parcial = agregarChuvaEstimada(serie(valores), HOJE);
  assert.equal(parcial.ultimaHoraMm, 0);
  assert.equal(parcial.ultimaHoraReferencia, "2026-10-23T09:00");
  assert.equal(parcial.coberturaDia.parcial, true);
  assert.equal(parcial.cobertura24h.amostras, 22);
  assert.equal(agregarChuvaEstimada(serie(Array(33).fill(null)), HOJE).diaMm, null);
});

test("à meia-noite não atribui chuva de 23h–00h ao dia novo", () => {
  const dados = agregarChuvaEstimada(serie(Array(33).fill(1)), new Date("2026-10-23T03:30:00Z"));
  assert.equal(dados.diaMm, null);
  assert.equal(dados.ultimaHoraMm, 1);
});

test("série histórica antiga é indisponível com motivo", () => {
  const dados = agregarChuvaEstimada(serie(Array(33).fill(1)), new Date("2026-10-24T14:35:00Z"));
  assert.equal(dados.diaMm, null);
  assert.match(dados.motivoIndisponibilidade, /anterior/);
});

test("rejeita timestamps duplicados antes do cálculo", () => {
  const json = serie([1, 2]);
  json.hourly.time[1] = json.hourly.time[0];
  json.daily = { time: ["2026-10-23"] };
  assert.throws(() => validarResposta(json, "America/Sao_Paulo"), /duplicadas/);
});

test("offset divergente do fuso não gera estimativa", () => {
  const json = serie(Array(33).fill(1));
  json.utc_offset_seconds = -14400;
  assert.equal(agregarChuvaEstimada(json, HOJE).diaMm, null);
  assert.match(agregarChuvaEstimada(json, HOJE).motivoIndisponibilidade, /incompatível/);
});
