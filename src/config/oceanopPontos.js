const { CIDADES } = require("./cities");
const { unidadeVelocidadeSuportada } = require("../logic/windUnits");

// Unidade do vento/rajada do OCEANOP (a resposta não a declara): nós, confirmado
// ao comparar com a Open-Meteo (erro ~3–6 km/h em nós; ~20 km/h se fosse m/s).
// Ajustável por OCEANOP_UNIDADE_VENTO (nós, m/s ou km/h).
function unidadeVento(env = process.env) {
  const bruta = String(env.OCEANOP_UNIDADE_VENTO || "nós").trim();
  return unidadeVelocidadeSuportada(bruta) ? bruta : "nós";
}
// Fuso de DataInicial/DataFinal. A resposta não o declara; UTC é o que melhor
// reproduz a Open-Meteo hora a hora. Ajustável por OCEANOP_FUSO_DADOS (IANA).
function fusoDados(env = process.env) {
  return String(env.OCEANOP_FUSO_DADOS || "UTC").trim() || "UTC";
}

// Como cada base é consultada no OCEANOP. O ID enviado é livre (a API o devolve
// como PointID), mas a coordenada precisa ser exatamente uma cadastrada:
//  - coordenadas: POST por Lat/Lon (Rio, Santos, Aracaju, Oiapoque, Vitória, Salvador);
//  - area: GET por nome de área, com os locais aceitos na resposta;
//  - sem ponto: base ainda não cadastrada no OCEANOP — usa a Open-Meteo.
const ACESSO = Object.freeze({
  rio_de_janeiro: { modo: "coordenadas" },
  santos: { modo: "coordenadas" },
  aracaju: { modo: "coordenadas" },
  oiapoque: { modo: "coordenadas" },
  vitoria: { modo: "coordenadas" },
  salvador: { modo: "coordenadas" },
  macae: { modo: "area", localArea: "macaé", locaisAceitos: ["Macaé", "Macaé (SBME)"] },
  natal: { modo: "area", localArea: "Natal", locaisAceitos: ["Natal"] },
  brasilia: { modo: "area", localArea: "Brasília", locaisAceitos: ["Brasília"] },
  manaus: { modo: "ausente", motivo: "Manaus ainda não tem ponto cadastrado no OCEANOP (coordenada e nome de área não retornam dados)." },
  araucaria: { modo: "area", localArea: "Wenceslau Bráz", locaisAceitos: ["Wenceslau Bráz"] },
});

module.exports = Object.freeze(Object.fromEntries(Object.entries(CIDADES).map(([chave, cidade]) => {
  const acesso = ACESSO[chave] || { modo: "ausente", motivo: "Base sem ponto OCEANOP cadastrado." };
  const unidade = unidadeVento();
  return [chave, Object.freeze({
    ...acesso,
    habilitado: acesso.modo !== "ausente",
    id: chave,
    latitude: cidade.latitude,
    longitude: cidade.longitude,
    referencia: `${cidade.nome} — ${cidade.uf}`,
    fusoHorario: cidade.fusoHorario || "America/Sao_Paulo",
    fusoDados: fusoDados(),
    usarVento: true,
    unidades: Object.freeze({ VelocidadeVento: unidade, VelocidadeVento_10M_Rajada: unidade, DirecaoVento: "graus" }),
  })];
})));
