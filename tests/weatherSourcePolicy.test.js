const test = require('node:test');
const assert = require('node:assert/strict');
const { aplicarPoliticaFontes } = require('../src/logic/weatherSourcePolicy');

function periodo(periodo, rajadaMaxKmh, precipitacaoMm) {
  return { periodo, rajadaMaxKmh, precipitacaoMm };
}

function cenario({ climaSaude, inmetPrevisao } = {}) {
  const openMeteo = {
    tempMin: 21, tempMax: 31, umidadeMin: 48, umidadeMax: 87,
    precipitacaoDiariaMm: 12.5,
    chuvaHoraria: [{ horario: '05:00', precipitacaoMm: 1 }],
    periodos: {
      manha: periodo('Manhã', 36, 2),
      tarde: periodo('Tarde', 44, 5),
      noite: periodo('Noite', 32, 1),
    },
  };
  const base = { periodos: {
    manha: periodo('Manhã', null, null),
    tarde: periodo('Tarde', null, null),
    noite: periodo('Noite', null, null),
  } };
  const fontesPorCampo = {};
  const logs = [];
  const resultado = aplicarPoliticaFontes({
    base, openMeteo, inmetPrevisao: inmetPrevisao || { periodos: {} },
    climaSaude: climaSaude || { status: 'operacional', dados: {
      dataConsulta: '2026-10-09', temperatura: { minima: 22, maxima: 30 },
    } },
    fontesPorCampo, agora: new Date('2026-10-09T12:00:00-03:00'),
    logger: { log: (mensagem) => logs.push(mensagem) },
  });
  return { base, fontesPorCampo, logs, diagnosticos: resultado.diagnosticos };
}

test('fallback é individual: mantém temperatura do Clima Saúde e busca umidade e rajada no Open-Meteo', () => {
  const { base, fontesPorCampo, diagnosticos, logs } = cenario();
  assert.deepEqual([base.tempMin, base.tempMax], [22, 30]);
  assert.deepEqual([base.umidadeMin, base.umidadeMax], [48, 87]);
  assert.equal(base.rajadaMaxKmh, 44);
  assert.equal(fontesPorCampo.tempMax, 'Clima e Saúde — Ministério da Saúde');
  assert.equal(fontesPorCampo.umidadeMin, 'Open-Meteo');
  assert.equal(fontesPorCampo.rajadaMaxKmh, 'Open-Meteo');
  assert.ok(diagnosticos.some((d) => /não disponibilizou umidade relativa mínima/i.test(d.motivo)));
  assert.ok(diagnosticos.some((d) => /não disponibilizou previsão numérica de rajada/i.test(d.motivo)));
  assert.ok(logs.every((linha) => linha.startsWith('[FALLBACK]')));
});

test('valor numérico oficial de rajada prevalece somente no período em que existe', () => {
  const { base, fontesPorCampo } = cenario({ inmetPrevisao: { periodos: {
    tarde: { rajadaMaxKmh: 52, precipitacaoMm: 7 },
  }, precipitacaoDiariaMm: 15 } });
  assert.equal(base.periodos.manha.rajadaMaxKmh, 36);
  assert.equal(base.periodos.tarde.rajadaMaxKmh, 52);
  assert.equal(fontesPorCampo['periodos.manha.rajadaMaxKmh'], 'Open-Meteo');
  assert.equal(fontesPorCampo['periodos.tarde.rajadaMaxKmh'], 'INMET — previsão oficial');
  assert.equal(base.precipitacaoDiariaMm, 15);
});

test('falha do Clima Saúde não apaga campos válidos do Open-Meteo', () => {
  const { base, diagnosticos } = cenario({ climaSaude: { status: 'indisponivel', dados: null } });
  assert.deepEqual([base.tempMin, base.tempMax, base.umidadeMin, base.umidadeMax], [21, 31, 48, 87]);
  assert.ok(diagnosticos.some((d) => /indisponível na coleta/i.test(d.motivo)));
});
