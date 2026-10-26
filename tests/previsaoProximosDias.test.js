const test = require("node:test");
const assert = require("node:assert/strict");
const {
  montarPrevisaoProximosDiasInmet,
  montarPrevisaoProximosDiasOpenMeteo,
  complementarPrevisaoProximosDias,
} = require("../src/sources/previsaoProximosDias");

const cidade = { nome: "Brasília", uf: "DF", latitude: -15.79, longitude: -47.88, fusoHorario: "America/Sao_Paulo" };

test("D+1 a D+3 usa os agregados diários Open-Meteo alinhados por data", () => {
  const previsao = montarPrevisaoProximosDiasOpenMeteo(cidade, [
    { data: "2026-10-24", tempMin: 19, tempMax: 31, umidadeMin: 35, umidadeMax: 88, condicao: "Nublado", chuvaMm: 3.2, probabilidadeChuvaPct: 70, uvMax: 9.1, rajadaKmh: 99 },
    { data: "2026-10-25", tempMin: 18, tempMax: 30, umidadeMin: 40, umidadeMax: 90, condicao: "Chuva", chuvaMm: 12, probabilidadeChuvaPct: 85, uvMax: 7 },
    { data: "2026-10-26", tempMin: 20, tempMax: 32, umidadeMin: 30, umidadeMax: 80, condicao: "Céu limpo", chuvaMm: 0, probabilidadeChuvaPct: 5, uvMax: 10 },
  ], { agora: new Date("2026-10-23T12:00:00Z") });
  assert.deepEqual(previsao.dias.map((dia) => dia.probabilidadeChuvaPct), [70, 85, 5]);
  assert.deepEqual(previsao.dias.map((dia) => dia.rajadaMaxKmh), [99, null, null]);
  assert.equal(previsao.dias[2].chuvaMm, 0);
  assert.equal(previsao.fontesCampo.rajada, "Open-Meteo — previsão meteorológica");
});

test("D+3 usa campos modelados quando o INMET não publica a data", () => {
  const agora = new Date("2026-10-23T12:00:00Z");
  const inmet = montarPrevisaoProximosDiasInmet(cidade, null, { agora });
  const aberto = montarPrevisaoProximosDiasOpenMeteo(cidade, [
    { data: "2026-10-24", tempMin: 20, tempMax: 28, umidadeMin: 40, umidadeMax: 80,
      condicao: "Nublado a encoberto", chuvaMm: 2, probabilidadeChuvaPct: 60, uvMax: 8, rajadaKmh: 52 },
  ], { agora });
  const combinado = complementarPrevisaoProximosDias(inmet, aberto);
  assert.equal(combinado.dias[0].tempMaxC, 28);
  assert.equal(combinado.dias[0].umidadeMaxPct, 80);
  assert.equal(combinado.dias[0].condicao, "Nublado a encoberto");
  assert.equal(combinado.dias[0].rajadaMaxKmh, 52);
  assert.match(combinado.fontesCampo.temperatura, /Open-Meteo/);
  assert.match(combinado.fontesCampo.condicao, /Open-Meteo/);
});

test("D+3 usa INMET para temperatura, umidade e condição e Open-Meteo só para chuva e UV", () => {
  const agora = new Date("2026-10-23T12:00:00Z");
  const inmet = montarPrevisaoProximosDiasInmet(cidade, { dias: [
    { data: "2026-10-24", tempMin: 20, tempMax: 29, umidadeMin: 50, umidadeMax: 90, resumo: "Muitas nuvens" },
  ] }, { agora });
  const aberto = montarPrevisaoProximosDiasOpenMeteo(cidade, [
    { data: "2026-10-24", tempMin: 10, tempMax: 40, umidadeMin: 0, umidadeMax: 100,
      condicao: "Céu limpo", chuvaMm: 0, probabilidadeChuvaPct: 0, uvMax: 8 },
  ], { agora });
  const combinado = complementarPrevisaoProximosDias(inmet, aberto);
  assert.deepEqual([combinado.dias[0].tempMinC, combinado.dias[0].tempMaxC], [20, 29]);
  assert.deepEqual([combinado.dias[0].umidadeMinPct, combinado.dias[0].umidadeMaxPct], [50, 90]);
  assert.equal(combinado.dias[0].condicao, "Muitas nuvens");
  assert.deepEqual([combinado.dias[0].chuvaMm, combinado.dias[0].probabilidadeChuvaPct, combinado.dias[0].uvMax], [0, 0, 8]);
  assert.match(combinado.fontesCampo.temperatura, /INMET/);
  assert.match(combinado.fontesCampo.chuva, /Open-Meteo/);
});

test("D+1 a D+3 preserva faixas e condição oficiais quando a fonte comercial falta", () => {
  const previsao = montarPrevisaoProximosDiasInmet(cidade, { dias: [
    { data: "2026-10-24", tempMin: 19, tempMax: 31, umidadeMin: 35, umidadeMax: 88, resumo: "Muitas nuvens" },
    { data: "2026-10-25", tempMin: 18, tempMax: 30, umidadeMin: 40, umidadeMax: 90, resumo: "Chuva" },
    { data: "2026-10-26", tempMin: 20, tempMax: 32, umidadeMin: 30, umidadeMax: 80, resumo: "Céu limpo" },
  ] }, { agora: new Date("2026-10-23T12:00:00Z") });
  assert.equal(previsao.status, "parcial");
  assert.deepEqual(previsao.dias.map((dia) => dia.tempMaxC), [31, 30, 32]);
  assert.deepEqual(previsao.dias.map((dia) => dia.condicao), ["Muitas nuvens", "Chuva", "Céu limpo"]);
  assert.deepEqual(previsao.dias.map((dia) => dia.chuvaMm), [null, null, null]);
  assert.match(previsao.fontesCampo.temperatura, /INMET/);
});
