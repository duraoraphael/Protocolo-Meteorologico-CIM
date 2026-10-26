const test = require("node:test");
const assert = require("node:assert/strict");
const { criarIndicadoresSnapshot } = require("../src/logic/indicatorSnapshot");

test("classificação NORMAL não sobrevive sem valor US AQI", () => {
  const indicadores = criarIndicadoresSnapshot({
    snapshotId: "rio_de_janeiro:2026-10-25T23:00:00Z",
    cidade: { chave: "rio_de_janeiro" }, geradoEmISO: "2026-10-25T23:00:00Z",
    qualidadeAr: { usAqi: null, classificacao: { nivel: "NORMAL" }, referenciaEm: "2026-10-25T22:00:00Z" },
    fontesPorCampo: { "ar.usAqi": "Open-Meteo Air Quality / CAMS" },
  });
  assert.equal(indicadores.qualidadeAr.valor, null);
  assert.equal(indicadores.qualidadeArClassificacao.valor, null);
  assert.equal(indicadores.qualidadeArClassificacao.statusValidacao, "indisponivel");
});

test("snapshot converte EHF da data nos níveis do protocolo", () => {
  for (const [classificacao, esperado] of [
    ["Sem excesso", "Normal"], ["Baixo", "Atenção"],
    ["Severo", "Alerta"], ["Extremo", "Emergência"],
  ]) {
    const relatorio = {
      snapshotId: "rio_de_janeiro:2026-10-26T11:00:00Z",
      cidade: { chave: "rio_de_janeiro", fuso: "America/Sao_Paulo" },
      geradoEmISO: "2026-10-26T11:00:00Z",
      climaSaude: { status: "operacional", dados: {
        dataConsulta: "2026-10-26", consultadoEm: "2026-10-26T11:00:00Z", ehf: { classificacao },
      } },
    };
    assert.equal(criarIndicadoresSnapshot(relatorio).excessoCalor.valor, esperado);
    relatorio.climaSaude.dados.dataConsulta = "2026-10-25";
    assert.equal(criarIndicadoresSnapshot(relatorio).excessoCalor.valor, null);
  }
});
