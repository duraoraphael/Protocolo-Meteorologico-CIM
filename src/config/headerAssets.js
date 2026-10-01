// Identidade do cabeçalho institucional compartilhada por e-mails e PDFs.
//
// As imagens em src/assets/header/ são derivadas de Logo/Logo_PDF.png e
// Logo/petrobras.png por scripts/gerarLogosHeader.js: o fundo verde de cada
// logo foi trocado exatamente por HEADER_VERDE (o verde original do
// petrobras.png), então elas se integram ao header sem caixa ou contorno.
const fs = require("fs");
const path = require("path");

const HEADER_VERDE = "#047C3E";
const HEADER_AMARELO = "#FFCC00";

const PASTA = path.join(__dirname, "..", "assets", "header");

const LOGOS_HEADER = Object.freeze({
  cim: Object.freeze({ arquivo: "cim-header.png", cid: "logo-cim-header@cim", alt: "CIM — Centro Integrado de Monitoramento COMPARTILHADO" }),
  petrobras: Object.freeze({ arquivo: "petrobras-header.png", cid: "logo-petrobras-header@cim", alt: "Petrobras" }),
});

function caminhoLogoHeader(nome) {
  const logo = LOGOS_HEADER[nome];
  if (!logo) return null;
  const caminho = path.join(PASTA, logo.arquivo);
  return fs.existsSync(caminho) ? caminho : null;
}

// PDF: o Chromium roda sem rede (V-12), então a imagem vai como data URI.
function logoHeaderDataUri(nome) {
  const caminho = caminhoLogoHeader(nome);
  if (!caminho) return null;
  return `data:image/png;base64,${fs.readFileSync(caminho).toString("base64")}`;
}

// E-mail: as logos seguem como anexos inline (Content-ID) e o HTML as
// referencia por "cid:" — sem data URI (bloqueado pelo Gmail/Outlook) e sem
// URL de servidor local.
function srcLogoEmail(nome) {
  return caminhoLogoHeader(nome) ? `cid:${LOGOS_HEADER[nome].cid}` : null;
}

function anexosLogosEmail(html) {
  return Object.keys(LOGOS_HEADER)
    .filter((nome) => !html || html.includes(`cid:${LOGOS_HEADER[nome].cid}`))
    .map((nome) => ({ nome, caminho: caminhoLogoHeader(nome) }))
    .filter(({ caminho }) => caminho)
    .map(({ nome, caminho }) => ({
      filename: LOGOS_HEADER[nome].arquivo,
      path: caminho,
      cid: LOGOS_HEADER[nome].cid,
      contentType: "image/png",
      contentDisposition: "inline",
    }));
}

// Prévia local (navegador) do e-mail: troca as referências cid: pelos
// próprios arquivos embutidos, só para visualização.
function emailComLogosEmbutidas(html) {
  let resultado = html;
  for (const nome of Object.keys(LOGOS_HEADER)) {
    const uri = logoHeaderDataUri(nome);
    if (uri) resultado = resultado.split(`cid:${LOGOS_HEADER[nome].cid}`).join(uri);
  }
  return resultado;
}

module.exports = {
  HEADER_AMARELO,
  HEADER_VERDE,
  LOGOS_HEADER,
  anexosLogosEmail,
  caminhoLogoHeader,
  emailComLogosEmbutidas,
  logoHeaderDataUri,
  srcLogoEmail,
};
