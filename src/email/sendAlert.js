const { renderAlertEmailHtml, assuntoAlerta } = require("../render/alertEmailTemplate");
const { listaDestinatarios } = require("./sendReport");
const { criarTransportador, enderecoRemetente } = require("./transport");

/**
 * Envia um alerta para os responsáveis da base afetada.
 *
 * Sem anexo, por decisão: alerta é para ser lido no celular em segundos.
 * Gerar o PDF levaria ~7s por base e atrasaria justamente o que precisa ser
 * rápido — o relatório completo já foi enviado de manhã.
 */
async function enviarAlertaPorEmail(base) {
  const destinatarios = listaDestinatarios(base.chave);
  if (destinatarios.length === 0) {
    throw new Error(
      `Nenhum destinatário cadastrado para "${base.cidade.nome}" — alerta não enviado.`
    );
  }

  const transportador = criarTransportador();
  const info = await transportador.sendMail({
    // Nome distinto do boletim diário: ajuda a identificar na caixa de
    // entrada que não é a mensagem de rotina.
    from: `"Alerta CIM" <${enderecoRemetente().email}>`,
    to: destinatarios.join(", "),
    subject: assuntoAlerta(base),
    html: renderAlertEmailHtml(base),
    // Prioridade alta: alguns clientes destacam a mensagem na lista.
    priority: "high",
  });

  return { messageId: info.messageId, destinatarios };
}

module.exports = { enviarAlertaPorEmail };
