// Cadastro dos responsáveis (nome + e-mail) que recebem o informativo de
// cada base/instalação. Persistido em data/responsaveis.json para
// sobreviver a reinícios do servidor, sem depender de banco de dados.
const fs = require("fs");
const path = require("path");
const { CIDADES, baseExiste, erroBaseInvalida } = require("./cities");

const ARQUIVO = process.env.RESPONSAVEIS_ARQUIVO || path.join(__dirname, "..", "..", "data", "responsaveis.json");

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
    if (dados?.versao === 2 && Array.isArray(dados.responsaveis)) {
      return {
        versao: 2,
        responsaveis: dados.responsaveis
          .filter((r) => r && typeof r === "object")
          .map((r) => ({
            nome: r.nome,
            email: r.email,
            bases: Array.isArray(r.bases) ? [...new Set(r.bases.filter(baseExiste))] : [],
          })),
      };
    }

    // Migração transparente do formato antigo { cidade: [{ nome, email }] }.
    // O arquivo só é regravado no próximo cadastro/vínculo, evitando uma
    // alteração em disco apenas por abrir o painel.
    const porEmail = new Map();
    if (dados && typeof dados === "object") {
      for (const chave of Object.keys(CIDADES)) {
        for (const pessoa of Array.isArray(dados[chave]) ? dados[chave] : []) {
          const email = String(pessoa?.email || "").trim().toLowerCase();
          if (!email) continue;
          const atual = porEmail.get(email) || { nome: pessoa?.nome, email, bases: [] };
          if (!atual.bases.includes(chave)) atual.bases.push(chave);
          porEmail.set(email, atual);
        }
      }
    }
    return { versao: 2, responsaveis: [...porEmail.values()] };
  } catch (erro) {
    if (erro.code === "ENOENT") return { versao: 2, responsaveis: [] };
    throw new Error(`Falha ao ler data/responsaveis.json: ${erro.message}`);
  }
}

function salvarTodos(dados) {
  fs.mkdirSync(path.dirname(ARQUIVO), { recursive: true });
  fs.writeFileSync(ARQUIVO, JSON.stringify(dados, null, 2), "utf-8");
}

// V-10: só string ^[a-z_]{2,40}$ que seja chave própria de CIDADES.
function validarCidade(chave) {
  if (!baseExiste(chave)) throw erroBaseInvalida();
}

function listarPorCidade(chave) {
  validarCidade(chave);
  const dados = carregarTodos();
  return dados.responsaveis
    .filter((r) => r.bases.includes(chave))
    .map(({ nome, email }) => ({ nome, email }));
}

function listarTodos() {
  const dados = carregarTodos();
  return Object.keys(CIDADES).map((chave) => ({
    chave,
    nome: CIDADES[chave].nome,
    uf: CIDADES[chave].uf,
    responsaveis: dados.responsaveis
      .filter((r) => r.bases.includes(chave))
      .map(({ nome, email }) => ({ nome, email })),
  }));
}

function listarResponsaveis() {
  return carregarTodos().responsaveis.map((r) => ({ ...r, bases: [...r.bases] }));
}

function validarBases(bases) {
  if (!Array.isArray(bases)) throw erroEntrada("Selecione as bases do responsável.");
  const unicas = [...new Set(bases)];
  for (const chave of unicas) validarCidade(chave);
  return unicas;
}

function cadastrarResponsavel(nome, email) {
  const nomeLimpo = validarNome(nome);
  const emailLimpo = validarEmail(email);
  const dados = carregarTodos();
  if (dados.responsaveis.some((r) => String(r.email).toLowerCase() === emailLimpo)) {
    throw erroEntrada("Este e-mail já está cadastrado.");
  }
  const pessoa = { nome: nomeLimpo, email: emailLimpo, bases: [] };
  dados.responsaveis.push(pessoa);
  salvarTodos(dados);
  return { ...pessoa, bases: [] };
}

function atualizarBases(email, bases) {
  const emailLimpo = validarEmail(email);
  const basesLimpas = validarBases(bases);
  const dados = carregarTodos();
  const pessoa = dados.responsaveis.find((r) => String(r.email).toLowerCase() === emailLimpo);
  if (!pessoa) throw erroEntrada("Responsável não encontrado.");
  pessoa.bases = basesLimpas;
  salvarTodos(dados);
  return { ...pessoa, bases: [...pessoa.bases] };
}

function removerResponsavel(email) {
  const emailLimpo = validarEmail(email);
  const dados = carregarTodos();
  const restante = dados.responsaveis.filter((r) => String(r.email).toLowerCase() !== emailLimpo);
  if (restante.length === dados.responsaveis.length) throw erroEntrada("Responsável não encontrado.");
  dados.responsaveis = restante;
  salvarTodos(dados);
  return listarResponsaveis();
}

function adicionar(chave, nome, email) {
  validarCidade(chave);
  const nomeLimpo = validarNome(nome);
  const emailLimpo = validarEmail(email);

  const dados = carregarTodos();
  let pessoa = dados.responsaveis.find((r) => String(r.email).toLowerCase() === emailLimpo);
  if (pessoa?.bases.includes(chave)) {
    throw erroEntrada("Este e-mail já está cadastrado para esta base.");
  }
  if (!pessoa) {
    pessoa = { nome: nomeLimpo, email: emailLimpo, bases: [] };
    dados.responsaveis.push(pessoa);
  }
  pessoa.bases.push(chave);
  salvarTodos(dados);
  return listarPorCidade(chave);
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
  const pessoa = dados.responsaveis.find((r) => String(r.email).toLowerCase() === emailLimpo);
  if (!pessoa || !pessoa.bases.includes(chave)) {
    throw erroEntrada("E-mail não encontrado nos responsáveis desta base.");
  }
  pessoa.bases = pessoa.bases.filter((base) => base !== chave);
  salvarTodos(dados);
  return listarPorCidade(chave);
}

module.exports = {
  listarPorCidade,
  listarTodos,
  listarResponsaveis,
  cadastrarResponsavel,
  atualizarBases,
  removerResponsavel,
  adicionar,
  remover,
  validarNome,
  validarEmail,
  validarCidade,
};
