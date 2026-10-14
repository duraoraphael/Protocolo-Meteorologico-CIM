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
