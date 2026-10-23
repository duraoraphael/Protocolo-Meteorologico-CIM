const test = require("node:test");
const assert = require("node:assert/strict");
const { getCidade } = require("../src/config/cities");
const { montarRelatorio } = require("../src/logic/reportBuilder");

const falha = (nome) => Object.assign(new Error(`${nome} indisponível`), {
  code: "TEST_SOURCE_UNAVAILABLE",
  tipo: "network",
  transitorio: false,
});

test("primeira carga do painel permanece disponível quando todas as fontes falham", async () => {
  const indisponivel = async () => { throw falha("Fonte"); };
  const relatorio = await montarRelatorio(getCidade("brasilia"), {
    dependencias: {
      buscarPrevisaoInmet: indisponivel,
      buscarAvisosInmet: indisponivel,
      buscarOpenMeteo: indisponivel,
      buscarObservacaoInmet: async () => ({
        status: "indisponivel",
        mensagem: "INMET — Observação indisponível.",
        observacao: null,
        agregado: null,
        erro: falha("INMET — Observação"),
      }),
      buscarOceanopPorCoordenadas: indisponivel,
      buscarRajadasTetraTech: indisponivel,
      lerClimaSaudeArmazenado: () => ({
        status: "indisponivel",
        mensagem: "Clima e Saúde indisponível.",
        dados: null,
      }),
    },
  });

  assert.equal(relatorio.cidade.chave, "brasilia");
  assert.equal(relatorio.condicaoGeral, "Condição indisponível");
  assert.equal(relatorio.tempMax, null);
  assert.equal(relatorio.fontesPorCampo.tempMax, "Informação indisponível");
  assert.ok(relatorio.avisosColeta.some((aviso) => /modo degradado/i.test(aviso)));
  assert.ok(relatorio.monitoramentoApis.every((api) => api.status !== "operacional"));
  assert.equal(relatorio.monitoramentoApis.find((api) => api.id === "open-meteo-air")?.status, "nao_configurada");
  assert.match(relatorio.monitoramentoApis.find((api) => api.id === "open-meteo-air")?.detalhe, /licença comercial/i);
  assert.match(relatorio.qualidadeAr.motivoIndisponibilidade, /licença comercial/i);
});
