// Sobe o app (criarApp) numa porta livre de 127.0.0.1 para testes HTTP.
const http = require("node:http");

const SENHA_TESTE = "senha-de-teste-forte-123";

async function subirApp(opcoes = {}) {
  const { criarApp } = require("../../server.js");
  const app = criarApp({ senhaPainel: SENHA_TESTE, ...opcoes });
  const servidor = http.createServer(app);
  await new Promise((resolve) => servidor.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${servidor.address().port}`;
  return {
    app,
    base,
    fechar: () => new Promise((resolve) => { servidor.closeAllConnections?.(); servidor.close(resolve); }),
  };
}

module.exports = { subirApp, SENHA_TESTE };
