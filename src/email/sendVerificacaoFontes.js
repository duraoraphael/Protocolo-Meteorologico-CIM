// Aviso técnico da verificação preventiva das fontes. Vai só para a equipe
// responsável pelo sistema (EMAIL_ALERTA_FONTES), nunca para os
// destinatários dos informativos.
const { criarTransportador, enderecoRemetente } = require("./transport");
const { esc } = require("../render/emailComponents");
const { ROTULOS, PROBLEMAS } = require("../logic/verificacaoFontes");

const CORES = Object.freeze({
  ok: "#1b7f3b",
  campos_ausentes: "#b26a00",
  formato_alterado: "#b3261e",
  indisponivel: "#b3261e",
  bloqueada: "#b3261e",
  nao_configurada: "#5f6368",
});

function destinatariosVerificacao(env = process.env) {
  return String(env.EMAIL_ALERTA_FONTES || "")
    .split(",")
    .map((e) => e.trim())
    .filter((e) => /^[^\s@<>",]+@[^\s@<>",]+\.[^\s@<>",]+$/.test(e));
}

function renderVerificacaoHtml({ verificadoEm, itens, problemas }) {
  const quando = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short",
  }).format(new Date(verificadoEm));
  // Problemas primeiro; itens OK ficam resumidos para o e-mail não virar lista longa.
  const linhas = [...itens].sort((a, b) => Number(PROBLEMAS.has(b.situacao)) - Number(PROBLEMAS.has(a.situacao)))
    .filter((i) => i.situacao !== "ok")
    .map((i) => `<tr>
      <td style="padding:6px 8px;border-bottom:1px solid #e0e0e0;color:${CORES[i.situacao]};font-weight:bold;white-space:nowrap">${esc(ROTULOS[i.situacao])}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #e0e0e0">${esc(i.fonte)}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #e0e0e0">${esc(i.escopo)}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #e0e0e0">${esc(i.detalhe)}</td>
    </tr>`).join("");
  const totalOk = itens.filter((i) => i.situacao === "ok").length;
  return `<!doctype html><html><body style="font-family:Arial,sans-serif;font-size:14px;color:#202124">
  <h2 style="margin:0 0 8px">Verificação das fontes meteorológicas</h2>
  <p style="margin:0 0 12px">${esc(quando)} (Brasília) — <strong>${problemas.length} problema(s)</strong>, ${totalOk} verificação(ões) OK.</p>
  <p style="margin:0 0 12px">Os informativos continuam sendo gerados; onde a fonte falhou, o sistema usa a última coleta válida ou a fonte reserva, conforme cada caso.</p>
  <table style="border-collapse:collapse;width:100%">
    <tr style="background:#f1f3f4;text-align:left"><th style="padding:6px 8px">Situação</th><th style="padding:6px 8px">Fonte</th><th style="padding:6px 8px">Base</th><th style="padding:6px 8px">Detalhe</th></tr>
    ${linhas}
  </table>
  <p style="margin:12px 0 0;color:#5f6368;font-size:12px">"Formato alterado" indica que a fonte respondeu, mas mudou o layout ou o contrato: o leitor do sistema precisa de ajuste. "Indisponível" indica falha de acesso (rede, DNS, timeout ou erro HTTP).</p>
</body></html>`;
}

async function enviarVerificacaoFontes(resultado, { env = process.env, transportador } = {}) {
  const destinatarios = destinatariosVerificacao(env);
  if (!destinatarios.length) return { enviado: false, motivo: "EMAIL_ALERTA_FONTES não configurado" };
  const html = renderVerificacaoHtml(resultado);
  const info = await (transportador || criarTransportador()).sendMail({
    from: `"Monitor de Fontes CIM" <${enderecoRemetente().email}>`,
    to: destinatarios.join(", "),
    subject: `[CIM] ${resultado.problemas.length} problema(s) nas fontes meteorológicas`,
    html,
  });
  return { enviado: true, destinatarios, messageId: info.messageId };
}

module.exports = { enviarVerificacaoFontes, renderVerificacaoHtml, destinatariosVerificacao };
