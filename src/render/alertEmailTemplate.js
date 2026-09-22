// E-mail do monitor de alertas.
//
// Deliberadamente DIFERENTE do informativo diário: cabeçalho vermelho em vez
// do verde institucional. Quem recebe precisa distinguir na lista da caixa de
// entrada, sem abrir, que aquilo não é o boletim de rotina — é uma mudança
// que exige decisão agora.
//
// Curto por princípio: um alerta que exige rolagem para ser entendido perde a
// função. O detalhamento fica no painel.

const brand = require("./brand");
const { logosComoDataUri } = require("../config/logos");

const VERMELHO = "#C0392B";
const VERMELHO_ESCURO = "#7B241C";

function esc(valor) {
  if (valor === null || valor === undefined) return "—";
  return String(valor)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function corGravidade(gravidade) {
  return gravidade === "severo" ? VERMELHO_ESCURO : VERMELHO;
}

function blocoAlerta(a) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"
    style="border-left:5px solid ${corGravidade(a.gravidade)};background:#FDF3F2;border-radius:4px;margin-bottom:10px;">
    <tr><td style="padding:12px 16px;font-family:Arial,sans-serif;">
      <div style="font-size:15px;font-weight:bold;color:${VERMELHO_ESCURO};">
        ${esc(a.tipo)}${a.motivo === "agravou" ? ' <span style="font-size:11px;font-weight:normal;background:#7B241C;color:#fff;padding:1px 6px;border-radius:3px;">AGRAVOU</span>' : ""}
      </div>
      ${a.severidadeTexto ? `<div style="font-size:12px;color:${VERMELHO};font-weight:bold;margin-top:2px;">${esc(a.severidadeTexto)}</div>` : ""}
      ${a.detalhe ? `<div style="font-size:13px;color:#333;margin-top:4px;">${esc(a.detalhe)}</div>` : ""}
      <div style="font-size:11.5px;color:#777;margin-top:4px;">
        Janela: ${esc(a.janela)} &nbsp;·&nbsp; Fonte: ${esc(a.origem)}
      </div>
    </td></tr>
  </table>`;
}

/**
 * @param {object} base item de `porBase` retornado por verificarAlertas()
 */
function renderAlertEmailHtml(base) {
  const logos = logosComoDataUri();
  const r = base.report;
  const cidade = base.cidade;

  const temSevero = base.alertas.some((a) => a.gravidade === "severo");

  return `<!doctype html>
<html lang="pt-BR">
<body style="margin:0;padding:0;background:#EEF1EF;font-family:Arial,'Segoe UI',sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#EEF1EF;padding:18px 0;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:6px;overflow:hidden;max-width:600px;">

        <tr><td style="background:${temSevero ? VERMELHO_ESCURO : VERMELHO};padding:16px 22px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
            ${
              logos.cim
                ? `<td width="70" valign="middle"><img src="${logos.cim}" alt="CIM" width="64" style="display:block;width:64px;height:auto;" /></td>`
                : ""
            }
            <td valign="middle">
              <div style="color:#fff;font-size:17px;font-weight:bold;letter-spacing:0.4px;">⚠ ALERTA METEOROLÓGICO</div>
              <div style="color:#FDEDEC;font-size:13px;margin-top:3px;">
                ${esc(cidade.nome)} — ${esc(cidade.uf)} · ${esc(r.dataFormatadaCurta)} às ${esc(r.horaConsulta)}
              </div>
            </td>
          </tr></table>
        </td></tr>
        <tr><td style="height:4px;background:${brand.amarelo};line-height:4px;font-size:0;">&nbsp;</td></tr>

        <tr><td style="padding:16px 22px 4px 22px;font-family:Arial,sans-serif;font-size:13.5px;color:#333;">
          Condição meteorológica <strong>não prevista no informativo desta manhã</strong> foi identificada
          para <strong>${esc(cidade.nome)}</strong>. Avaliar necessidade de ação preventiva imediata.
        </td></tr>

        <tr><td style="padding:12px 22px 4px 22px;">
          ${base.alertas.map(blocoAlerta).join("")}
        </td></tr>

        <tr><td style="padding:6px 22px 4px 22px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #EEE;border-radius:4px;">
            <tr>
              <td style="padding:9px 12px;text-align:center;border-right:1px solid #EEE;font-family:Arial,sans-serif;">
                <div style="font-size:9px;color:#777;text-transform:uppercase;">Temperatura</div>
                <div style="font-size:16px;font-weight:bold;color:#333;">${r.tempMin ?? "—"}° / ${r.tempMax ?? "—"}°C</div>
              </td>
              <td style="padding:9px 12px;text-align:center;border-right:1px solid #EEE;font-family:Arial,sans-serif;">
                <div style="font-size:9px;color:#777;text-transform:uppercase;">Rajada máx.</div>
                <div style="font-size:16px;font-weight:bold;color:#333;">${Math.max(...(r.ventoPorPeriodo || []).map((p) => p.rajadaMaxKmh ?? 0), 0)} km/h</div>
              </td>
              <td style="padding:9px 12px;text-align:center;font-family:Arial,sans-serif;">
                <div style="font-size:9px;color:#777;text-transform:uppercase;">Condição</div>
                <div style="font-size:13px;font-weight:bold;color:#333;">${esc(r.condicaoGeral)}</div>
              </td>
            </tr>
          </table>
        </td></tr>

        <tr><td style="padding:14px 22px 18px 22px;font-family:Arial,sans-serif;">
          <div style="background:#F4F7F5;border-radius:4px;padding:11px 14px;font-size:12px;color:#555;">
            Recomendações completas e detalhamento por período estão no informativo diário desta base.
            Em caso de emergência, acionar a Defesa Civil pelo <strong>199</strong>.
          </div>
        </td></tr>

        <tr><td style="height:3px;background:${brand.amarelo};line-height:3px;font-size:0;">&nbsp;</td></tr>
        <tr><td style="padding:11px 22px 16px 22px;text-align:center;color:#888;font-size:10.5px;font-family:Arial,sans-serif;">
          Alerta gerado automaticamente pelo monitor do CIM em ${esc(r.dataFormatadaCurta)} às ${esc(r.horaConsulta)}.
          Enviado apenas quando surge condição nova — não se repete para o mesmo evento.
          Sujeito a revisão humana antes de uso operacional.
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function assuntoAlerta(base) {
  const tipos = [...new Set(base.alertas.map((a) => a.tipo))].slice(0, 2).join(" / ");
  const temSevero = base.alertas.some((a) => a.gravidade === "severo");
  return `${temSevero ? "🔴" : "⚠"} ALERTA — ${base.cidade.nome}/${base.cidade.uf}: ${tipos}`;
}

module.exports = { renderAlertEmailHtml, assuntoAlerta };
