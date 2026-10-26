const test = require("node:test");
const assert = require("node:assert/strict");

const { CIDADES, getCidade, baseExiste } = require("../src/config/cities");
const { BASES_DISTRIBUICAO } = require("../src/config/distributionBases");

test("Natal e Oiapoque usam cadastro operacional exato", () => {
  assert.deepEqual(getCidade("natal"), {
    chave: "natal",
    costeira: true,
    nome: "Natal",
    uf: "RN",
    fusoHorario: "America/Fortaleza",
    latitude: -5.8115,
    longitude: -35.2415,
    pontoMar: { latitude: -5.82, longitude: -35.10, referencia: "Atlântico a leste de Natal" },
    codigoIbge: "2408102",
    climaSaudeUrl: "https://clima.saude.gov.br/rn/natal?modo=ehf",
    links: {
      inmet: "https://previsao.inmet.gov.br/2408102",
      defesaCivilTelefone: "199",
    },
  });
  assert.deepEqual(getCidade("oiapoque"), {
    chave: "oiapoque",
    costeira: true,
    nome: "Oiapoque",
    uf: "AP",
    fusoHorario: "America/Belem",
    latitude: 3.861224,
    longitude: -51.796699,
    pontoMar: { latitude: 4.10, longitude: -51.20, referencia: "Atlântico na costa do Amapá, referência para Oiapoque" },
    codigoIbge: "1600501",
    climaSaudeUrl: "https://clima.saude.gov.br/ap/oiapoque?modo=ehf",
    links: {
      inmet: "https://previsao.inmet.gov.br/1600501",
      defesaCivilTelefone: "199",
    },
  });
});

test("Anchieta e Linhares deixam todos os cadastros operacionais ativos", () => {
  for (const chave of ["anchieta", "linhares"]) {
    assert.equal(baseExiste(chave), false);
    assert.equal(CIDADES[chave], undefined);
    assert.equal(BASES_DISTRIBUICAO[chave], undefined);
  }
  assert.ok(BASES_DISTRIBUICAO.natal);
  assert.ok(BASES_DISTRIBUICAO.oiapoque);
  assert.equal(Object.keys(CIDADES).length, 11);
});
