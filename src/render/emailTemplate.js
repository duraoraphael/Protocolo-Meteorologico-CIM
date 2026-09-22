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

function corSeveridade(severidade = "") {
  const s = severidade.toLowerCase();
  if (s.includes("grande perigo")) return "#7B241C";
  if (s.includes("perigo")) return brand.vermelhoAlerta;
  if (s.includes("atenção") || s.includes("atencao")) return "#B9770E";
  return brand.verde;
}

function renderEmailHtml(r) {
  const evento = r.eventoMaisRelevante;
  const avisoMaisGrave = r.avisosInmet?.[0];

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

        <tr><td style="padding:10px 20px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #eee;border-radius:4px;">
            <tr>
              ${celulaMetrica("Temp. mín/máx", parOuTraco(r.tempMin, r.tempMax, "°", "°C"))}
              ${celulaMetrica("Umidade mín/máx", parOuTraco(r.umidadeMin, r.umidadeMax, "%", "%"))}
              ${celulaMetrica("Rajada máx.", rajadaMaximaTexto(r))}
            </tr>
            <tr>
              ${celulaMetrica("Índice UV", r.qualidadeAr?.uvMax != null ? `${r.qualidadeAr.uvMax} <span style="font-size:12px;font-weight:normal;">(${esc(r.qualidadeAr.uvClassificacao.nivel)})</span>` : "—")}
              ${celulaMetrica("Ar (PM2,5)", r.qualidadeAr?.pm25Medio != null ? `<span style="font-size:15px;">${esc(r.qualidadeAr.pm25Classificacao.nivel)}</span>` : "—")}
              ${celulaMetrica("Mar — onda máx.", r.mar?.alturaMaxDiaM != null ? `${r.mar.alturaMaxDiaM} m` : "—")}
            </tr>
          </table>
        </td></tr>

        <tr><td style="padding:14px 28px 4px 28px;">
          <div style="border:1.5px solid ${brand.amarelo};background:#fffdf2;border-radius:4px;padding:12px 16px;font-size:13px;color:${brand.cinzaTexto};">
            <strong>⚠ Evento mais relevante do dia</strong><br/>
            ${evento ? esc(evento.descricao) + `<br/><em>Janela prevista:</em> ${esc(evento.janela)}` : "Não foi identificado evento climático extremo para a data, com base nas fontes automatizadas consultadas."}
          </div>
        </td></tr>

        ${
          avisoMaisGrave
            ? `<tr><td style="padding:10px 28px 4px 28px;">
          <div style="border-left:4px solid ${corSeveridade(avisoMaisGrave.severidade)};background:#fff8f0;padding:10px 14px;font-size:12.5px;color:${brand.cinzaTexto};">
            <strong>Aviso oficial INMET:</strong> ${esc(avisoMaisGrave.descricao)} — <span style="color:${corSeveridade(avisoMaisGrave.severidade)};font-weight:bold;">${esc(avisoMaisGrave.severidade)}</span>
          </div>
        </td></tr>`
            : ""
        }

        <tr><td style="padding:18px 28px 0 28px;">
          <div style="color:${brand.verde};font-weight:bold;font-size:14px;border-bottom:2px solid ${brand.verde};padding-bottom:4px;">Deslocamento — destaques</div>
          <div style="font-size:12.5px;color:${brand.cinzaTexto};margin-top:8px;">
            <strong>Pedestres:</strong>
            <ul style="margin:4px 0 10px 18px;padding:0;">${linhasLista(r.deslocamento.pedestres, 2)}</ul>
            <strong>Condutores:</strong>
            <ul style="margin:4px 0 10px 18px;padding:0;">${linhasLista(r.deslocamento.condutores, 2)}</ul>
          </div>
        </td></tr>

        <tr><td style="padding:6px 28px 0 28px;">
          <div style="color:${brand.verde};font-weight:bold;font-size:14px;border-bottom:2px solid ${brand.verde};padding-bottom:4px;">Edificação — destaques</div>
          <div style="font-size:12.5px;color:${brand.cinzaTexto};margin-top:8px;">
            ${r.edificacao
              .slice(0, 2)
              .map(
                (s) =>
                  `<strong>${esc(s.titulo)}:</strong><ul style="margin:4px 0 10px 18px;padding:0;">${linhasLista(s.itens, 2)}</ul>`
              )
              .join("")}
          </div>
        </td></tr>

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
