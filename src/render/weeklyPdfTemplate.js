const brand = require("./brand");
const { logosComoDataUri } = require("../config/logos");
const {
  svgTemperaturaEChuva,
  svgPanoramaSemana,
  svgFitaSeveridade,
} = require("./charts");

function esc(valor) {
  if (valor === null || valor === undefined) return "—";
  return String(valor)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function cartaoResumo(rotulo, valor, cor, detalhe) {
  return `<td class="cartao" style="border-top:3px solid ${cor};">
    <div class="cartao-rotulo">${esc(rotulo)}</div>
    <div class="cartao-valor" style="color:${cor};">${valor}</div>
    <div class="cartao-detalhe">${esc(detalhe || "")}</div>
  </td>`;
}

function blocoAlertas(r) {
  if (!r.alertas.length) {
    return `<div class="sem-alerta">
      <strong>Nenhum alerta para os próximos 7 dias.</strong>
      Condições dentro da normalidade em todas as ${r.totalBases} bases monitoradas.
    </div>`;
  }

  // Agrupa por base para não repetir o nome em cada linha.
  const porBase = new Map();
  for (const a of r.alertas) {
    if (!porBase.has(a.base)) porBase.set(a.base, []);
    porBase.get(a.base).push(a);
  }

  const linhas = [...porBase.entries()]
    .map(([base, alertas]) => {
      const uf = alertas[0].uf;
      const itens = alertas
        .map(
          (a) => `<div class="alerta-item">
            <span class="alerta-dia" style="background:${a.severidade.cor};">${esc(a.diaSemana)} ${esc(a.diaMes)}</span>
            <strong>${esc(a.tipo)}</strong> — ${esc(a.detalhe)}
          </div>`
        )
        .join("");
      return `<tr>
        <td class="alerta-base">${esc(base)}<span class="alerta-uf">${esc(uf)}</span></td>
        <td>${itens}</td>
      </tr>`;
    })
    .join("");

  return `<table class="tabela-alertas">
    <thead><tr><th style="width:24%;">Base</th><th>Alertas previstos</th></tr></thead>
    <tbody>${linhas}</tbody>
  </table>`;
}

function tabelaDiasBase(base) {
  const temMar = base.dias.some((d) => d.mar?.alturaMaxM != null);
  return `<table class="tabela-dias">
    <thead>
      <tr>
        <th>Dia</th><th>Condição</th><th>Mín/Máx</th><th>Chuva</th>
        <th>Rajada</th><th>UV</th>${temMar ? "<th>Onda</th>" : ""}<th>Situação</th>
      </tr>
    </thead>
    <tbody>
      ${base.dias
        .map(
          (d, i) => `<tr class="${i % 2 === 1 ? "zebra" : ""}">
          <td><strong>${esc(d.diaSemana)}</strong> ${esc(d.diaMes)}</td>
          <td>${esc(d.condicao)}</td>
          <td>${d.tempMin == null ? "—" : d.tempMin + "°"} / ${d.tempMax == null ? "—" : d.tempMax + "°"}</td>
          <td>${d.precipitacaoMm == null ? "—" : d.precipitacaoMm + " mm"}${d.probabilidadeChuva != null ? ` <span class="suave">(${d.probabilidadeChuva}%)</span>` : ""}</td>
          <td>${d.rajadaMaxKmh == null ? "—" : d.rajadaMaxKmh + " km/h"}</td>
          <td>${d.uvMax == null ? "—" : d.uvMax}</td>
          ${temMar ? `<td>${d.mar?.alturaMaxM == null ? "—" : d.mar.alturaMaxM + " m"}</td>` : ""}
          <td><span class="pastilha" style="background:${d.severidade.cor};">${esc(d.severidade.rotulo)}</span></td>
        </tr>`
        )
        .join("")}
    </tbody>
  </table>`;
}

function secaoBase(base, indice) {
  const c = base.cidade;
  const riscosUnicos = [...new Set(base.dias.flatMap((d) => d.riscos.map((x) => x.tipo)))];

  return `<div class="base ${indice > 0 ? "quebra-pagina" : ""}">
    <div class="base-cabecalho" style="border-left:6px solid ${base.severidadeMax.cor};">
      <div>
        <div class="base-nome">${esc(c.nome)} <span class="base-uf">${esc(c.uf)}</span></div>
        <div class="base-resumo">
          ${base.tempMinSemana}°C a ${base.tempMaxSemana}°C &nbsp;·&nbsp;
          ${base.chuvaTotalSemana} mm na semana &nbsp;·&nbsp;
          rajada máx. ${base.rajadaMaxSemana} km/h &nbsp;·&nbsp;
          UV máx. ${base.uvMaxSemana}
          ${base.ondaMaxSemana ? ` &nbsp;·&nbsp; onda máx. ${base.ondaMaxSemana} m` : ""}
        </div>
      </div>
      <div class="base-situacao">
        <div class="pastilha grande" style="background:${base.severidadeMax.cor};">${esc(base.severidadeMax.rotulo)}</div>
        <div class="base-fita">${svgFitaSeveridade(base.dias, 140, 20)}</div>
      </div>
    </div>

    ${riscosUnicos.length ? `<div class="base-riscos"><strong>Riscos na semana:</strong> ${riscosUnicos.map(esc).join(" · ")}</div>` : `<div class="base-riscos sem">Sem risco meteorológico relevante identificado nos próximos 7 dias.</div>`}

    <div class="grafico">${svgTemperaturaEChuva(base.dias, 700, 190)}</div>

    ${tabelaDiasBase(base)}

    ${
      base.avisosInmet?.length
        ? `<div class="avisos-inmet"><strong>⚠ Avisos oficiais INMET vigentes:</strong> ${base.avisosInmet
            .map((a) => `${esc(a.descricao)} (${esc(a.severidade)})`)
            .join(" · ")}</div>`
        : ""
    }
    ${
      base.avisos?.length
        ? `<div class="aviso-coleta">${base.avisos.map(esc).join(" · ")}</div>`
        : ""
    }
  </div>`;
}

function renderWeeklyPdfHtml(r) {
  const logos = logosComoDataUri();
  const logoCim = logos.cim
    ? `<div class="logo-cim"><img src="${logos.cim}" alt="CIM" /></div>`
    : "";
  const logoPetrobras = logos.petrobras
    ? `<div class="logo-petrobras"><img src="${logos.petrobras}" alt="Petrobras" /></div>`
    : "";

  const corDiaCritico =
    r.diaMaisCritico?.basesCriticas > 0
      ? "#C0392B"
      : r.diaMaisCritico?.basesAtencao > 0
      ? "#E67E22"
      : "#00843D";

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<style>
  * { box-sizing: border-box; }
  body {
    font-family: ${brand.fontePrincipal};
    color: ${brand.cinzaTexto};
    font-size: 10.5pt;
    margin: 0;
    padding: 0 30px 20px 30px;
  }
  .header {
    background: ${brand.verde};
    color: #fff;
    margin: 0 -30px 0 -30px;
    padding: 16px 30px 14px 30px;
    display: flex;
    align-items: center;
    gap: 20px;
  }
  .logo-cim img { height: 64px; display: block; }
  .header-textos { flex: 1; text-align: center; }
  .header h1 { font-size: 19pt; font-weight: bold; margin: 0; letter-spacing: 0.5px; }
  .header h2 { font-size: 12pt; font-weight: normal; margin: 4px 0 0 0; }
  .logo-petrobras { background: #fff; border-radius: 4px; padding: 5px 11px; line-height: 0; }
  .logo-petrobras img { height: 20px; display: block; }
  .divisor-amarelo { height: 4px; background: ${brand.amarelo}; margin: 0 -30px 16px -30px; }

  h3.secao {
    color: ${brand.verde};
    font-size: 13pt;
    font-weight: bold;
    border-bottom: 2px solid ${brand.verde};
    padding-bottom: 4px;
    margin: 20px 0 10px 0;
  }

  table.cartoes { width: 100%; border-collapse: separate; border-spacing: 8px 0; margin-bottom: 6px; }
  .cartao {
    background: ${brand.cinzaClaro};
    border-radius: 5px;
    padding: 10px 12px;
    text-align: center;
    width: 25%;
  }
  .cartao-rotulo { font-size: 8pt; text-transform: uppercase; letter-spacing: 0.5px; color: #666; }
  .cartao-valor { font-size: 20pt; font-weight: bold; line-height: 1.15; }
  .cartao-detalhe { font-size: 8.5pt; color: #666; }

  .destaque-dia {
    border: 1.5px solid ${brand.amarelo};
    background: #FFFDF2;
    border-radius: 5px;
    padding: 10px 14px;
    margin: 12px 0;
    font-size: 10.5pt;
  }

  .sem-alerta {
    border-left: 5px solid ${brand.verde};
    background: #F1F9F4;
    padding: 12px 16px;
    border-radius: 4px;
  }

  table.tabela-alertas { width: 100%; border-collapse: collapse; font-size: 9.5pt; }
  table.tabela-alertas th {
    background: ${brand.verde}; color: #fff; text-align: left; padding: 6px 8px;
  }
  table.tabela-alertas td { padding: 7px 8px; border-bottom: 1px solid ${brand.cinzaBorda}; vertical-align: top; }
  .alerta-base { font-weight: bold; }
  .alerta-uf { display: block; font-weight: normal; font-size: 8pt; color: #777; }
  .alerta-item { margin-bottom: 4px; }
  .alerta-dia {
    display: inline-block; color: #fff; font-size: 8pt; font-weight: bold;
    padding: 1px 6px; border-radius: 3px; margin-right: 6px; min-width: 58px; text-align: center;
  }

  .legenda { font-size: 8.5pt; color: #666; margin-top: 4px; }
  .legenda span { display: inline-block; margin-right: 14px; }
  .legenda i { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 4px; }

  .base { margin-top: 16px; }
  .quebra-pagina { page-break-before: always; }
  .base-cabecalho {
    display: flex; justify-content: space-between; align-items: center;
    background: ${brand.cinzaClaro}; padding: 9px 14px; border-radius: 4px;
  }
  .base-nome { font-size: 13pt; font-weight: bold; color: ${brand.verdeEscuro}; }
  .base-uf { font-size: 9pt; color: #777; font-weight: normal; }
  .base-resumo { font-size: 9pt; color: #555; margin-top: 2px; }
  .base-situacao { text-align: right; }
  .base-fita { margin-top: 4px; }

  .pastilha {
    display: inline-block; color: #fff; font-size: 8pt; font-weight: bold;
    padding: 2px 8px; border-radius: 10px;
  }
  .pastilha.grande { font-size: 9.5pt; padding: 3px 12px; }

  .base-riscos { font-size: 9.5pt; margin: 7px 0; color: #444; }
  .base-riscos.sem { color: #777; font-style: italic; }

  .grafico { margin: 6px 0 8px 0; }

  table.tabela-dias { width: 100%; border-collapse: collapse; font-size: 9pt; }
  table.tabela-dias th {
    background: ${brand.verde}; color: #fff; text-align: left; padding: 5px 7px; font-size: 8.5pt;
  }
  table.tabela-dias td { padding: 5px 7px; border-bottom: 1px solid ${brand.cinzaBorda}; }
  tr.zebra { background: ${brand.cinzaClaro}; }
  .suave { color: #888; font-size: 8pt; }

  .avisos-inmet {
    border-left: 4px solid ${brand.vermelhoAlerta}; background: #FFF8F0;
    padding: 7px 12px; margin-top: 8px; font-size: 9pt;
  }
  .aviso-coleta {
    border-left: 4px solid #999; background: #F7F7F7;
    padding: 6px 12px; margin-top: 6px; font-size: 8.5pt; color: #666;
  }
  .falhas { border-left: 4px solid ${brand.vermelhoAlerta}; background: #FDF2F1; padding: 8px 14px; font-size: 9pt; }
</style>
</head>
<body>
  <div class="header">
    ${logoCim}
    <div class="header-textos">
      <h1>RELATÓRIO METEOROLÓGICO SEMANAL</h1>
      <h2>Centro Integrado de Monitoramento &nbsp;·&nbsp; ${esc(r.periodoLabel)}</h2>
    </div>
    ${logoPetrobras}
  </div>
  <div class="divisor-amarelo"></div>

  <p style="font-size:9.5pt;color:#555;margin:0 0 12px 0;">
    Gerado em ${esc(r.dataGeracao)} às ${esc(r.horaGeracao)} (Horário de Brasília) ·
    Janela de previsão: <strong>próximos ${r.rotulosDias.length} dias</strong> ·
    ${r.totalBases} bases monitoradas
  </p>

  <h3 class="secao">1. Panorama da Semana</h3>

  <table class="cartoes"><tr>
    ${cartaoResumo("Bases críticas", r.totalBasesCriticas, "#C0392B", "exigem ação preventiva")}
    ${cartaoResumo("Bases em atenção", r.totalBasesAtencao, "#E67E22", "monitorar evolução")}
    ${cartaoResumo("Bases normais", r.totalBasesNormais, "#00843D", "sem evento relevante")}
    ${cartaoResumo("Alertas na semana", r.alertas.length, "#2E86C1", `${r.alertasCriticos.length} críticos`)}
  </tr></table>

  ${
    r.diaMaisCritico
      ? `<div class="destaque-dia">
    <strong>Dia de maior atenção:</strong> ${esc(r.diaMaisCritico.diaSemana)}, ${esc(r.diaMaisCritico.diaMes)} —
    ${r.diaMaisCritico.basesCriticas} base(s) em situação crítica e ${r.diaMaisCritico.basesAtencao} em atenção,
    com rajadas de até ${r.diaMaisCritico.rajadaMaxKmh} km/h e média de ${r.diaMaisCritico.chuvaMediaMm} mm de chuva entre as bases.
  </div>`
      : ""
  }

  <div class="grafico">${svgPanoramaSemana(r.panoramaDias, 700, 150)}</div>
  <div class="legenda">
    <span><i style="background:#C0392B;"></i>Crítico</span>
    <span><i style="background:#E67E22;"></i>Atenção</span>
    <span><i style="background:#00843D;"></i>Normal</span>
    — número de bases em cada situação, por dia.
  </div>

  <h3 class="secao">2. Alertas dos Próximos Dias</h3>
  ${blocoAlertas(r)}

  <h3 class="secao">3. Detalhamento por Base</h3>
  <p style="font-size:9.5pt;color:#666;margin:0 0 4px 0;">
    Bases ordenadas por nível de risco da semana — as que exigem atenção aparecem primeiro.
  </p>
  ${r.basesOrdenadas.map((b, i) => secaoBase(b, i)).join("")}

  ${
    r.basesComFalha.length
      ? `<div class="falhas quebra-pagina"><strong>Bases sem dados nesta edição:</strong>
      ${r.basesComFalha.map((b) => `${esc(b.cidade.nome)} (${esc(b.erro)})`).join(" · ")}</div>`
      : ""
  }
</body>
</html>`;
}

function weeklyFooterTemplate(r) {
  return `<div style="width:100%;font-family:Arial,sans-serif;font-size:7.5pt;color:#666;padding:0 30px;">
    <div style="border-top:2px solid ${brand.amarelo};padding-top:4px;display:flex;justify-content:space-between;">
      <span>Relatório Semanal CIM — gerado automaticamente por ferramenta assistida por IA em ${esc(r.dataGeracao)} às ${esc(r.horaGeracao)}. Sujeito a revisão humana antes de uso operacional. Fontes: Open-Meteo, INMET.</span>
      <span style="white-space:nowrap;margin-left:12px;"><span class="pageNumber"></span>/<span class="totalPages"></span></span>
    </div>
  </div>`;
}

module.exports = { renderWeeklyPdfHtml, weeklyFooterTemplate };
