const test = require("node:test");
const assert = require("node:assert/strict");

const { CIDADES, getCidade, baseExiste } = require("../src/config/cities");
const { BASES_DISTRIBUICAO } = require("../src/config/distributionBases");
const oceanopAreas = require("../src/config/oceanopAreas");
const rajadaPortais = require("../src/config/rajadaPortais");

test("Natal e Oiapoque usam cadastro operacional exato", () => {
  assert.deepEqual(getCidade("natal"), {
    chave: "natal",
    costeira: true,
    nome: "Natal",
    uf: "RN",
    fusoHorario: "America/Fortaleza",
    latitude: -5.8115,
    longitude: -35.2415,
    codigoIbge: "2408102",
    climatempo: { localeIdEnv: "CLIMATEMPO_LOCALE_ID_NATAL", municipio: "Natal" },
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
    codigoIbge: "1600501",
    climatempo: { localeIdEnv: "CLIMATEMPO_LOCALE_ID_OIAPOQUE", municipio: "Oiapoque" },
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

test("OCEANOP por área não inventa identificadores e Tetra Tech usa áreas confirmadas", () => {
  assert.equal(oceanopAreas.natal, undefined);
  assert.equal(oceanopAreas.oiapoque, undefined);
  assert.deepEqual(rajadaPortais.natal, {
    fonte: "tetratech", habilitado: true, areaName: "Natal", tipo: "Terrestre",
    pagina: "https://petrobras.ttforecast.com.br/bulletin/forecast-chart/Terrestre/Natal",
    fusoHorario: "America/Fortaleza",
  });
  assert.deepEqual(rajadaPortais.oiapoque, {
    fonte: "tetratech", habilitado: true, areaName: "Oiapoque", tipo: "Terrestre",
    pagina: "https://petrobras.ttforecast.com.br/bulletin/forecast-chart/Terrestre/Oiapoque",
    fusoHorario: "America/Belem",
  });
});
