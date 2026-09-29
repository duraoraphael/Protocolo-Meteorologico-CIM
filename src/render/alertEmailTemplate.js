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

function esc(valor) {
  if (valor === null || valor === undefined) return "—";
  return String(valor)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function corGravidade(gravidade) {
  return brand.statusVisual(({ atencao: "ATENÇÃO", alto: "ALERTA", severo: "EMERGÊNCIA" })[gravidade] || "NORMAL").cor;
}

function blocoAlerta(a) {
  const titulo = a.grau ? `${a.grau} — ${String(a.tipo).toUpperCase()}` : a.tipo;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"
    style="border-left:5px solid ${corGravidade(a.gravidade)};background:${brand.statusVisual(a.grau).fundo};border-radius:4px;margin-bottom:18px;">
    <tr><td style="padding:20px 22px;font-family:Arial,sans-serif;">
      <div style="font-size:19px;font-weight:bold;line-height:1.4;color:${corGravidade(a.gravidade)};margin-bottom:14px;">
        ${esc(titulo)}${a.motivo === "agravou" ? ' <span style="font-size:11px;font-weight:normal;background:#7B241C;color:#fff;padding:1px 6px;border-radius:3px;">AGRAVOU</span>' : ""}
      </div>
      ${a.grau ? `<div style="font-size:13px;color:${corGravidade(a.gravidade)};font-weight:bold;margin-top:5px;">Grau de severidade: ${esc(a.grau)}</div>` : ""}
      ${a.grauAnterior ? `<div style="font-size:13px;font-weight:bold;margin-top:7px;">Mudança de gatilho: ${esc(a.grauAnterior)} → ${esc(a.grau)}</div>` : ""}
      ${a.severidadeTexto ? `<div style="font-size:12px;color:${corGravidade(a.gravidade)};font-weight:bold;margin-top:5px;">${esc(a.severidadeTexto)}</div>` : ""}
      ${a.naturezaDado === "Aviso oficial" ? `<div style="font-size:12px;color:#333;font-weight:bold;margin-top:14px;">Aviso oficial INMET</div>` : ""}
      ${a.detalhe ? `<div style="font-size:13px;color:#333;margin-top:14px;line-height:1.6;">${a.naturezaDado === "Aviso oficial" ? "<strong>Motivo do aviso:</strong> " : ""}${esc(a.detalhe)}</div>` : ""}
      <div style="font-size:12px;color:#555;margin-top:14px;line-height:1.5;">Janela prevista: ${esc(a.janela)}</div>
      <div style="font-size:12px;color:#555;margin-top:9px;line-height:1.5;">Fonte de dados: ${esc(a.fonteDados || a.origem)}</div>
      ${a.recomendacoes?.length ? `<div style="font-size:12px;color:#333;margin-top:20px;line-height:1.6;"><strong>Recomendações - Protocolo Meteorológico do COMPARTILHADO</strong><ul style="margin:10px 0 0 20px;padding:0;">${a.recomendacoes.map((item) => `<li style="margin-bottom:9px;">${esc(item)}</li>`).join("")}</ul></div>` : ""}
    </td></tr>
  </table>`;
}

/**
 * @param {object} base item de `porBase` retornado por verificarAlertas()
 */
function renderAlertEmailHtml(base) {
  const r = base.report;
  const cidade = base.cidade;
  const ordem = { NORMAL: 0, "ATENÇÃO": 1, ALERTA: 2, "EMERGÊNCIA": 3 };
  const grauMaior = base.alertas.reduce((maior, alerta) =>
    (ordem[alerta.grau] || 0) > ordem[maior] ? alerta.grau : maior, "NORMAL");
  const corCabecalho = grauMaior === "NORMAL" ? "#916B00" : brand.statusVisual(grauMaior).cor;

  return `<!doctype html>
<html lang="pt-BR">
<body style="margin:0;padding:0;background:#EEF1EF;font-family:Arial,'Segoe UI',sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#EEF1EF;padding:18px 0;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:6px;overflow:hidden;max-width:600px;">

        <tr><td style="background:${corCabecalho};padding:16px 22px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
            <td width="150" valign="middle" style="color:#fff;font-family:Arial,sans-serif;line-height:1.2;">
              <strong style="display:block;font-size:22px;">CIM</strong>
              <span style="display:block;font-size:10px;margin-top:4px;">Centro integrado de monitoramento</span>
              <span style="display:block;font-size:10px;margin-top:2px;">compartilhado</span>
            </td>
            <td valign="middle">
              <div style="color:#fff;font-size:17px;font-weight:bold;letter-spacing:0.4px;">${grauMaior === "NORMAL" ? "ATUALIZAÇÃO METEOROLÓGICA" : "⚠ ALERTA METEOROLÓGICO"}</div>
              <div style="color:#FDEDEC;font-size:13px;margin-top:3px;">
                ${esc(cidade.nome)} — ${esc(cidade.uf)} · ${esc(r.dataFormatadaCurta)} às ${esc(r.horaConsulta)}
              </div>
            </td>
          </tr></table>
        </td></tr>
        <tr><td style="height:4px;background:${brand.amarelo};line-height:4px;font-size:0;">&nbsp;</td></tr>

        <tr><td style="padding:16px 22px 4px 22px;font-family:Arial,sans-serif;font-size:13.5px;color:#333;">
          Mudança de gatilho meteorológico identificada para <strong>${esc(cidade.nome)}</strong>.
          Consulte abaixo o grau atual e as recomendações aplicáveis.
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
                <div style="font-size:9px;color:#777;text-transform:uppercase;">Rajada prevista</div>
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
          Enviado quando há mudança de gatilho para o fenômeno monitorado.
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
  const ordem = { NORMAL: 0, "ATENÇÃO": 1, ALERTA: 2, "EMERGÊNCIA": 3 };
  const grau = base.alertas
    .map((a) => a.grau)
    .filter(Boolean)
    .sort((a, b) => ordem[b] - ordem[a])[0] || "ALERTA";
  const simbolo = grau === "NORMAL" ? "🟡" : grau === "ATENÇÃO" ? "🟠" : "🔴";
  return `${simbolo} ${grau} — ${base.cidade.nome}/${base.cidade.uf}: ${tipos}`;
}

module.exports = { renderAlertEmailHtml, assuntoAlerta };
