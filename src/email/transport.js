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

function usandoRelayCorporativo() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_HOST.trim());
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
      // Relays internos costumam anunciar STARTTLS com certificado emitido
      // por CA interna, que não está na lista de confiança do Node. Sem isso
      // o envio falha com "self signed certificate". Aceitável porque o
      // tráfego não sai da rede corporativa.
      tls: { rejectUnauthorized: false },
      // Se o relay não suportar STARTTLS, SMTP_IGNORAR_TLS=true desliga a
      // tentativa em vez de deixar a conexão falhar.
      ignoreTLS: process.env.SMTP_IGNORAR_TLS === "true",
      connectionTimeout: 20000,
      greetingTimeout: 15000,
    });
  }

  const usuario = process.env.GMAIL_USER;
  const senha = process.env.GMAIL_APP_PASSWORD;
  if (!usuario || !senha) {
    throw new Error(
      "Envio de e-mail não configurado. Defina SMTP_HOST (relay corporativo) " +
        "ou GMAIL_USER + GMAIL_APP_PASSWORD (Gmail) no .env."
    );
  }

  return nodemailer.createTransport({
    service: "gmail",
    auth: { user: usuario, pass: senha },
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
};
