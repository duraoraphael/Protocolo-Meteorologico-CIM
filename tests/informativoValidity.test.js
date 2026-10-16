const test = require("node:test");
const assert = require("node:assert/strict");

const {
  validadeInformativo,
  informativoVigente,
  intervaloAvisos,
} = require("../src/logic/informativoValidity");
const { registroHistorico } = require("../src/logic/scheduledReport");

test("informativo das 05h permanece válido até 00h do dia seguinte em São Paulo", () => {
  const validade = validadeInformativo("05:00", new Date("2026-10-13T08:00:00.000Z"));
  assert.deepEqual(validade, {
    codigo: "05h",
    papel: "inicial",
    fusoHorario: "America/Sao_Paulo",
    validoDeISO: "2026-10-13T08:00:00.000Z",
    validoAteISO: "2026-10-14T03:00:00.000Z",
  });
  assert.equal(informativoVigente(validade, "2026-10-13T18:00:00.000Z"), true, "não vence às 15h");
  assert.equal(informativoVigente(validade, "2026-10-14T02:59:59.999Z"), true);
  assert.equal(informativoVigente(validade, "2026-10-14T03:00:00.000Z"), false);
});

test("informativo das 15h é atualização e vale até a próxima edição das 05h", () => {
  const validade = validadeInformativo("15:00", new Date("2026-10-13T18:00:00.000Z"));
  assert.equal(validade.papel, "atualizacao");
  assert.equal(validade.validoDeISO, "2026-10-13T18:00:00.000Z");
  assert.equal(validade.validoAteISO, "2026-10-14T08:00:00.000Z");
});

test("edição das 05h prevê até 00h, quando termina sua validade documental", () => {
  const janela = intervaloAvisos("05:00", new Date("2026-10-13T08:00:00.000Z"));
  const validade = validadeInformativo("05:00", new Date("2026-10-13T08:00:00.000Z"));
  assert.equal(janela.fimPeriodo.toISOString(), "2026-10-14T03:00:00.000Z");
  assert.equal(validade.validoAteISO, "2026-10-14T03:00:00.000Z");
});

test("histórico identifica separadamente a edição inicial e a atualização", () => {
  const inicial = registroHistorico({
    tipoDocumento: "INFORMATIVO_05H",
    validadeInformativo: validadeInformativo("05:00", "2026-10-13T08:00:00.000Z"),
    severidade: { grau: "NORMAL", eventos: [] },
  }, "2026-10-13T08:01:00.000Z");
  const atualizacao = registroHistorico({
    tipoDocumento: "INFORMATIVO_15H",
    validadeInformativo: validadeInformativo("15:00", "2026-10-13T18:00:00.000Z"),
    severidade: { grau: "ATENÇÃO", eventos: [] },
  }, "2026-10-13T18:01:00.000Z");
  assert.equal(inicial.edicao.papel, "inicial");
  assert.equal(atualizacao.edicao.papel, "atualizacao");
  assert.notEqual(inicial.edicao.validoAteISO, atualizacao.edicao.validoAteISO);
});

test("edições 09h, 12h, 17h e 20h: informativo programado, previsão até 00h e validade até 05h do dia seguinte", () => {
  const { HORARIOS_INFORMATIVO, horariosConfigurados, validadeInformativo: validade, edicaoInformativo } = require("../src/logic/informativoValidity");
  const { tipoDocumentoPorHorario, informativoProgramado, TIPOS_DOCUMENTO } = require("../src/logic/alertPresentation");
  const { probabilidadeChuvaDaEdicao } = require("../src/logic/reportBuilder");
  assert.deepEqual(HORARIOS_INFORMATIVO, ["05:00", "09:00", "12:00", "15:00", "17:00", "20:00"]);
  assert.throws(() => horariosConfigurados("05:00,10:00"), /10:00/);

  const instante = new Date("2026-10-16T15:00:00.000Z"); // 12:00 em Brasília
  for (const [horario, hora] of [["09:00", 9], ["12:00", 12], ["17:00", 17], ["20:00", 20]]) {
    const tipo = tipoDocumentoPorHorario(horario);
    assert.notEqual(tipo, TIPOS_DOCUMENTO.EXTRAORDINARIO, horario);
    assert.ok(informativoProgramado(tipo), `${horario} é informativo programado`);
    assert.equal(edicaoInformativo(horario).previsaoAte, "00h");
    const v = validade(horario, instante);
    assert.equal(v.validoDeISO, new Date(Date.UTC(2026, 9, 16, hora + 3)).toISOString());
    assert.equal(v.validoAteISO, "2026-10-17T08:00:00.000Z");
    const prob = probabilidadeChuvaDaEdicao({
      horarioAgendado: horario,
      openMeteo: { chuvaHoraria: [{ horario: "06:00", probabilidade: 90 }, { horario: "21:00", probabilidade: 40 }] },
    });
    assert.equal(prob.janela, `${String(hora).padStart(2, "0")}h–00h`);
    assert.equal(prob.valor, 40, `${horario} ignora horas anteriores à edição`);
  }
  assert.equal(tipoDocumentoPorHorario("05:00"), TIPOS_DOCUMENTO.INFORMATIVO_05H);
  assert.equal(tipoDocumentoPorHorario("15:00"), TIPOS_DOCUMENTO.INFORMATIVO_15H);
  assert.equal(tipoDocumentoPorHorario("10:00"), TIPOS_DOCUMENTO.EXTRAORDINARIO);
});
