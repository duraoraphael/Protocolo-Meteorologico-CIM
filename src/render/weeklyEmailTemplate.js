// Resumo semanal no corpo do e-mail.
//
// Restrições que moldaram este layout (não são preferências estéticas):
// - Gmail/Outlook removem <svg> e <style> externo → tudo é tabela + estilo
//   inline, e os "gráficos" são células com background-color.
// - Outlook desktop ignora flexbox/grid → só <table role="presentation">.
// - O objetivo é a leitura em 30 segundos no celular, na segunda de manhã;
//   o detalhamento completo fica no PDF anexo.

const brand = require("./brand");
const { barraHtml, fitaSeveridadeHtml } = require("./charts");
const { logosComoDataUri } = require("../config/logos");

function esc(valor) {
  if (valor === null || valor === undefined) return "—";
  return String(valor)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function cartao(rotulo, valor, cor) {
  return `<td width="25%" style="padding:10px 6px;text-align:center;border-top:3px solid ${cor};background:#F7F9F8;">
    <div style="font-size:22px;font-weight:bold;color:${cor};line-height:1.1;font-family:Arial,sans-serif;">${valor}</div>
    <div style="font-size:9px;color:#666;text-transform:uppercase;letter-spacing:0.4px;font-family:Arial,sans-serif;margin-top:2px;">${esc(rotulo)}</div>
  </td>`;
}

function linhaAlerta(a) {
  return `<tr>
    <td style="padding:6px 0;border-bottom:1px solid #EEE;font-family:Arial,sans-serif;">
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%"><tr>
        <td width="70" valign="top">
          <span style="display:inline-block;background:${a.severidade.cor};color:#fff;font-size:10px;font-weight:bold;padding:2px 6px;border-radius:3px;font-family:Arial,sans-serif;">${esc(a.diaSemana)} ${esc(a.diaMes)}</span>
        </td>
        <td valign="top" style="font-size:12.5px;color:#333;font-family:Arial,sans-serif;">
          <strong>${esc(a.base)}</strong> — ${esc(a.tipo)}
          <div style="color:#777;font-size:11.5px;">${esc(a.detalhe)}</div>
        </td>
      </tr></table>
    </td>
  </tr>`;
}

function linhaBase(base, chuvaMaxRef, rajadaMaxRef) {
  return `<tr>
    <td style="padding:8px 0;border-bottom:1px solid #EEE;font-family:Arial,sans-serif;">
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%"><tr>
        <td valign="middle" style="font-size:13px;color:#333;">
          <strong>${esc(base.cidade.nome)}</strong>
          <span style="color:#888;font-size:11px;">${esc(base.cidade.uf)}</span>
          <div style="color:#777;font-size:11px;margin-top:1px;">
            ${base.tempMinSemana}–${base.tempMaxSemana}°C · ${base.chuvaTotalSemana} mm · rajada ${base.rajadaMaxSemana} km/h${base.ondaMaxSemana ? ` · onda ${base.ondaMaxSemana} m` : ""}
          </div>
        </td>
        <td width="130" align="right" valign="middle">
          ${fitaSeveridadeHtml(base.dias)}
        </td>
        <td width="82" align="right" valign="middle">
          <span style="display:inline-block;background:${base.severidadeMax.cor};color:#fff;font-size:10.5px;font-weight:bold;padding:3px 9px;border-radius:10px;font-family:Arial,sans-serif;">${esc(base.severidadeMax.rotulo)}</span>
        </td>
      </tr></table>
    </td>
  </tr>`;
}

function renderWeeklyEmailHtml(r) {
  const logos = logosComoDataUri();
  const alertasTopo = r.alertas.slice(0, 8);
  const chuvaMaxRef = Math.max(...r.basesOrdenadas.map((b) => b.chuvaTotalSemana), 1);
  const rajadaMaxRef = Math.max(...r.basesOrdenadas.map((b) => b.rajadaMaxSemana), 1);

  // Barras do panorama por dia: quantas bases críticas/atenção em cada dia.
  const maxBases = r.totalBases || 1;
  const linhasPanorama = r.panoramaDias
    .map((d) => {
      const problemas = d.basesCriticas + d.basesAtencao;
      const cor = d.basesCriticas > 0 ? "#C0392B" : d.basesAtencao > 0 ? "#E67E22" : "#00843D";
      return `<tr>
        <td style="font-size:11.5px;color:#333;font-family:Arial,sans-serif;padding:3px 8px 3px 0;white-space:nowrap;">
          <strong>${esc(d.diaSemana)}</strong> <span style="color:#888;">${esc(d.diaMes)}</span>
        </td>
        <td style="padding:3px 0;">${barraHtml(problemas, maxBases, cor, 130)}</td>
        <td style="font-size:11px;color:#666;font-family:Arial,sans-serif;padding:3px 0 3px 8px;white-space:nowrap;">
          ${d.basesCriticas > 0 ? `<span style="color:#C0392B;font-weight:bold;">${d.basesCriticas} crít.</span>` : ""}
          ${d.basesAtencao > 0 ? `${d.basesCriticas > 0 ? " · " : ""}${d.basesAtencao} atenção` : ""}
          ${problemas === 0 ? "sem alerta" : ""}
        </td>
      </tr>`;
    })
    .join("");

  return `<!doctype html>
<html lang="pt-BR">
<body style="margin:0;padding:0;background:#EEF1EF;font-family:Arial,'Segoe UI',sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#EEF1EF;padding:18px 0;">
    <tr><td align="center">
      <table role="presentation" width="640" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:6px;overflow:hidden;max-width:640px;">

        <!-- Cabeçalho -->
        <tr><td style="background:${brand.verde};padding:18px 24px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
            ${
              logos.cim
                ? `<td width="86" valign="middle"><img src="${logos.cim}" alt="CIM" width="80" style="display:block;width:80px;height:auto;" /></td>`
                : ""
            }
            <td valign="middle" align="center">
              <div style="color:#ffffff;font-size:17px;font-weight:bold;letter-spacing:0.4px;">RELATÓRIO METEOROLÓGICO SEMANAL</div>
              <div style="color:#EAFAF0;font-size:12.5px;margin-top:3px;">Centro Integrado de Monitoramento · ${esc(r.periodoLabel)}</div>
            </td>
            ${
              logos.petrobras
                ? `<td width="96" align="right" valign="middle"><div style="background:#fff;border-radius:4px;padding:4px 8px;display:inline-block;line-height:0;"><img src="${logos.petrobras}" alt="Petrobras" width="80" style="display:block;width:80px;height:auto;" /></div></td>`
                : ""
            }
          </tr></table>
        </td></tr>
        <tr><td style="height:4px;background:${brand.amarelo};line-height:4px;font-size:0;">&nbsp;</td></tr>

        <!-- Cartões -->
        <tr><td style="padding:16px 20px 6px 20px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="6" style="border-collapse:separate;"><tr>
            ${cartao("Críticas", r.totalBasesCriticas, "#C0392B")}
            ${cartao("Atenção", r.totalBasesAtencao, "#E67E22")}
            ${cartao("Normais", r.totalBasesNormais, "#00843D")}
            ${cartao("Alertas", r.alertas.length, "#2E86C1")}
          </tr></table>
        </td></tr>

        ${
          r.diaMaisCritico
            ? `<tr><td style="padding:10px 24px 4px 24px;">
          <div style="border:1.5px solid ${brand.amarelo};background:#FFFDF2;border-radius:4px;padding:11px 14px;font-size:13px;color:#333;">
            <strong>⚠ Dia de maior atenção: ${esc(r.diaMaisCritico.diaSemana)}, ${esc(r.diaMaisCritico.diaMes)}</strong><br/>
            <span style="font-size:12.5px;">${r.diaMaisCritico.basesCriticas} base(s) em situação crítica e ${r.diaMaisCritico.basesAtencao} em atenção.</span>
          </div>
        </td></tr>`
            : ""
        }

        <!-- Panorama por dia -->
        <tr><td style="padding:14px 24px 0 24px;">
          <div style="color:${brand.verde};font-weight:bold;font-size:14px;border-bottom:2px solid ${brand.verde};padding-bottom:4px;">Como fica cada dia</div>
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:8px;">
            ${linhasPanorama}
          </table>
          <div style="font-size:10.5px;color:#888;margin-top:4px;">Barra = número de bases com alerta naquele dia.</div>
        </td></tr>

        <!-- Alertas -->
        <tr><td style="padding:16px 24px 0 24px;">
          <div style="color:${brand.verde};font-weight:bold;font-size:14px;border-bottom:2px solid ${brand.verde};padding-bottom:4px;">
            Principais alertas${r.alertas.length > alertasTopo.length ? ` <span style="font-weight:normal;font-size:11.5px;color:#888;">(${alertasTopo.length} de ${r.alertas.length} — lista completa no PDF)</span>` : ""}
          </div>
          ${
            alertasTopo.length
              ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:6px;">
              ${alertasTopo.map(linhaAlerta).join("")}
            </table>`
              : `<div style="margin-top:8px;padding:11px 14px;background:#F1F9F4;border-left:4px solid ${brand.verde};font-size:13px;color:#333;">
              Nenhum alerta previsto para os próximos ${r.rotulosDias.length} dias nas ${r.totalBases} bases monitoradas.
            </div>`
          }
        </td></tr>

        <!-- Bases -->
        <tr><td style="padding:16px 24px 0 24px;">
          <div style="color:${brand.verde};font-weight:bold;font-size:14px;border-bottom:2px solid ${brand.verde};padding-bottom:4px;">Situação por base</div>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:6px;">
            ${r.basesOrdenadas.map((b) => linhaBase(b, chuvaMaxRef, rajadaMaxRef)).join("")}
          </table>
          <div style="font-size:10.5px;color:#888;margin-top:6px;">
            Quadradinhos = os ${r.rotulosDias.length} dias da janela, na ordem.
            <span style="color:#C0392B;">■</span> crítico
            <span style="color:#E67E22;">■</span> atenção
            <span style="color:#00843D;">■</span> normal
          </div>
        </td></tr>

        <tr><td style="padding:16px 24px 20px 24px;">
          <div style="background:#F4F7F5;border-radius:4px;padding:12px 16px;font-size:12px;color:#555;">
            <strong>PDF em anexo</strong> com o detalhamento completo: gráfico de temperatura e chuva de cada base,
            tabela dia a dia, avisos oficiais do INMET e condições de mar nas bases costeiras.
          </div>
        </td></tr>

        <tr><td style="height:3px;background:${brand.amarelo};line-height:3px;font-size:0;">&nbsp;</td></tr>
        <tr><td style="padding:12px 24px 18px 24px;text-align:center;color:#888;font-size:10.5px;">
          Gerado automaticamente por ferramenta assistida por IA em ${esc(r.dataGeracao)} às ${esc(r.horaGeracao)}.
          Sujeito a revisão humana antes de uso operacional. Fontes: Open-Meteo, INMET.
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

module.exports = { renderWeeklyEmailHtml };
