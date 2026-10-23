const test = require("node:test");
const assert = require("node:assert/strict");
const {
  montarPrevisaoProximosDiasOpenMeteo,
  usarTemperaturaUmidadeInmet,
  aplicarRajadasOceanop,
} = require("../src/sources/previsaoProximosDias");

const cidade = { nome: "Brasília", uf: "DF", latitude: -15.79, longitude: -47.88, fusoHorario: "America/Sao_Paulo" };

test("D+1 a D+3 usa agregações diárias Open-Meteo e rajada separada Tetra Tech", () => {
  const previsao = montarPrevisaoProximosDiasOpenMeteo(cidade, [
    { data: "2026-10-24", tempMin: 19, tempMax: 31, umidadeMin: 35, umidadeMax: 88, condicao: "Nublado", chuvaMm: 3.2, probabilidadeChuvaPct: 70, uvMax: 9.1, rajadaKmh: 99 },
    { data: "2026-10-25", tempMin: 18, tempMax: 30, umidadeMin: 40, umidadeMax: 90, condicao: "Chuva", chuvaMm: 12, probabilidadeChuvaPct: 85, uvMax: 7 },
    { data: "2026-10-26", tempMin: 20, tempMax: 32, umidadeMin: 30, umidadeMax: 80, condicao: "Céu limpo", chuvaMm: 0, probabilidadeChuvaPct: 5, uvMax: 10 },
  ], { agora: new Date("2026-10-23T12:00:00Z") });
  assert.deepEqual(previsao.dias.map((dia) => dia.probabilidadeChuvaPct), [70, 85, 5]);
  assert.deepEqual(previsao.dias.map((dia) => dia.rajadaMaxKmh), [null, null, null]);
  const comRajada = aplicarRajadasOceanop(previsao, [
    { data: "2026-10-24", rajadaMaxKmh: 48.15, fonte: "Tetra Tech — portal TTForecast", rajadaPrevistaEm: "2026-10-24T18:00:00Z" },
  ]);
  assert.equal(comRajada.dias[0].rajadaMaxKmh, 48.15);
  assert.equal(comRajada.dias[1].rajadaMaxKmh, null);
  assert.equal(comRajada.fontesCampo.rajada, "Tetra Tech — portal TTForecast");
});

test("D+1 a D+3 mostra somente temperatura e umidade previstas pelo INMET", () => {
  const open = montarPrevisaoProximosDiasOpenMeteo(cidade, [
    { data: "2026-10-24", tempMin: 10, tempMax: 50, umidadeMin: 5, umidadeMax: 99, chuvaMm: 3.2, probabilidadeChuvaPct: 70 },
    { data: "2026-10-25", tempMin: 10, tempMax: 50, umidadeMin: 5, umidadeMax: 99, chuvaMm: 12 },
  ], { agora: new Date("2026-10-23T12:00:00Z") });
  const resultado = usarTemperaturaUmidadeInmet(open, { dias: [
    { data: "2026-10-24", tempMin: 19, tempMax: 31, umidadeMin: 35, umidadeMax: 88 },
  ] });
  assert.deepEqual([resultado.dias[0].tempMinC, resultado.dias[0].tempMaxC, resultado.dias[0].umidadeMinPct, resultado.dias[0].umidadeMaxPct], [19, 31, 35, 88]);
  assert.deepEqual([resultado.dias[1].tempMinC, resultado.dias[1].tempMaxC, resultado.dias[1].umidadeMinPct, resultado.dias[1].umidadeMaxPct], [null, null, null, null]);
  assert.equal(resultado.dias[0].chuvaMm, 3.2);
  assert.equal(resultado.dias[1].chuvaMm, 12);
  assert.equal(resultado.fontesCampo.temperatura, "INMET — previsão oficial");
  assert.equal(resultado.fontesCampo.chuva, "Open-Meteo — previsão meteorológica");
});
