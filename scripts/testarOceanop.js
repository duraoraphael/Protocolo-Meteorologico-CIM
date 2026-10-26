// Teste manual da integração OCEANOP.
//   node --use-system-ca scripts/testarOceanop.js santos     -> uma base, com detalhes
//   node --use-system-ca scripts/testarOceanop.js todas      -> resumo das 11 bases
// Lê as credenciais do .env e nunca as imprime. Sai com código 1 se alguma base habilitada falhar.
require("dotenv").config({ quiet: true });
const { buscarOceanopDaBase, mapearOceanopParaVento, obterDiagnosticoOceanop } = require("../src/sources/oceanop");
const pontos = require("../src/config/oceanopPontos");

async function consultar(chave, ponto, detalhado) {
  if (!ponto.habilitado) return console.log(`${chave.padEnd(15)} sem ponto  — ${ponto.motivo}`), true;
  try {
    const resultado = await buscarOceanopDaBase(ponto, { usarCache: false, logger: null });
    const vento = mapearOceanopParaVento(resultado, ponto, { inicioHora: 0, fimHora: 24, exigirFuturo: false });
    const p = resultado.previsoes;
    console.log(`${chave.padEnd(15)} OK ${resultado.modo.padEnd(11)} ${p.length} registros até ${p.at(-1).fim.slice(0, 10)}; rajada máx. de hoje ${vento.resumo.rajadaMaxKmh} km/h`);
    if (detalhado) console.log("Primeiros registros:", JSON.stringify(p.slice(0, 3), null, 2));
    return true;
  } catch (erro) {
    console.log(`${chave.padEnd(15)} FALHA ${erro.code || ""} ${erro.httpStatus ? `HTTP ${erro.httpStatus}` : ""} ${erro.message}`);
    return false;
  }
}

async function main() {
  const alvo = process.argv[2] || "rio_de_janeiro";
  console.log(`Unidade do vento: ${Object.values(pontos)[0].unidades.VelocidadeVento}; fuso das datas: ${Object.values(pontos)[0].fusoDados}`);
  console.log(`Credenciais: X-API-Key ${process.env.OCEANOP_API_KEY ? "definida" : "ausente"}; Bearer ${process.env.OCEANOP_ACCESS_TOKEN ? "definido" : "ausente"}; usuário/senha ${process.env.OCEANOP_USUARIO && process.env.OCEANOP_SENHA ? "definidos (Basic)" : "ausentes"}`);
  const chaves = alvo === "todas" ? Object.keys(pontos) : [alvo];
  let ok = true;
  for (const chave of chaves) {
    if (!pontos[chave]) throw new Error(`Base desconhecida: ${chave}. Opções: ${Object.keys(pontos).join(", ")}`);
    ok = (await consultar(chave, pontos[chave], alvo !== "todas")) && ok;
  }
  if (!ok) {
    console.error("Diagnóstico:", JSON.stringify(obterDiagnosticoOceanop().errosRecentes));
    process.exit(1);
  }
}
main().catch((erro) => { console.error(`Falha: ${erro.message}`); process.exit(1); });
