const test = require("node:test");
const assert = require("node:assert/strict");
const {
  montarContextoMeteorologicoSetor,
  CONDICAO_INDISPONIVEL,
} = require("../src/logic/sectorWeatherContext");

const setor = (chave, codigoIbge, latitude) => ({
  chave,
  nome: chave,
  uf: "RJ",
  codigoIbge,
  latitude,
  longitude: -43,
});
const previsao = (resumo) => ({
  data: "14/10/2026",
  dias: [{ dataBr: "14/10/2026", resumo }],
  periodos: {},
});

test("cada setor recebe o próprio contexto e a própria condição oficial", () => {
  const rio = montarContextoMeteorologicoSetor(setor("rio_de_janeiro", "3304557", -22.9), previsao("Nublado"));
  const macae = montarContextoMeteorologicoSetor(setor("macae", "3302403", -22.2), previsao("Chuva moderada"));
  assert.equal(rio.setorId, "rio_de_janeiro");
  assert.equal(rio.localizacao.codigoIbge, "3304557");
  assert.equal(rio.condicaoGeral, "Nublado");
  assert.equal(macae.setorId, "macae");
  assert.equal(macae.localizacao.codigoIbge, "3302403");
  assert.equal(macae.condicaoGeral, "Chuva moderada");
});

test("condições iguais publicadas para setores diferentes permanecem iguais", () => {
  const a = montarContextoMeteorologicoSetor(setor("santos", "3548500", -23.9), previsao("Parcialmente nublado"));
  const b = montarContextoMeteorologicoSetor(setor("vitoria", "3205309", -20.3), previsao("Parcialmente nublado"));
  assert.equal(a.condicaoGeral, b.condicaoGeral);
  assert.notEqual(a.setorId, b.setorId);
});

test("condições diferentes resultam em uma única condição predominante para o dia", () => {
  const porPeriodo = {
    data: "14/10/2026",
    periodos: {
      manha: { resumo: "Nublado" },
      tarde: { resumo: "Pancadas de chuva" },
      noite: { resumo: "Pancadas de chuva" },
    },
  };
  const contexto = montarContextoMeteorologicoSetor(setor("rio_de_janeiro", "3304557", -22.9), porPeriodo);
  assert.equal(contexto.condicaoGeral, "Pancadas de chuva");
  assert.doesNotMatch(contexto.condicaoGeral, /Manhã:|Tarde:|Noite:/);
});

test("empate entre períodos usa a descrição oficial mais completa sem listar períodos", () => {
  const porPeriodo = {
    data: "14/10/2026",
    periodos: {
      manha: { resumo: "Nublado" },
      tarde: { resumo: "Pancadas de chuva isoladas" },
      noite: { resumo: "Poucas nuvens" },
    },
  };
  const contexto = montarContextoMeteorologicoSetor(setor("rio_de_janeiro", "3304557", -22.9), porPeriodo);
  assert.equal(contexto.condicaoGeral, "Pancadas de chuva isoladas");
});

test("ausência em um setor não reutiliza a condição de outro", () => {
  const disponivel = montarContextoMeteorologicoSetor(setor("rio_de_janeiro", "3304557", -22.9), previsao("Céu limpo"));
  const ausente = montarContextoMeteorologicoSetor(setor("manaus", "1302603", -3.1), null);
  assert.equal(disponivel.condicaoGeral, "Céu limpo");
  assert.equal(ausente.condicaoGeral, CONDICAO_INDISPONIVEL);
  assert.equal(ausente.fonteCondicao, "Indisponível");
});
