// E-mail curto do monitor de alertas. A identidade permanece institucional;
// a urgência é comunicada pelos cards de transição, não pela cor do cabeçalho.

const {
  esc,
  normalizarGrau,
  renderEmailHeader,
  renderStatusChangeCard,
} = require("./emailComponents");
const { ordenarEventosParaExibicao } = require("./eventOrdering");

function blocoAlerta(a) {
  return renderStatusChangeCard({
    tipo: a.tipo,
    grauAnterior: a.grauAnterior,
    grau: a.grau,
    motivo: a.motivo,
    detalhe: a.detalhe,
    janela: a.janela,
    fonteDados: a.fonteDados || a.origem,
    protocolo: a.protocolo,
    naturezaDado: a.naturezaDado,
    severidadeTexto: a.severidadeTexto,
    instrucoesOficiais: a.instrucoesOficiais,
    recomendacoes: a.recomendacoes,
  });
}

/**
 * @param {object} base item de `porBase` retornado por verificarAlertas()
 */
function renderAlertEmailHtml(base) {
  const r = base.report;
  const cidade = base.cidade;
  const apenasCalorEhf = base.alertas.every((alerta) => alerta.assinatura === 'calor-ehf');
  const somenteNormalizacoes = base.alertas.length > 0 && base.alertas.every((alerta) => normalizarGrau(alerta.grau) === "NORMAL");
  const tituloCabecalho = somenteNormalizacoes ? "ATUALIZAÇÃO METEOROLÓGICA" : "ALERTA METEOROLÓGICO";

  return `<!doctype html>
<html lang="pt-BR">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#EEF1EF;font-family:Arial,'Segoe UI',sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;background:#EEF1EF;">
    <tr><td align="center" style="padding:18px 6px;">
      <!--[if mso]><table role="presentation" width="850" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;max-width:850px;background:#ffffff;">
        ${renderEmailHeader({
          titulo: tituloCabecalho,
          cidade: cidade.nome,
          uf: cidade.uf,
          data: r.dataFormatadaCurta,
        })}

        <tr><td style="padding:16px 22px 4px 22px;font-family:Arial,sans-serif;font-size:13.5px;color:#333;">
          ${apenasCalorEhf ? '<strong>ALERTA DE CALOR / RISCO À SAÚDE</strong><br>' : ''}
          Mudança de gatilho ${apenasCalorEhf ? 'de calor / risco à saúde' : 'meteorológico'} identificada para <strong>${esc(cidade.nome)}</strong>.
          Consulte abaixo o grau atual e as recomendações aplicáveis.
        </td></tr>

        <tr><td style="padding:12px 22px 4px 22px;">
          ${ordenarEventosParaExibicao(base.alertas).map(blocoAlerta).join("")}
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

        <tr><td style="height:3px;background:#FFCC00;line-height:3px;font-size:0;">&nbsp;</td></tr>
        <tr><td style="padding:11px 22px 16px 22px;text-align:center;color:#888;font-size:10.5px;font-family:Arial,sans-serif;">
          Alerta gerado automaticamente pelo monitor do CIM em ${esc(r.dataFormatadaCurta)} às ${esc(r.horaConsulta)}.
          Enviado quando há mudança de gatilho para o fenômeno monitorado.
          Sujeito a revisão humana antes de uso operacional.
        </td></tr>

      </table>
      <!--[if mso]></td></tr></table><![endif]-->
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
