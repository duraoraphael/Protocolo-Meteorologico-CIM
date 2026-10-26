const test = require("node:test");
const assert = require("node:assert/strict");
const { aplicarPoliticaFontes, complementarRajadaPrevista, FONTE_OPEN_METEO, FONTE_INMET_PREVISAO, INDISPONIVEL } = require("../src/logic/weatherSourcePolicy");

function executar(openMeteo = null, inmetPrevisao = null) {
  const base = { atual: {}, periodos: { manha: {}, tarde: {}, noite: {} } };
  const fontesPorCampo = {};
  const avisos = [];
  const resultado = aplicarPoliticaFontes({
    base,
    openMeteo,
    inmetPrevisao,
    inmetObservacao: {
      status: "operacional",
      observacao: { status: "operacional", desatualizado: false, medidoEm: "2026-10-22T12:00:00Z", temperaturaAtualC: 23, umidadeAtualPct: 68, estacao: { codigo: "A636", nome: "Rio - Jacarepaguá", distanciaKm: 6 } },
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

test("temperatura e umidade previstas ficam indisponíveis sem INMET e a observação oficial é preservada", () => {
  const periodo = { direcao: "S", intensidadeVento: "Fraco", velocidadeMediaKmh: 12, velocidadeMaxKmh: 18, rajadaMaxKmh: 99, precipitacaoMm: 2, precipitacaoHorariaMaxMm: 1, probabilidadeChuva: 40 };
  const previsao = {
    tempMin: 20, tempMax: 30, umidadeMin: 50, umidadeMax: 90,
    precipitacaoTotalMm: 6, precipitacaoPrevistaDiaMm: 8,
    precipitacaoHorariaMaxMm: 1, probabilidadeChuvaMax: 40,
    condicaoGeral: "Nublado", temTempestadeHoje: false,
    atual: { temperaturaC: 25, condicao: "Nublado", fonte: "Open-Meteo" },
    periodos: { manha: periodo, tarde: periodo, noite: periodo },
  };
  const { base, fontesPorCampo } = executar(previsao, { periodos: { manha: { resumo: "Muitas nuvens" } } });
  assert.deepEqual([base.tempMin, base.tempMax, base.umidadeMin, base.umidadeMax], [null, null, null, null]);
  assert.equal(base.rajadaMaxKmh, null);
  assert.equal(base.periodos.manha.rajadaMaxKmh, 99);
  assert.equal(fontesPorCampo["periodos.manha.rajadaMaxKmh"], FONTE_OPEN_METEO);
  assert.equal(base.precipitacaoTotalMm, 8);
  assert.equal(base.precipitacaoJanelaMm, 6);
  assert.equal(base.atual.temperaturaC, 23, "valor atual prioriza a observação INMET, não o modelo Open-Meteo");
  assert.equal(base.atual.umidadePct, 68);
  assert.equal(base.atual.fonte, "INMET — estação automática (A636)");
  assert.equal(fontesPorCampo.atual, "INMET — estação automática (A636)");
  assert.equal(base.atual.fonteCondicao, "INMET — previsão oficial");
  assert.equal(base.condicaoGeral, "Muitas nuvens");
  assert.equal(base.atual.condicao, "Muitas nuvens");
  assert.deepEqual([base.temperaturaObservadaMinC, base.temperaturaObservadaMaxC], [21, 27]);
  assert.equal(fontesPorCampo.tempMax, INDISPONIVEL);
  assert.equal(fontesPorCampo.rajadaMaxKmh, INDISPONIVEL);
});

test("faixas diárias previstas vêm do produto municipal INMET e mantêm sua procedência", () => {
  const previsaoInmet = { data: "25/10/2026", dias: [
    { dataBr: "25/10/2026", tempMin: 20, tempMax: 28, umidadeMin: 60, umidadeMax: 100 },
  ], periodos: { manha: { resumo: "Muitas nuvens" } } };
  const { base, fontesPorCampo } = executar(
    { tempMin: 18, tempMax: 32, umidadeMin: 40, umidadeMax: 90 }, previsaoInmet);
  assert.deepEqual([base.tempMin, base.tempMax, base.umidadeMin, base.umidadeMax], [20, 28, 60, 100]);
  for (const campo of ["tempMin", "tempMax", "umidadeMin", "umidadeMax"])
    assert.equal(fontesPorCampo[campo], FONTE_INMET_PREVISAO);
});

test("faixa INMET inválida não é substituída por valores modelados", () => {
  const { base, fontesPorCampo } = executar(
    { tempMin: 18, tempMax: 30, umidadeMin: 40, umidadeMax: 90 },
    { data: "25/10/2026", dias: [{ dataBr: "25/10/2026", tempMin: 20, tempMax: null, umidadeMin: 120, umidadeMax: 100 }] });
  assert.deepEqual([base.tempMin, base.tempMax, base.umidadeMin, base.umidadeMax], [null, null, null, null]);
  assert.equal(fontesPorCampo.tempMin, INDISPONIVEL);
});

test("condição ausente no INMET permanece indisponível", () => {
  const { base, fontesPorCampo } = executar({ condicaoGeral: "Chuva moderada" });
  assert.equal(base.condicaoGeral, null);
  assert.equal(fontesPorCampo.condicaoGeral, INDISPONIVEL);
});

test("rajada prevista é sempre substituída pela série Open-Meteo sem usar vento sustentado", () => {
  const base = { rajadaMaxKmh: 42, periodos: { manha: { rajadaMaxKmh: 35 }, tarde: { rajadaMaxKmh: null }, noite: { rajadaMaxKmh: null } } };
  const fontesPorCampo = { rajadaMaxKmh: "Fonte histórica", "periodos.manha.rajadaMaxKmh": "Fonte histórica" };
  complementarRajadaPrevista({ base, fontesPorCampo, cidade: { nome: "Santos", uf: "SP" }, openMeteo: {
    rajadaMaxKmh: 55, rajadaPrevistaEm: "2026-10-25T22:00", rajadaPeriodo: "18h–00h",
    periodos: { manha: { rajadaMaxKmh: 25 }, tarde: { rajadaMaxKmh: 0, rajadaPrevistaEm: "2026-10-25T15:00", janela: "12h–18h" }, noite: { rajadaMaxKmh: 55, janela: "18h–00h" } },
  } });
  assert.equal(base.rajadaMaxKmh, 55);
  assert.equal(base.periodos.manha.rajadaMaxKmh, 25);
  assert.equal(base.periodos.tarde.rajadaMaxKmh, 0);
  assert.equal(base.periodos.noite.rajadaMaxKmh, 55);
  assert.equal(fontesPorCampo["periodos.tarde.rajadaMaxKmh"], FONTE_OPEN_METEO);
  base.rajadaMaxKmh = null;
  complementarRajadaPrevista({ base, fontesPorCampo, cidade: { nome: "Santos", uf: "SP" }, openMeteo: {
    rajadaMaxKmh: 55, rajadaPrevistaEm: "2026-10-25T22:00", rajadaPeriodo: "18h–00h", periodos: {},
  } });
  assert.equal(base.rajadaMaxKmh, 55);
  assert.equal(fontesPorCampo.rajadaMaxKmh, FONTE_OPEN_METEO);
});

test("card de rajada modelada usa apenas pico ainda futuro", () => {
  const base = { rajadaMaxKmh: null, periodos: {} };
  const fontesPorCampo = {};
  complementarRajadaPrevista({ base, fontesPorCampo, cidade: { nome: "Rio de Janeiro", uf: "RJ" }, openMeteo: {
    rajadaMaxKmh: 70, rajadaPrevistaEm: "2026-10-25T18:00:00Z",
    rajadaRestanteMaxKmh: 22, rajadaRestantePrevistaEm: "2026-10-26T03:00:00Z",
    rajadaRestantePeriodo: "22h–00h", periodos: {},
  } });
  assert.equal(base.rajadaMaxKmh, 22);
  assert.equal(base.rajadaPrioritariaReferencia.rajadaPrevistaEm, "2026-10-26T03:00:00Z");
  assert.equal(base.rajadaPrioritariaReferencia.periodoReferencia, "22h–00h");

  const semFuturo = { rajadaMaxKmh: null, periodos: {} };
  complementarRajadaPrevista({ base: semFuturo, fontesPorCampo: {}, cidade: { nome: "Rio de Janeiro", uf: "RJ" }, openMeteo: {
    rajadaMaxKmh: 70, rajadaRestanteMaxKmh: null, periodos: {},
  } });
  assert.equal(semFuturo.rajadaMaxKmh, null);
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

test("observação INMET antiga não é reapresentada como temperatura e umidade atuais", () => {
  const base = { atual: {}, periodos: { manha: {}, tarde: {}, noite: {} } };
  const fontesPorCampo = {};
  aplicarPoliticaFontes({
    base,
    openMeteo: { atual: { temperaturaC: 27, umidadePct: 40, condicao: "Ensolarado", fonte: "Open-Meteo" } },
    inmetObservacao: { status: "degradado", observacao: { status: "armazenado", desatualizado: true, temperaturaAtualC: 25, umidadeAtualPct: 70, estacao: { codigo: "A636" } } },
    fontesPorCampo, logger: null,
  });
  assert.equal(base.atual.temperaturaC, null);
  assert.equal(base.atual.umidadePct, null);
  assert.match(base.atual.motivoIndisponibilidade, /desatualizada|distante|indisponível/i);
  assert.equal(base.atual.fonte, INDISPONIVEL);
  assert.equal(fontesPorCampo.atual, INDISPONIVEL);
  assert.equal(base.atual.condicao, "Condição indisponível");
});

test("valor atual modelado não substitui observação oficial ausente", () => {
  const base = { atual: {}, periodos: { manha: {}, tarde: {}, noite: {} } };
  const fontesPorCampo = {};
  aplicarPoliticaFontes({ base, fontesPorCampo, inmetObservacao: { status: "indisponivel" },
    openMeteo: { atual: { temperaturaC: 29, umidadePct: 0, horario: "2026-10-25T21:00:00Z", previsao: true } },
    agora: new Date("2026-10-25T21:30:00Z"), logger: null });
  assert.equal(base.atual.temperaturaC, null);
  assert.equal(base.atual.umidadePct, null);
  assert.equal(base.atual.statusObservacao, "indisponivel");
  assert.equal(base.atual.previsao, false);
  assert.equal(fontesPorCampo["atual.temperaturaC"], INDISPONIVEL);
  const antigo = { atual: {}, periodos: { manha: {}, tarde: {}, noite: {} } };
  aplicarPoliticaFontes({ base: antigo, fontesPorCampo: {}, inmetObservacao: { status: "indisponivel" },
    openMeteo: { atual: { temperaturaC: 29, umidadePct: 0, horario: "2026-10-25T21:00:00Z", previsao: true } },
    agora: new Date("2026-10-26T03:30:00Z"), logger: null });
  assert.equal(antigo.atual.temperaturaC, null);
  assert.equal(antigo.atual.umidadePct, null);
});

test("última observação INMET recente em cache mantém horário e estado degradado", () => {
  const base = { atual: {}, periodos: { manha: {}, tarde: {}, noite: {} } };
  const fontesPorCampo = {};
  aplicarPoliticaFontes({
    base,
    openMeteo: { atual: { temperaturaC: 27, condicao: "Ensolarado" } },
    inmetObservacao: {
      status: "degradado",
      observacao: {
        status: "armazenado_recente", desatualizado: false,
        temperaturaAtualC: 25, umidadeAtualPct: 70,
        medidoEm: "2026-10-25T22:00:00Z", estacao: { codigo: "A101" },
      },
    },
    fontesPorCampo, logger: null,
  });
  assert.equal(base.atual.temperaturaC, 25);
  assert.equal(base.atual.umidadePct, 70);
  assert.equal(base.atual.horario, "2026-10-25T22:00:00Z");
  assert.equal(base.atual.statusObservacao, "degradado");
  assert.match(base.atual.fonte, /A101.*armazenada/);
  assert.match(fontesPorCampo["atual.temperaturaC"], /INMET/);
});
