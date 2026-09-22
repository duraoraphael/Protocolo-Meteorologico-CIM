const { criarTransportador, enderecoRemetente } = require("./transport");
const { listarTodos } = require("../config/recipients");

/**
 * Destinatários do relatório SEMANAL.
 *
 * Diferente do informativo diário, que vai por base para os responsáveis
 * daquela instalação, o semanal é um documento consolidado das 12 bases —
 * um só e-mail. Por isso a lista é a UNIÃO dos responsáveis de todas as
 * bases, sem repetir quem aparece em mais de uma.
 *
 * Alternativa possível (não adotada): enviar 12 e-mails, um por base, com o
 * recorte de cada uma. Ficaria redundante, já que o valor do relatório é
 * justamente comparar as bases entre si.
 */
function listaDestinatariosSemanal() {
  const vistos = new Set();

  for (const base of listarTodos()) {
    for (const r of base.responsaveis || []) {
      const email = (r.email || "").trim().toLowerCase();
      if (email) vistos.add(email);
    }
  }

  if (vistos.size === 0) {
    const reserva =
      process.env.REPORT_RECIPIENTS ||
      process.env.EMAIL_REMETENTE ||
      process.env.GMAIL_USER ||
      "";
    reserva
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean)
      .forEach((e) => vistos.add(e));
  }

  return [...vistos];
}

async function enviarRelatorioSemanalPorEmail(relatorio, pdfBuffer, emailHtml) {
  const destinatarios = listaDestinatariosSemanal();
  if (destinatarios.length === 0) {
    throw new Error(
      "Nenhum destinatário para o relatório semanal. Cadastre responsáveis no painel ou configure REPORT_RECIPIENTS no .env."
    );
  }

  const transportador = criarTransportador();

  const info = await transportador.sendMail({
    from: `"Relatório Semanal CIM" <${enderecoRemetente().email}>`,
    to: destinatarios.join(", "),
    subject: `Relatório Meteorológico Semanal — CIM — ${relatorio.periodoLabel}`,
    html: emailHtml,
    attachments: [
      {
        filename: `${relatorio.nomeArquivoBase}.pdf`,
        content: pdfBuffer,
        contentType: "application/pdf",
      },
    ],
  });

  return { messageId: info.messageId, destinatarios };
}

module.exports = { enviarRelatorioSemanalPorEmail, listaDestinatariosSemanal };
