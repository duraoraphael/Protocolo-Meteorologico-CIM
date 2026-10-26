const { renderEmailHtml } = require("../render/emailTemplate");
const { renderCorRioStandaloneEmail } = require("../render/corRioStandaloneEmail");
const { listarPorCidade, validarEmail } = require("../config/recipients");
const { BASE_COR_RIO } = require("../config/distributionBases");
const { criarTransportador, enderecoRemetente } = require("./transport");
const { anexosLogosEmail } = require("../config/headerAssets");
const { validarDocumentoOperacional } = require("../logic/documentProvenance");

// Prioriza os responsáveis cadastrados para a base (painel > Gerenciar
// responsáveis). Se nenhum estiver cadastrado, cai para REPORT_RECIPIENTS do
// .env — mantém o envio funcionando até que alguém cadastre os responsáveis
// de fato pela base.
function semDuplicacoes(emails) {
  const vistos = new Set();
  return emails.filter((email) => {
    const chave = email.toLowerCase();
    if (vistos.has(chave)) return false;
    vistos.add(chave);
    return true;
  });
}

function listaDestinatarios(cidadeChave, { permitirFallback = true } = {}) {
  if (cidadeChave) {
    const cadastrados = semDuplicacoes(listarPorCidade(cidadeChave).map((r) => r.email));
    if (cadastrados.length > 0) return cadastrados;
  }

  if (!permitirFallback) return [];

  const raw =
    process.env.REPORT_RECIPIENTS ||
    process.env.EMAIL_REMETENTE ||
    process.env.GMAIL_USER ||
    "";
  return semDuplicacoes(raw
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean));
}

async function enviarRelatorioPorEmail(report, pdfBuffer, {
  destinatariosOverride = null,
  permitirOverrideDestinatarios = false,
} = {}) {
  validarDocumentoOperacional(report, "envio de e-mail", { exigirCamposCriticos: true });
  let destinatarios;
  if (destinatariosOverride !== null) {
    if (!report.envioTeste && !permitirOverrideDestinatarios) {
      throw new Error("Destinatário avulso permitido somente em envio de teste ou autorizado explicitamente.");
    }
    if (!Array.isArray(destinatariosOverride)) {
      throw new Error("A lista de destinatários de teste é inválida.");
    }
    destinatarios = semDuplicacoes(destinatariosOverride.map(validarEmail));
  } else {
    destinatarios = listaDestinatarios(report.cidade?.chave);
  }
  if (destinatarios.length === 0) {
    throw new Error(
      `Nenhum destinatário cadastrado para "${report.cidade?.nome || "esta base"}". Cadastre um responsável no painel ou configure REPORT_RECIPIENTS no .env.`
    );
  }

  const transportador = criarTransportador();
  const prefixoTeste = report.envioTeste ? `[TESTE${report.horarioAgendado ? ` ${report.horarioAgendado}` : ""}] ` : "";
  const assunto = `${prefixoTeste}Informativo Meteorológico — ${report.cidade.nome} — ${report.dataFormatadaCurta}`;
  // O aviso COR-RIO tem distribuição própria. Destinatários da base
  // meteorológica Rio de Janeiro recebem somente o informativo geral.
  const html = renderEmailHtml(report, { incluirCorRio: false });

  const info = await transportador.sendMail({
    from: enderecoRemetente().formatado,
    to: destinatarios.join(", "),
    subject: assunto,
    html,
    attachments: [
      ...anexosLogosEmail(html),
      {
        filename: `${report.nomeArquivoBase}.pdf`,
        content: pdfBuffer,
        contentType: "application/pdf",
      },
    ],
  });

  return {
    messageId: info.messageId,
    destinatarios,
    respostaSmtp: info.response || null,
    aceitos: Array.isArray(info.accepted) ? info.accepted.length : null,
    rejeitados: Array.isArray(info.rejected) ? info.rejected.length : null,
  };
}

async function enviarAvisoCorRioPorEmail(report) {
  validarDocumentoOperacional(report, "envio do aviso COR-Rio");
  const destinatarios = listaDestinatarios(BASE_COR_RIO, { permitirFallback: false });
  if (destinatarios.length === 0) return null;

  const html = renderCorRioStandaloneEmail(report);
  const prefixoTeste = report.envioTeste ? `[TESTE${report.horarioAgendado ? ` ${report.horarioAgendado}` : ""}] ` : "";
  const info = await criarTransportador().sendMail({
    from: enderecoRemetente().formatado,
    to: destinatarios.join(", "),
    subject: `${prefixoTeste}Aviso COR-RIO — ${report.dataFormatadaCurta}`,
    html,
    attachments: anexosLogosEmail(html),
  });

  return {
    messageId: info.messageId,
    destinatarios,
    respostaSmtp: info.response || null,
    aceitos: Array.isArray(info.accepted) ? info.accepted.length : null,
    rejeitados: Array.isArray(info.rejected) ? info.rejected.length : null,
  };
}

module.exports = { enviarRelatorioPorEmail, enviarAvisoCorRioPorEmail, listaDestinatarios };
