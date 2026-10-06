const { renderAlertEmailHtml, assuntoAlerta } = require("../render/alertEmailTemplate");
const { listaDestinatarios } = require("./sendReport");
const { criarTransportador, enderecoRemetente } = require("./transport");
const { anexosLogosEmail } = require("../config/headerAssets");

/**
 * Envia um alerta para os responsáveis da base afetada.
 *
 * Sem PDF anexo, por decisão: alerta é para ser lido no celular em segundos.
 * Gerar o PDF levaria ~7s por base e atrasaria justamente o que precisa ser
 * rápido — o relatório completo já foi enviado de manhã. Seguem apenas as
 * logos do cabeçalho, inline por Content-ID.
 */
/**
 * @param {object} [opcoes]
 * @param {boolean} [opcoes.teste=false] assunto marcado como [TESTE].
 */
async function enviarAlertaPorEmail(base, { teste = false } = {}) {
  const destinatarios = listaDestinatarios(base.chave);
  if (destinatarios.length === 0) {
    throw new Error(
      `Nenhum destinatário cadastrado para "${base.cidade.nome}" — alerta não enviado.`
    );
  }

  const transportador = criarTransportador();
  const html = renderAlertEmailHtml(base);
  const info = await transportador.sendMail({
    // Nome distinto do boletim diário: ajuda a identificar na caixa de
    // entrada que não é a mensagem de rotina.
    from: `"Alerta CIM" <${enderecoRemetente().email}>`,
    to: destinatarios.join(", "),
    subject: `${teste ? "[TESTE] " : ""}${assuntoAlerta(base)}`,
    html,
    attachments: anexosLogosEmail(html),
    // Prioridade alta: alguns clientes destacam a mensagem na lista.
    priority: "high",
  });

  return { messageId: info.messageId, destinatarios };
}

module.exports = { enviarAlertaPorEmail };
