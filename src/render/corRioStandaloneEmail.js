const { renderEmailHeader, renderEmailHeaderStyles } = require("./emailComponents");
const { cartaoCorRioEmail } = require("./corRioEmail");
const { faixaSimulacaoEmail } = require("./simulationBanner");

function renderCorRioStandaloneEmail(r) {
  return `<!doctype html>
<html lang="pt-BR">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only">${renderEmailHeaderStyles()}</head>
<body bgcolor="#FFFFFF" style="margin:0;padding:0;background:#FFFFFF;color:#222222;font-family:Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#FFFFFF" style="width:100%;background:#FFFFFF;">
    <tr><td align="center" style="padding:8px 6px;">
      <table class="cim-email-shell" role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#FFFFFF" style="width:100%;max-width:850px;background:#FFFFFF;border:1px solid #D5DBD8;">
        ${faixaSimulacaoEmail(r)}
        ${renderEmailHeader({
          titulo: "AVISO COR-RIO",
          contexto: `COR-RIO — RJ — ${r.dataFormatadaLonga}`,
        })}
        <tr><td style="padding:14px 20px 0;color:#222222;font:14px/1.45 Arial,sans-serif;">
          Distribuição exclusiva do aviso oficial do COR-Rio para os destinatários vinculados à base COR-RIO.
        </td></tr>
        <tr><td style="padding:0 20px 14px;">${cartaoCorRioEmail(r)}</td></tr>
        <tr><td bgcolor="#FFCC00" style="height:3px;background:#FFCC00;font-size:0;line-height:3px;">&nbsp;</td></tr>
        <tr><td align="center" style="padding:9px 20px 11px;color:#5F6B66;text-align:center;font:12px/1.35 Arial,sans-serif;">
          Conteúdo oficial consultado no COR-Rio e distribuído pelo Centro Integrado de Monitoramento — COMPARTILHADO.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

module.exports = { renderCorRioStandaloneEmail };
