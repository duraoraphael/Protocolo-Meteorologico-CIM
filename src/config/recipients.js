// Cadastro dos responsáveis (nome + e-mail) que recebem o informativo de
// cada base/instalação. Persistido em data/responsaveis.json para
// sobreviver a reinícios do servidor, sem depender de banco de dados.
const fs = require("fs");
const path = require("path");
const { CIDADES } = require("./cities");

const ARQUIVO = path.join(__dirname, "..", "..", "data", "responsaveis.json");
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function carregarTodos() {
  try {
    const bruto = fs.readFileSync(ARQUIVO, "utf-8");
    const dados = JSON.parse(bruto);
    return dados && typeof dados === "object" ? dados : {};
  } catch (erro) {
    if (erro.code === "ENOENT") return {};
    throw new Error(`Falha ao ler data/responsaveis.json: ${erro.message}`);
  }
}

function salvarTodos(dados) {
  fs.mkdirSync(path.dirname(ARQUIVO), { recursive: true });
  fs.writeFileSync(ARQUIVO, JSON.stringify(dados, null, 2), "utf-8");
}

function validarCidade(chave) {
  if (!CIDADES[chave]) {
    throw new Error(
      `Base "${chave}" não cadastrada em src/config/cities.js. Bases disponíveis: ${Object.keys(CIDADES).join(", ")}`
    );
  }
}

function listarPorCidade(chave) {
  validarCidade(chave);
  const dados = carregarTodos();
  return dados[chave] || [];
}

function listarTodos() {
  const dados = carregarTodos();
  return Object.keys(CIDADES).map((chave) => ({
    chave,
    nome: CIDADES[chave].nome,
    uf: CIDADES[chave].uf,
    responsaveis: dados[chave] || [],
  }));
}

function adicionar(chave, nome, email) {
  validarCidade(chave);
  const nomeLimpo = (nome || "").trim();
  const emailLimpo = (email || "").trim().toLowerCase();

  if (!nomeLimpo) throw new Error("Informe o nome do responsável.");
  if (!EMAIL_REGEX.test(emailLimpo)) throw new Error(`E-mail inválido: "${email}".`);

  const dados = carregarTodos();
  const lista = dados[chave] || [];

  if (lista.some((r) => r.email.toLowerCase() === emailLimpo)) {
    throw new Error(`O e-mail "${emailLimpo}" já está cadastrado para esta base.`);
  }

  lista.push({ nome: nomeLimpo, email: emailLimpo });
  dados[chave] = lista;
  salvarTodos(dados);
  return lista;
}

function remover(chave, email) {
  validarCidade(chave);
  const emailLimpo = (email || "").trim().toLowerCase();
  const dados = carregarTodos();
  const lista = dados[chave] || [];
  const novaLista = lista.filter((r) => r.email.toLowerCase() !== emailLimpo);

  if (novaLista.length === lista.length) {
    throw new Error(`E-mail "${emailLimpo}" não encontrado nos responsáveis desta base.`);
  }

  dados[chave] = novaLista;
  salvarTodos(dados);
  return novaLista;
}

module.exports = { listarPorCidade, listarTodos, adicionar, remover };
