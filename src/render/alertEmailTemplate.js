// E-mail curto do monitor de alertas. A identidade permanece institucional;
// a urgência é comunicada pelos cards de transição, não pela cor do cabeçalho.

const {
  esc,
  nivelExibicao,
  nomeParametroAlerta,
  normalizarGrau,
  renderEmailHeader,
  renderEmailHeaderStyles,
  renderStatusChangeCard,
} = require("./emailComponents");
const { ordenarEventosParaExibicao, prioridadeNivel } = require("./eventOrdering");
const { TIPOS_DOCUMENTO, deveExibirNoDocumento } = require("../logic/alertPresentation");

function alertasCimExibiveis(alertas) {
  return ordenarEventosParaExibicao((Array.isArray(alertas) ? alertas : []).filter((alerta) =>
    deveExibirNoDocumento({
      nivel: normalizarGrau(alerta?.grau),
      tipoDocumento: TIPOS_DOCUMENTO.ALERTA_CIM,
    })
  ));
}

function blocoAlerta(a) {
  return renderStatusChangeCard({
    resumido: true,
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
    orgaoEmissor: a.orgaoEmissor,
    instrucoesOficiais: a.instrucoesOficiais,
    previsaoComplementar: a.previsaoComplementar,
    periodoPrevisao: a.periodoPrevisao,
    fontePrevisao: a.fontePrevisao,
    recomendacoes: a.recomendacoes,
  });
}

function sitesOficiaisHtml(cidade) {
  const sites = [
    ["INMET", cidade?.links?.inmet || "https://portal.inmet.gov.br/"],
    ["ANA — Monitor de Secas", "https://monitordesecas.ana.gov.br/"],
    ["ANA — classificação da seca", "https://monitordesecas.ana.gov.br/tabela-de-classificacao"],
    ["Ministério da Saúde — Excesso de Calor", "https://clima.saude.gov.br/"],
    cidade?.integracaoCorRio && ["Centro de Operações e Resiliência", "https://cor.rio/"],
  ].filter(Boolean);
  return sites.map(([nome, url]) => `<a href="${esc(url)}" style="color:#006B3C;text-decoration:underline;">${esc(nome)}</a>`).join(" &nbsp;|&nbsp; ");
}

/**
 * @param {object} base item de `porBase` retornado por verificarAlertas()
 */
const { faixaSimulacaoEmail } = require("./simulationBanner");

function renderAlertEmailHtml(base) {
  const r = base.report;
  const cidade = base.cidade;
  const alertas = alertasCimExibiveis(base.alertas);
  if (!alertas.length) return "";
  const apenasCalorEhf = alertas.every((alerta) => alerta.assinatura === 'calor-ehf');
  const temTransicao = alertas.some((alerta) => normalizarGrau(alerta.grauAnterior));
  const rajadas = (r.ventoPorPeriodo || []).map((periodo) => periodo?.rajadaMaxKmh).filter(Number.isFinite);
  const rajada = rajadas.length ? `${Math.max(...rajadas)} km/h` : "—";

  return `<!doctype html>
<html lang="pt-BR">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${renderEmailHeaderStyles()}</head>
<body style="margin:0;padding:0;background:#EEF1EF;font-family:Arial,'Segoe UI',sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;background:#EEF1EF;">
    <tr><td align="center" style="padding:18px 6px;">
      <!--[if mso]><table role="presentation" width="850" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
      <table class="cim-email-shell" role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;max-width:850px;background:#ffffff;">
        ${faixaSimulacaoEmail(r)}
        ${renderEmailHeader({
          titulo: "ALERTA METEOROLÓGICO",
          cidade: cidade.nome,
          uf: cidade.uf,
          data: r.dataFormatadaLonga || r.dataFormatadaCurta,
        })}

        <tr><td style="padding:16px 22px 4px 22px;font-family:Arial,sans-serif;font-size:13.5px;color:#333;">
          ${temTransicao ? "Mudança de gatilho" : "Novo enquadramento"} ${apenasCalorEhf ? 'de calor / risco à saúde' : 'meteorológico'} identificado para <strong>${esc(cidade.nome)}</strong>.
          Consulte abaixo o grau atual e as recomendações aplicáveis.
        </td></tr>

        <tr><td style="padding:12px 22px 4px 22px;">
          ${alertas.map(blocoAlerta).join("")}
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
                <div style="font-size:16px;font-weight:bold;color:#333;">${rajada}</div>
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
            O detalhamento complementar por período está no informativo diário desta base.
            Em caso de emergência, acionar a Defesa Civil pelo <strong>199</strong>.
          </div>
          <div data-official-consultation-sites="true" style="padding:11px 2px 0;font-size:11px;line-height:1.6;color:#666;">
            <strong>Sites oficiais para consulta:</strong><br>${sitesOficiaisHtml(cidade)}
          </div>
        </td></tr>

        <tr><td style="height:3px;background:#FFCC00;line-height:3px;font-size:0;">&nbsp;</td></tr>
        <tr><td style="padding:11px 22px 16px 22px;text-align:center;color:#888;font-size:10.5px;font-family:Arial,sans-serif;">
          Alerta gerado automaticamente pelo monitor do CIM em ${esc(r.dataFormatadaCurta)} às ${esc(r.horaConsulta)}.
          Enviado quando surge um novo enquadramento ou há mudança de gatilho para o fenômeno monitorado.
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
  const alertas = alertasCimExibiveis(base.alertas);
  if (!alertas.length) return "";
  const tipos = [...new Set(alertas.map((a) => nomeParametroAlerta(a.tipo, {
    oficial: a.naturezaDado === "Aviso oficial",
  })))].slice(0, 2).join(" / ");
  const grau = alertas
    .map((a) => normalizarGrau(a.grau))
    .filter(Boolean)
    .sort((a, b) => prioridadeNivel(b) - prioridadeNivel(a))[0] || "ALERTA";
  const simbolo = { NORMAL: "🟢", "ATENÇÃO": "🟡", ALERTA: "🟠", "EMERGÊNCIA": "🔴" }[grau];
  return `${simbolo} ${tipos} — ${nivelExibicao(grau)} — ${base.cidade.nome}/${base.cidade.uf}`;
}

module.exports = { alertasCimExibiveis, renderAlertEmailHtml, assuntoAlerta };
