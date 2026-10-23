const { CIDADES } = require("./cities");

const unidadesVentoKmh = Object.freeze({
  VelocidadeVento: "km/h",
  VelocidadeVento_10M_Rajada: "km/h",
  DirecaoVento: "graus",
});

// O endpoint por coordenadas aceita qualquer base cadastrada. Produtos
// marítimos permanecem desativados até que unidades/cobertura sejam validadas
// com uma resposta autorizada; isso impede aplicar ondas a bases interiores.
module.exports = Object.freeze(Object.fromEntries(Object.entries(CIDADES).map(([chave, cidade]) => [
  chave,
  Object.freeze({
    habilitado: true,
    id: chave,
    latitude: cidade.latitude,
    longitude: cidade.longitude,
    referencia: `${cidade.nome} — ${cidade.uf}`,
    fusoHorario: cidade.fusoHorario || "America/Sao_Paulo",
    usarVento: true,
    usarMar: false,
    unidades: unidadesVentoKmh,
  }),
])));
