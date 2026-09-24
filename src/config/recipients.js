// Cadastro dos responsáveis (nome + e-mail) que recebem o informativo de
// cada base/instalação. Persistido em data/responsaveis.json para
// sobreviver a reinícios do servidor, sem depender de banco de dados.
const fs = require("fs");
const path = require("path");
const { CIDADES } = require("./cities");

const ARQUIVO = path.join(__dirname, "..", "..", "data", "responsaveis.json");

// Limites de entrada (V-01). Nome: até 100 caracteres, sem < > " ' nem
// caracteres de controle. E-mail: até 254 caracteres, parte local até 64,
// domínio com rótulos válidos e TLD alfabético; sem espaços, < > " ' , .
const NOME_MAX = 100;
const EMAIL_MAX = 254;
const NOME_PROIBIDO = /[<>"'\u0000-\u001f\u007f]/;
const EMAIL_REGEX =
  /^[a-z0-9!#$%&*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

function erroEntrada(mensagem) {
  // status/publico: a rota pode devolver esta mensagem ao cliente sem expor
  // detalhes internos (só mensagens fixas, nunca o valor recebido).
  return Object.assign(new Error(mensagem), { status: 400, publico: true });
}

function validarNome(nome) {
  if (typeof nome !== "string") throw erroEntrada("Informe o nome do responsável.");
  const limpo = nome.trim().replace(/\s+/g, " ");
  if (!limpo) throw erroEntrada("Informe o nome do responsável.");
  if (limpo.length > NOME_MAX) throw erroEntrada(`O nome deve ter no máximo ${NOME_MAX} caracteres.`);
  if (NOME_PROIBIDO.test(limpo)) throw erroEntrada('O nome não pode conter os caracteres < > " \'.');
  return limpo;
}

function validarEmail(email) {
  if (typeof email !== "string") throw erroEntrada("E-mail inválido.");
  const limpo = email.trim().toLowerCase();
  if (
    !limpo ||
    limpo.length > EMAIL_MAX ||
    limpo.split("@")[0].length > 64 ||
    !EMAIL_REGEX.test(limpo)
  ) {
    throw erroEntrada("E-mail inválido.");
  }
  return limpo;
}

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
  const nomeLimpo = validarNome(nome);
  const emailLimpo = validarEmail(email);

  const dados = carregarTodos();
  const lista = Array.isArray(dados[chave]) ? dados[chave] : [];

  if (lista.some((r) => String(r?.email || "").toLowerCase() === emailLimpo)) {
    throw erroEntrada("Este e-mail já está cadastrado para esta base.");
  }

  lista.push({ nome: nomeLimpo, email: emailLimpo });
  dados[chave] = lista;
  salvarTodos(dados);
  return lista;
}

function remover(chave, email) {
  validarCidade(chave);
  // Remoção aceita qualquer e-mail já gravado (inclusive cadastros antigos,
  // anteriores à validação estrita), só limitando tipo e tamanho.
  if (typeof email !== "string" || !email.trim() || email.length > EMAIL_MAX) {
    throw erroEntrada("E-mail inválido.");
  }
  const emailLimpo = email.trim().toLowerCase();
  const dados = carregarTodos();
  const lista = Array.isArray(dados[chave]) ? dados[chave] : [];
  const novaLista = lista.filter((r) => String(r?.email || "").toLowerCase() !== emailLimpo);

  if (novaLista.length === lista.length) {
    throw erroEntrada("E-mail não encontrado nos responsáveis desta base.");
  }

  dados[chave] = novaLista;
  salvarTodos(dados);
  return novaLista;
}

module.exports = { listarPorCidade, listarTodos, adicionar, remover, validarNome, validarEmail };
