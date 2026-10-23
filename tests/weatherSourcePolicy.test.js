const test = require("node:test");
const assert = require("node:assert/strict");
const { aplicarPoliticaFontes, FONTE_OPEN_METEO, INDISPONIVEL } = require("../src/logic/weatherSourcePolicy");

function executar(openMeteo = null) {
  const base = { atual: {}, periodos: { manha: {}, tarde: {}, noite: {} } };
  const fontesPorCampo = {};
  const avisos = [];
  const resultado = aplicarPoliticaFontes({
    base,
    openMeteo,
    inmetObservacao: {
      observacao: { medidoEm: "2026-10-22T12:00:00Z", estacao: { codigo: "A636" } },
      agregado: {
        rajadaMaxKmh: 30, precipitacaoTotalMm: 2, periodos: {}, chuvaPorHora: [],
        temperaturaMinC: 21, temperaturaMaxC: 27, umidadeMinPct: 55, umidadeMaxPct: 82,
        coberturaTemperatura: { amostras: 6, horasEsperadas: 10, parcial: true },
        coberturaUmidade: { amostras: 6, horasEsperadas: 10, parcial: true },
      },
    },
    fontesPorCampo,
    logger: { warn: (mensagem) => avisos.push(mensagem) },
  });
  return { base, fontesPorCampo, avisos, diagnosticos: resultado.diagnosticos };
}

test("Open-Meteo fornece previsão e observação INMET permanece separada", () => {
  const periodo = { direcao: "S", intensidadeVento: "Fraco", velocidadeMediaKmh: 12, velocidadeMaxKmh: 18, rajadaMaxKmh: 99, precipitacaoMm: 2, precipitacaoHorariaMaxMm: 1, probabilidadeChuva: 40 };
  const previsao = {
    tempMin: 20, tempMax: 30, umidadeMin: 50, umidadeMax: 90,
    precipitacaoTotalMm: 6, precipitacaoHorariaMaxMm: 1, probabilidadeChuvaMax: 40,
    condicaoGeral: "Nublado", temTempestadeHoje: false,
    atual: { temperaturaC: 25, condicao: "Nublado", fonte: "Open-Meteo" },
    periodos: { manha: periodo, tarde: periodo, noite: periodo },
  };
  const { base, fontesPorCampo } = executar(previsao);
  assert.deepEqual([base.tempMin, base.tempMax, base.umidadeMin, base.umidadeMax], [20, 30, 50, 90]);
  assert.equal(base.rajadaMaxKmh, null);
  assert.equal(base.periodos.manha.rajadaMaxKmh, null);
  assert.equal(base.precipitacaoTotalMm, 6);
  assert.equal(base.atual.temperaturaC, 25);
  assert.deepEqual([base.temperaturaObservadaMinC, base.temperaturaObservadaMaxC], [21, 27]);
  assert.equal(fontesPorCampo.tempMax, FONTE_OPEN_METEO);
  assert.equal(fontesPorCampo.rajadaMaxKmh, INDISPONIVEL);
});

test("campos não publicados ficam indisponíveis e geram diagnóstico", () => {
  const { base, fontesPorCampo, avisos, diagnosticos } = executar(null);
  assert.equal(base.tempMax, null);
  assert.equal(base.rajadaMaxKmh, null);
  assert.equal(base.precipitacaoTotalMm, null);
  assert.equal(fontesPorCampo.tempMax, INDISPONIVEL);
  assert.equal(fontesPorCampo.rajadaMaxKmh, INDISPONIVEL);
  assert.ok(diagnosticos.some((d) => d.indicador === "tempMax" && d.fonteUtilizada === INDISPONIVEL));
  assert.ok(avisos.some((mensagem) => /INFORMAÇÃO INDISPONÍVEL/.test(mensagem)));
});
