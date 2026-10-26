// Verificação somente de leitura das rotas INMET citadas no protocolo.
// Não altera as rotas usadas pelo produto nem grava payloads de observação.
const fs = require("node:fs");
const path = require("node:path");

const base = "https://apitempo.inmet.gov.br";
const previsao = "https://apiprevmet3.inmet.gov.br";
const fim = new Date();
const inicio = new Date(fim.getTime() - 2 * 86400000);
const data = (valor) => valor.toISOString().slice(0, 10);
const urls = [
  `${base}/estacoes/T`,
  `${base}/estacao/${data(inicio)}/${data(fim)}/A636`,
  `${previsao}/previsao/3304557`,
  `${previsao}/avisos/ativos`,
];

async function consultar(url) {
  const consultadoEm = new Date().toISOString();
  try {
    const resposta = await fetch(url, { signal: AbortSignal.timeout(15000) });
    const texto = await resposta.text();
    let corpo;
    try { corpo = JSON.parse(texto); } catch { corpo = null; }
    return {
      endpoint: url, consultadoEm, http: resposta.status,
      formato: Array.isArray(corpo) ? "array" : corpo && typeof corpo === "object" ? "objeto" : "não JSON",
      registros: Array.isArray(corpo) ? corpo.length : null,
      camposRaiz: corpo && !Array.isArray(corpo) ? Object.keys(corpo).slice(0, 12) : null,
      camposPrimeiroRegistro: Array.isArray(corpo) && corpo.length && typeof corpo[0] === "object"
        ? Object.keys(corpo[0]).slice(0, 20) : null,
    };
  } catch (erro) {
    return { endpoint: url, consultadoEm, http: null, erro: erro.code || erro.name };
  }
}

async function main() {
  const resultados = [];
  for (const url of urls) resultados.push(await consultar(url));
  const arquivo = path.join(__dirname, "..", "tmp", "auditoria-endpoints-inmet-atual.json");
  fs.writeFileSync(arquivo, JSON.stringify({ executadoEm: new Date().toISOString(), resultados }, null, 2));
  console.log(JSON.stringify(resultados, null, 2));
}

main().catch((erro) => { console.error(erro); process.exitCode = 1; });
