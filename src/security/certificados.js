// Node usa apenas o pacote próprio de CAs por padrão. Em redes corporativas,
// um proxy TLS pode assinar as conexões com uma CA instalada no Windows; sem
// incluir o repositório do sistema, todas as APIs HTTPS falham com
// UNABLE_TO_VERIFY_LEAF_SIGNATURE. Mantemos a validação TLS ligada e apenas
// acrescentamos as autoridades já confiadas pelo sistema operacional.
const tls = require("node:tls");
const dns = require("node:dns");

let configurado = false;

function preferirIpv4NoWindows() {
  if (process.platform !== "win32") return false;
  dns.setDefaultResultOrder("ipv4first");
  return true;
}

function configurarCertificadosDoSistema() {
  if (configurado || process.platform !== "win32") return false;
  if (typeof tls.getCACertificates !== "function" || typeof tls.setDefaultCACertificates !== "function") {
    return false;
  }

  const certificados = [
    ...tls.getCACertificates("default"),
    ...tls.getCACertificates("system"),
  ];
  tls.setDefaultCACertificates([...new Set(certificados)]);
  configurado = true;
  return true;
}

preferirIpv4NoWindows();
configurarCertificadosDoSistema();

module.exports = { configurarCertificadosDoSistema, preferirIpv4NoWindows };
