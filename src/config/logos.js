// Logos (Petrobras + CIM) usados no painel e no PDF. Ficam em Logo/, na raiz
// do projeto — fora de public/ e do controle de versão (não são código).
// Não fixamos o nome exato do arquivo: procuramos por "petrobras"/"cim" no
// nome, então trocar a imagem (mesmo com outro nome) continua funcionando
// sem precisar mexer em código.
const fs = require("fs");
const path = require("path");

const PASTA_LOGO = path.join(__dirname, "..", "..", "Logo");

const EXTENSOES_IMAGEM = [".png", ".jpg", ".jpeg", ".svg", ".webp"];

function listarArquivosLogo() {
  try {
    return fs
      .readdirSync(PASTA_LOGO)
      .filter((nome) => EXTENSOES_IMAGEM.includes(path.extname(nome).toLowerCase()));
  } catch (erro) {
    if (erro.code === "ENOENT") return [];
    throw erro;
  }
}

function encontrarArquivo(padrao) {
  const arquivos = listarArquivosLogo();
  return arquivos.find((nome) => padrao.test(nome)) || null;
}

function arquivosLogos() {
  return {
    petrobras: encontrarArquivo(/petrobras/i),
    cim: encontrarArquivo(/\bcim\b|centro.?integrado/i),
  };
}

function extParaMime(ext) {
  const e = ext.toLowerCase();
  if (e === ".png") return "image/png";
  if (e === ".jpg" || e === ".jpeg") return "image/jpeg";
  if (e === ".svg") return "image/svg+xml";
  if (e === ".webp") return "image/webp";
  return "application/octet-stream";
}

function comoDataUri(nomeArquivo) {
  if (!nomeArquivo) return null;
  try {
    const buffer = fs.readFileSync(path.join(PASTA_LOGO, nomeArquivo));
    return `data:${extParaMime(path.extname(nomeArquivo))};base64,${buffer.toString("base64")}`;
  } catch (erro) {
    return null;
  }
}

// Para uso no PDF (Puppeteer não tem servidor por trás do HTML gerado, então
// as imagens precisam ir embutidas como data URI, não como caminho de arquivo).
function logosComoDataUri() {
  const { petrobras, cim } = arquivosLogos();
  return { petrobras: comoDataUri(petrobras), cim: comoDataUri(cim) };
}

module.exports = { PASTA_LOGO, arquivosLogos, logosComoDataUri };
