const test = require("node:test");
const assert = require("node:assert/strict");
const { getCidade } = require("../src/config/cities");
const { montarRelatorio } = require("../src/logic/reportBuilder");
const { chuvaPrevistaAcumulada } = require("../src/render/emailTemplate");

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
      buscarQualidadeAr: indisponivel,
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
  assert.equal(relatorio.monitoramentoApis.find((api) => api.id === "open-meteo-air")?.status, "indisponivel");
  assert.match(relatorio.monitoramentoApis.find((api) => api.id === "open-meteo-air")?.detalhe, /Fonte indisponível/i);
  assert.match(relatorio.qualidadeAr.motivoIndisponibilidade, /Fonte indisponível/i);
  assert.equal(relatorio.chuvaPrevistaDiaMm, null);
  assert.equal(chuvaPrevistaAcumulada(relatorio), null);
});

test("previsão de chuva do relatório vem da previsão Open-Meteo", async () => {
  const indisponivel = async () => { throw falha("Fonte"); };
  const relatorio = await montarRelatorio(getCidade("brasilia"), {
    dependencias: {
      buscarPrevisaoInmet: indisponivel,
      buscarAvisosInmet: indisponivel,
      buscarQualidadeAr: indisponivel,
      buscarOpenMeteo: async () => ({
        dataReferencia: "2026-10-23",
        precipitacaoDiariaMm: 4.7,
        precipitacaoTotalMm: 4.7,
        probabilidadeChuvaMax: 85,
        periodos: {},
        periodosDiaCompleto: {},
        previsaoDias: [{ data: "2026-10-23", chuvaMm: 4.7 }],
      }),
      buscarObservacaoInmet: async () => ({
        status: "operacional",
        observacao: { estacao: { codigo: "A001", uf: "DF", distanciaKm: 10 }, medidoEm: "2026-10-23T12:00:00.000Z" },
        agregado: { precipitacaoTotalMm: 91 },
      }),
      buscarOceanopPorCoordenadas: indisponivel,
      buscarRajadasTetraTech: indisponivel,
      lerClimaSaudeArmazenado: () => ({ status: "indisponivel", dados: null }),
    },
  });

  assert.equal(relatorio.precipitacaoDiariaMm, 91);
  assert.equal(relatorio.chuvaPrevistaDiaMm, 4.7);
  assert.equal(relatorio.classificacaoDados.chuvaPrevistaDia.estado, "prevista");
  assert.match(relatorio.fontesPorCampo.chuvaPrevistaDiaMm, /Open-Meteo/);
  assert.equal(chuvaPrevistaAcumulada(relatorio), 4.7);
});
