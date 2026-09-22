#!/usr/bin/env node
// Valida a configuração de e-mail.
//
// Uso:
//   node src/cliTestarEmail.js                 -> só testa a conexão, não envia
//   node src/cliTestarEmail.js --enviar-para=a@b.com
//                                              -> envia uma mensagem de teste
//
// Feito para rodar no servidor Petrobras logo após configurar o .env, antes
// de depender do primeiro envio agendado para descobrir que algo está errado.

require("dotenv").config({ quiet: true });
const { verificarConexao, descreverCanal, enderecoRemetente, criarTransportador } = require("./email/transport");

function argumento(nome) {
  const p = process.argv.find((a) => a.startsWith(`--${nome}=`));
  return p ? p.split("=")[1] : null;
}

(async () => {
  console.log("[CIM] Canal configurado:", descreverCanal());

  try {
    console.log("[CIM] Remetente:", enderecoRemetente().email);
  } catch (erro) {
    console.error("[CIM] ERRO:", erro.message);
    process.exitCode = 1;
    return;
  }

  console.log("[CIM] Testando conexão com o servidor...");
  try {
    await verificarConexao();
    console.log("[CIM] Conexão OK — o servidor aceitou a sessão SMTP.");
  } catch (erro) {
    console.error("[CIM] FALHA na conexão:", erro.message);
    console.error("");
    console.error("Causas comuns:");
    console.error("  · Servidor/porta incorretos ou bloqueados por firewall");
    console.error("  · Relay que só aceita conexões de IPs autorizados (rodar do servidor correto)");
    console.error("  · STARTTLS exigido ou indisponível — tente SMTP_IGNORAR_TLS=true");
    process.exitCode = 1;
    return;
  }

  const destino = argumento("enviar-para");
  if (!destino) {
    console.log("");
    console.log("Nenhuma mensagem enviada. Para testar o envio de verdade:");
    console.log("  node src/cliTestarEmail.js --enviar-para=seu.email@petrobras.com.br");
    return;
  }

  console.log(`[CIM] Enviando mensagem de teste para ${destino}...`);
  try {
    const transportador = criarTransportador();
    const info = await transportador.sendMail({
      from: enderecoRemetente().formatado,
      to: destino,
      subject: "Teste de configuração — Protocolo Meteorológico CIM",
      text:
        "Esta é uma mensagem de teste do Protocolo Meteorológico CIM.\n\n" +
        `Canal: ${descreverCanal()}\n` +
        `Remetente: ${enderecoRemetente().email}\n` +
        `Enviada em: ${new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}\n\n` +
        "Se você recebeu esta mensagem, o envio de e-mail está funcionando.",
    });
    console.log("[CIM] Enviado. ID da mensagem:", info.messageId);
  } catch (erro) {
    console.error("[CIM] FALHA no envio:", erro.message);
    process.exitCode = 1;
  }
})();
