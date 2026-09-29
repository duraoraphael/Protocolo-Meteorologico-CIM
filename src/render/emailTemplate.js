const brand = require("./brand");
const { esc } = require("./pdfTemplate");

function linhasLista(itens, max = 4) {
  return itens
    .slice(0, max)
    .map(
      (i) =>
        `<li style="margin-bottom:6px;">${esc(i)}</li>`
    )
    .join("");
}

function celulaMetrica(rotulo, valor) {
  return `<td style="padding:10px 14px;text-align:center;border-right:1px solid #eee;">
    <div style="font-size:10px;color:#777;text-transform:uppercase;letter-spacing:0.5px;">${esc(rotulo)}</div>
    <div style="font-size:20px;font-weight:bold;color:${brand.cinzaTexto};">${valor}</div>
  </td>`;
}

// Se nenhuma fonte respondeu com temperatura/umidade, os valores chegam
// nulos — exibir "null° / null°C" no e-mail seria pior que não informar.
function parOuTraco(minimo, maximo, sufixoMin, sufixoMax) {
  if (minimo == null && maximo == null) return "—";
  const a = minimo == null ? "—" : `${minimo}${sufixoMin}`;
  const b = maximo == null ? "—" : `${maximo}${sufixoMax}`;
  return `${a} / ${b}`;
}

// A rajada pode não existir (ex.: Open-Meteo indisponível e só o INMET
// respondeu — o INMET não fornece rajada em km/h). Nesse caso mostra "—"
// em vez de "0 km/h", que seria lido como previsão real de calmaria.
function rajadaMaximaTexto(r) {
  const valores = r.ventoPorPeriodo
    .map((p) => p.rajadaMaxKmh)
    .filter((v) => v !== null && v !== undefined);
  return valores.length ? `${Math.max(...valores)} km/h` : "—";
}

function chuvaAcumuladaTexto(r) {
  return Number.isFinite(r.precipitacaoTotalMm)
    ? `${esc(r.precipitacaoTotalMm)} mm`
    : "—";
}

function corSeveridade(severidade = "") {
  const s = severidade.toLowerCase();
  if (s.includes("grande perigo")) return "#7B241C";
  if (s.includes("perigo")) return brand.vermelhoAlerta;
  if (s.includes("atenção") || s.includes("atencao")) return "#B9770E";
  return brand.verde;
}

function blocoSeveridadeEmail(r) {
  const grau = r.severidade?.grau || r.eventoMaisRelevante?.grau || "NORMAL";
  const visual = brand.statusVisual(grau);
  const eventos = (r.severidade?.eventos || (r.eventoMaisRelevante ? [r.eventoMaisRelevante] : []))
    .filter((evento, indice) => indice === 0 || evento.tipo !== "avisoInmet");
  const estilo = `border:1.5px solid ${visual.cor};background:${visual.fundo};border-radius:4px;padding:20px 22px;font-size:13px;line-height:1.55;color:${brand.cinzaTexto};`;

  if (grau === "NORMAL" || eventos.length === 0) {
    return `<div style="${estilo}">
      <strong style="color:${visual.cor};">CONDIÇÃO NORMAL</strong><br/>
      Não foram identificadas condições meteorológicas que atinjam os níveis de Atenção, Alerta ou Emergência no período analisado.
    </div>`;
  }

  const principal = eventos[0];
  const icone = grau === "ATENÇÃO" ? "⚠" : "🚨";
  const recomendacoesPrincipal = principal.recomendacoes?.length
    ? `<div style="margin-top:20px;"><strong>Recomendações - Protocolo Meteorológico do COMPARTILHADO</strong><ul style="margin:10px 0 0 20px;padding:0;">${linhasLista(principal.recomendacoes, principal.recomendacoes.length)}</ul></div>`
    : "";
  const demais = eventos.slice(1).map((evento) => `
    <div style="border-top:1px solid ${brand.cinzaBorda};margin-top:20px;padding-top:18px;">
      <strong style="display:block;margin-bottom:10px;">${esc(evento.titulo)}</strong>
      <div style="margin-bottom:10px;">${esc(evento.descricao)}</div>
      <div style="margin-bottom:10px;"><em>Janela prevista:</em> ${esc(evento.janela)}</div>
      <div>Fonte de dados: ${esc(evento.fonteDados || (evento.tipo === "avisoInmet" ? "INMET — aviso oficial" : "Consulte as fontes por campo"))}</div>
      ${evento.recomendacoes?.length ? `<div style="margin-top:16px;"><strong>Recomendações - Protocolo Meteorológico do COMPARTILHADO</strong><ul style="margin:10px 0 0 20px;padding:0;">${linhasLista(evento.recomendacoes, evento.recomendacoes.length)}</ul></div>` : ""}
    </div>`).join("");

  return `<div style="${estilo}">
    <strong style="color:${visual.cor};font-size:18px;display:block;margin-bottom:14px;">${icone} ${esc(principal.titulo)}</strong>
    <div style="margin-bottom:12px;">${esc(principal.descricao)}</div>
    <div style="margin-bottom:12px;"><em>Janela prevista:</em> ${esc(principal.janela)}</div>
    <div>Fonte de dados: ${esc(principal.fonteDados || (principal.tipo === "avisoInmet" ? "INMET — aviso oficial" : "Consulte as fontes por campo"))}</div>
    ${recomendacoesPrincipal}
    ${demais}
  </div>`;
}

function renderEmailHtml(r) {
  const avisoMaisGrave = r.avisosInmet?.[0];
  const resumoAgendado = r.periodoCoberto
    ? `<tr><td style="padding:12px 28px;color:${brand.cinzaTexto};font-size:13px;"><strong>Período coberto:</strong> ${esc(r.periodoCoberto)}.<br/><strong>Previsão:</strong> ${(r.previsaoDias || []).map((dia) => `${esc(dia.periodo)} (${esc(dia.data)}): ${dia.chuvaMm == null ? "—" : `${esc(dia.chuvaMm)} mm`} de chuva; rajada prevista ${dia.rajadaKmh == null ? "—" : `${esc(dia.rajadaKmh)} km/h`}`).join("<br/>")}</td></tr>`
    : "";
  const mudancasAgendadas = r.mudancasDia
    ? `<tr><td style="padding:12px 28px;color:${brand.cinzaTexto};font-size:13px;"><strong>Mudanças desde o relatório das 05:00:</strong><ul style="margin:8px 0 0 18px;padding:0;">${linhasLista(r.mudancasDia, r.mudancasDia.length)}</ul></td></tr>`
    : "";

  return `<!doctype html>
<html lang="pt-BR">
<body style="margin:0;padding:0;background:#eef1ef;font-family:Arial,'Segoe UI',sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef1ef;padding:20px 0;">
    <tr><td align="center">
      <table role="presentation" width="640" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:6px;overflow:hidden;">

        <tr><td style="background:${brand.verde};padding:22px 28px 18px 28px;text-align:center;">
          <div style="color:#ffffff;font-size:19px;font-weight:bold;letter-spacing:0.5px;">INFORMATIVO METEOROLÓGICO</div>
          <div style="color:#eafaf0;font-size:13px;margin-top:4px;">${esc(r.cidade.nome)} — ${esc(r.cidade.uf)} · ${esc(r.dataFormatadaLonga)}</div>
        </td></tr>
        <tr><td style="height:4px;background:${brand.amarelo};line-height:4px;font-size:0;">&nbsp;</td></tr>

        <tr><td style="padding:20px 28px 4px 28px;color:${brand.cinzaTexto};font-size:13px;">
          <strong>Hora da consulta:</strong> ${esc(r.horaConsulta)} (Horário de Brasília) &nbsp;·&nbsp; <strong>Condição geral:</strong> ${esc(r.condicaoGeral)}
        </td></tr>
        ${resumoAgendado}
        ${mudancasAgendadas}

        <tr><td style="padding:10px 20px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #eee;border-radius:4px;">
            <tr>
              ${celulaMetrica("Temp. mín/máx", parOuTraco(r.tempMin, r.tempMax, "°", "°C"))}
              ${celulaMetrica("Umidade mín/máx", parOuTraco(r.umidadeMin, r.umidadeMax, "%", "%"))}
              ${celulaMetrica("Rajada prevista", rajadaMaximaTexto(r))}
            </tr>
            <tr>
              ${celulaMetrica("Índice UV", r.qualidadeAr?.uvMax != null ? `${r.qualidadeAr.uvMax} <span style="font-size:12px;font-weight:normal;">(${esc(r.qualidadeAr.uvClassificacao.nivel)})</span>` : "—")}
              ${celulaMetrica("Ar (PM2,5)", r.qualidadeAr?.pm25Medio != null ? `<span style="font-size:15px;">${esc(r.qualidadeAr.pm25Classificacao.nivel)}</span>` : "—")}
              ${celulaMetrica("Chuva acumulada", chuvaAcumuladaTexto(r))}
            </tr>
          </table>
        </td></tr>

        <tr><td style="padding:14px 28px 4px 28px;">
          ${blocoSeveridadeEmail(r)}
        </td></tr>

        ${
          avisoMaisGrave
            ? `<tr><td style="padding:10px 28px 4px 28px;">
          <div style="border-left:4px solid ${corSeveridade(avisoMaisGrave.severidade)};background:#fff8f0;padding:16px 18px;font-size:12.5px;line-height:1.55;color:${brand.cinzaTexto};">
            <strong>Aviso oficial INMET:</strong> ${esc(avisoMaisGrave.descricao)} — <span style="color:${corSeveridade(avisoMaisGrave.severidade)};font-weight:bold;">${esc(avisoMaisGrave.severidade)}</span>
            <div style="margin-top:10px;">Fonte de dados: INMET</div>
            ${avisoMaisGrave.riscos?.length ? `<div style="margin-top:10px;"><strong>Motivo do aviso:</strong> ${esc(avisoMaisGrave.riscos.filter(Boolean).join(" "))}</div>` : ""}
          </div>
        </td></tr>`
            : ""
        }

        <tr><td style="padding:10px 28px 20px 28px;">
          <div style="background:#f4f7f5;border-radius:4px;padding:12px 16px;font-size:12px;color:#555;">
            Relatório completo com todas as tabelas, avisos oficiais, fontes consultadas e recomendações detalhadas em anexo (PDF).
          </div>
        </td></tr>

        <tr><td style="height:3px;background:${brand.amarelo};line-height:3px;font-size:0;">&nbsp;</td></tr>
        <tr><td style="padding:12px 28px 18px 28px;text-align:center;color:#888;font-size:10.5px;">
          Documento gerado automaticamente por ferramenta de geração assistida por IA em ${esc(r.dataFormatadaCurta)} às ${esc(r.horaConsulta)}.
          Sujeito a revisão humana antes de uso operacional.
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

module.exports = { renderEmailHtml };
