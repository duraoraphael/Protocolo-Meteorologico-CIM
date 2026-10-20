// Mapeamento entre as bases CIM e o parâmetro `local` do endpoint
// GET /api/v1/previsao/JsonPrevisaoAreaAsync.
//
// As velocidades foram confirmadas em km/h. Portanto, o adaptador preserva os
// valores recebidos, sem multiplicar por 3,6. Os horários são interpretados no
// fuso operacional de cada base (Manaus tem fuso próprio; as demais usam o
// horário de Brasília/São Paulo).

const unidadesVentoKmh = Object.freeze({
  VelocidadeVento: "km/h",
  VelocidadeVento_10M_Rajada: "km/h",
  DirecaoVento: "graus",
});

function area(local, referencia, fusoHorario = "America/Sao_Paulo") {
  return Object.freeze({
    habilitado: true,
    local,
    referencia,
    fusoHorario,
    usarVento: true,
    unidades: unidadesVentoKmh,
  });
}

module.exports = Object.freeze({
  santos: area("santos", "Santos — SP"),
  araucaria: area("Araucaria", "Araucária — PR"),
  manaus: area("manaus", "Manaus — AM", "America/Manaus"),
  rio_de_janeiro: area("Rio de Janeiro", "Rio de Janeiro — RJ"),
  macae: area("macaé", "Macaé — RJ"),
  brasilia: area("Brasilia", "Brasília — DF"),
  vitoria: area("Vitoria", "Vitória — ES"),
});
