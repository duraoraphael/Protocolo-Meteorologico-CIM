// Cadastre somente pontos autorizados e homologados pela Petrobras/OCEANOP.
// As chaves devem existir em src/config/cities.js; nunca se infere PointID pelo
// nome da cidade e nunca se reutiliza o ponto de exemplo da documentação.
//
// Formato exigido para promover os dados ao informativo:
// cidade_chave: {
//   habilitado: true,
//   ID: "identificador-autorizado",
//   latitude: -00.0000,
//   longitude: -00.0000,
//   referencia: "descrição operacional do ponto",
//   fusoHorario: "America/Sao_Paulo", // confirmado com o gestor da API
//   unidades: {
//     AlturaOnda: "m", AlturaMaximaOnda: "m",
//     PeriodoOnda: "s", PeriodoPicoOnda: "s",
//     DirecaoOnda: "graus", AlturaOndulacao: "m",
//   },
//   // Vento só pode ser habilitado depois de confirmar também a altura de
//   // VelocidadeVento e suas unidades. O padrão seguro é não utilizá-lo.
//   usarVento: false,
// }
//
// O objeto permanece vazio porque este repositório não contém PointIDs
// autorizados, unidades ou fuso homologados. Isso mantém o fallback atual sem
// apresentar o ponto P-68 de exemplo como dado operacional.
module.exports = {};
