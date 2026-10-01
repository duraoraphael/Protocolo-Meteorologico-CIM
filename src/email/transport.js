// Ponto único de configuração do envio de e-mail.
//
// Antes havia dois transportadores criados em arquivos diferentes, ambos
// fixos no Gmail — mudar de servidor exigia editar os dois. Agora existe um
// só lugar, e o modo é escolhido pela presença da configuração:
//
//   SMTP_HOST definido  -> relay corporativo (produção)
//   senão, GMAIL_USER   -> Gmail com senha de app (desenvolvimento)
//
// Não há variável de "modo" para não existir o estado incoerente de pedir
// modo corporativo sem informar o servidor.

const nodemailer = require("nodemailer");
const tls = require("node:tls");
require("../security/certificados");

let avisoTlsEmitido = false;

/**
 * Validação do certificado TLS do relay (V-11). Sempre ligada, a não ser que
 * SMTP_TLS_INSEGURO=true — válvula de escape temporária, com aviso no log.
 * O caminho correto para CA interna é NODE_EXTRA_CA_CERTS (ver
 * INSTALACAO_SERVIDOR_PETROBRAS.md).
 */
function opcoesTlsRelay() {
  const inseguro = process.env.SMTP_TLS_INSEGURO === "true";
  if (inseguro && !avisoTlsEmitido) {
    avisoTlsEmitido = true;
    console.warn(
      "[CIM] AVISO DE SEGURANÇA: SMTP_TLS_INSEGURO=true — o certificado do relay SMTP NÃO está sendo validado. " +
        "Instale a CA interna via NODE_EXTRA_CA_CERTS e remova essa variável."
    );
  }
  if (process.env.SMTP_IGNORAR_TLS === "true" && !avisoTlsEmitido) {
    avisoTlsEmitido = true;
    console.warn("[CIM] AVISO DE SEGURANÇA: SMTP_IGNORAR_TLS=true — os e-mails trafegam sem criptografia até o relay.");
  }
  return { rejectUnauthorized: !inseguro };
}

function usandoRelayCorporativo() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_HOST.trim());
}

function envioEmailAtivo() {
  return process.env.ENVIO_EMAIL_ATIVO !== "false";
}

/**
 * Endereço que aparece como remetente.
 * No relay corporativo o remetente é uma conta de serviço e precisa ser
 * exatamente a autorizada — por isso vem de EMAIL_REMETENTE, não do usuário.
 */
function enderecoRemetente() {
  const email =
    (process.env.EMAIL_REMETENTE && process.env.EMAIL_REMETENTE.trim()) ||
    process.env.GMAIL_USER;

  if (!email) {
    throw new Error(
      "Remetente não configurado. Defina EMAIL_REMETENTE (relay corporativo) ou GMAIL_USER (Gmail) no .env."
    );
  }

  const nome = process.env.EMAIL_NOME_REMETENTE || "Protocolo Meteorológico CIM";
  return { email, formatado: `"${nome}" <${email}>` };
}

function criarTransportador() {
  if (!envioEmailAtivo()) {
    const erro = new Error(
      "Envio de e-mails temporariamente desativado por ENVIO_EMAIL_ATIVO=false."
    );
    erro.code = "EMAIL_SEND_DISABLED";
    throw erro;
  }

  if (usandoRelayCorporativo()) {
    const porta = parseInt(process.env.SMTP_PORTA || "25", 10);

    return nodemailer.createTransport({
      host: process.env.SMTP_HOST.trim(),
      port: Number.isNaN(porta) ? 25 : porta,
      // Porta 25 em relay interno é SMTP simples: a autorização é por IP de
      // origem, não por usuário e senha. Passar um objeto `auth` vazio faria
      // o nodemailer tentar autenticar e o servidor recusar.
      secure: false,
      auth: undefined,
      // Certificado do relay SEMPRE validado (V-11). Relays internos usam
      // certificado da CA corporativa: aponte NODE_EXTRA_CA_CERTS para o
      // arquivo .pem/.crt dessa CA. SMTP_TLS_INSEGURO=true desliga a
      // validação (só como paliativo temporário; gera aviso no log).
      tls: opcoesTlsRelay(),
      // Se o relay não suportar STARTTLS, SMTP_IGNORAR_TLS=true desliga a
      // tentativa em vez de deixar a conexão falhar (sem criptografia — gera
      // aviso no log; evite).
      ignoreTLS: process.env.SMTP_IGNORAR_TLS === "true",
      connectionTimeout: 20000,
      greetingTimeout: 15000,
    });
  }

  const usuario = process.env.GMAIL_USER;
  // O Google exibe senhas de app em quatro grupos separados por espaços.
  // Esses espaços são apenas visuais e não fazem parte da credencial.
  const senha = process.env.GMAIL_APP_PASSWORD?.replace(/\s+/g, "");
  if (!usuario || !senha) {
    throw new Error(
      "Envio de e-mail não configurado. Defina SMTP_HOST (relay corporativo) " +
        "ou GMAIL_USER + GMAIL_APP_PASSWORD (Gmail) no .env."
    );
  }

  return nodemailer.createTransport({
    host: "smtp.gmail.com",
    // STARTTLS (587) é preferido aqui ao SMTPS/465. Alguns antivírus
    // corporativos interceptam a porta 465 com uma cadeia deliberadamente
    // não confiável, enquanto 587 apresenta a CA instalada no Windows.
    port: 587,
    secure: false,
    requireTLS: true,
    auth: { user: usuario, pass: senha },
    tls: {
      rejectUnauthorized: true,
      ca:
        process.platform === "win32" && typeof tls.getCACertificates === "function"
          ? tls.getCACertificates("default")
          : undefined,
    },
  });
}

/** Descrição do canal em uso, para aparecer nos logs de envio. */
function descreverCanal() {
  if (usandoRelayCorporativo()) {
    return `relay corporativo ${process.env.SMTP_HOST}:${process.env.SMTP_PORTA || 25}`;
  }
  return `Gmail (${process.env.GMAIL_USER})`;
}

/**
 * Testa a conexão com o servidor sem enviar mensagem. Útil para validar a
 * configuração no servidor antes de depender do primeiro envio agendado.
 */
async function verificarConexao() {
  const transportador = criarTransportador();
  await transportador.verify();
  return { ok: true, canal: descreverCanal(), remetente: enderecoRemetente().email };
}

module.exports = {
  criarTransportador,
  enderecoRemetente,
  descreverCanal,
  verificarConexao,
  usandoRelayCorporativo,
  envioEmailAtivo,
};
