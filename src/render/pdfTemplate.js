const brand = require("./brand");
const { logosComoDataUri, logoPdfComoDataUri } = require("../config/logos");

function esc(valor) {
  if (valor === null || valor === undefined) return "—";
  return String(valor)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escAtributo(valor) {
  return esc(valor).replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function listaHtml(itens) {
  return `<ul>${itens.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>`;
}

function blocoRecomendacoes(itens) {
  if (!itens?.length) return "";
  return `<p class="titulo-recomendacao"><strong>Recomendações - Protocolo Meteorológico do COMPARTILHADO</strong></p>${listaHtml(itens)}`;
}

function corSeveridade(severidade = "") {
  const s = severidade.toLowerCase();
  if (s.includes("grande perigo")) return "#7B241C";
  if (s.includes("perigo")) return brand.vermelhoAlerta;
  if (s.includes("atenção") || s.includes("atencao")) return "#B9770E";
  return brand.verde;
}

function blocoEventoExtremo(r) {
  const grau = r.severidade?.grau || r.eventoMaisRelevante?.grau || "NORMAL";
  const visual = brand.statusVisual(grau);
  const eventos = (r.severidade?.eventos || (r.eventoMaisRelevante ? [r.eventoMaisRelevante] : []))
    .filter((evento, indice) => indice === 0 || evento.tipo !== "avisoInmet");

  if (grau === "NORMAL" || eventos.length === 0) {
    return `<div class="highlight condicao-normal" style="border-color:${visual.cor};background:${visual.fundo};">
      <strong style="color:${visual.cor};">CONDIÇÃO NORMAL</strong>
      <p>Não foram identificadas condições meteorológicas que atinjam os níveis de Atenção, Alerta ou Emergência no período analisado.</p>
    </div>`;
  }

  const evento = eventos[0];
  const icone = grau === "ATENÇÃO" ? "⚠" : "🚨";
  const partesTitulo = String(evento.titulo || "").split(/\s+—\s+/);
  const fenomeno = partesTitulo.length > 1 ? partesTitulo.slice(1).join(" — ") : evento.titulo;
  const recomendacoesEvento = blocoRecomendacoes(evento.recomendacoes);
  const demaisEventos = eventos
    .slice(1)
    .map((outro) => `<div class="evento-secundario">
      <strong>${esc(outro.titulo)}</strong>
      <p>${esc(outro.descricao)}</p>
      <p class="severidade-janela"><em>Janela prevista:</em> ${esc(outro.janela)}</p>
      <p class="severidade-fonte">Fonte de dados: ${esc(outro.fonteDados || (outro.tipo === "avisoInmet" ? "INMET — aviso oficial" : "Consulte as fontes por campo"))}</p>
      ${blocoRecomendacoes(outro.recomendacoes)}
    </div>`)
    .join("");

  return `<div class="highlight bloco-severidade" style="border-color:${visual.cor};background:${visual.fundo};">
    <div class="severidade-cabecalho" aria-label="${escAtributo(evento.titulo)}">
      <div class="severidade-linha">
        <div class="severidade-grau" style="color:${visual.cor};">${icone} ${esc(grau)}</div>
      </div>
      <div class="severidade-fenomeno">${esc(fenomeno)}</div>
      <p class="severidade-descricao">${esc(evento.descricao)}</p>
      <p class="severidade-janela"><em>Janela prevista:</em> ${esc(evento.janela)}</p>
      <p class="severidade-fonte">Fonte de dados: ${esc(evento.fonteDados || (evento.tipo === "avisoInmet" ? "INMET — aviso oficial" : "Consulte as fontes por campo"))}</p>
    </div>
    ${recomendacoesEvento}
    ${demaisEventos}
  </div>`;
}

function blocoDivergencias(divergencias) {
  if (!divergencias || divergencias.length === 0) return "";
  return `<div class="warning-box">
    <strong>⚠ Ressalva sobre divergência entre fontes</strong>
    ${listaHtml(divergencias)}
  </div>`;
}

function blocoAvisosColeta(avisosColeta) {
  if (!avisosColeta || avisosColeta.length === 0) return "";
  return `<div class="warning-box">
    <strong>⚠ Avisos de coleta automática</strong>
    ${listaHtml(avisosColeta)}
  </div>`;
}

function blocoAvisosInmet(avisos) {
  if (!avisos || avisos.length === 0) return "";
  return `<h4 class="subsecao">Aviso oficial INMET</h4>` + avisos
    .map(
      (a) => `<div class="aviso-inmet" style="border-left-color:${corSeveridade(a.severidade)}">
        <strong>${esc(a.descricao)}</strong> — <span style="color:${corSeveridade(a.severidade)}">${esc(a.severidade)}</span>
        <div class="aviso-janela">Vigência: ${esc(a.inicio)} até ${esc(a.fim)}</div>
        <div class="aviso-fonte">Fonte de dados: INMET</div>
        ${a.riscos?.length ? `<div class="aviso-motivo"><strong>Motivo do aviso:</strong> ${esc(a.riscos.filter(Boolean).join(" "))}</div>` : ""}
      </div>`
    )
    .join("");
}

function tabelaTemperatura(linhas) {
  return `<table>
    <thead><tr><th>Fonte</th><th>Temp. Mínima</th><th>Temp. Máxima</th><th>Umidade Mínima</th><th>Umidade Máxima</th></tr></thead>
    <tbody>
      ${linhas
        .map(
          (l, i) => `<tr class="${i % 2 === 1 ? "zebra" : ""}">
            <td>${esc(l.fonte)}</td><td>${esc(l.tempMin)}°C</td><td>${esc(l.tempMax)}°C</td>
            <td>${esc(l.umidadeMin)}${l.umidadeMin !== "—" ? "%" : ""}</td><td>${esc(l.umidadeMax)}${l.umidadeMax !== "—" ? "%" : ""}</td>
          </tr>`
        )
        .join("")}
    </tbody>
  </table>`;
}

function tabelaVento(periodos) {
  return `<table>
    <thead><tr><th>Período</th><th>Direção</th><th>Intensidade</th><th>Rajada prevista</th><th>Referência INMET</th></tr></thead>
    <tbody>
      ${periodos
        .map(
          (p, i) => `<tr class="${i % 2 === 1 ? "zebra" : ""}">
            <td>${esc(p.periodo)}</td><td>${esc(p.direcao)}</td><td>${esc(p.intensidade)}</td>
            <td>${p.rajadaMaxKmh == null ? "—" : p.rajadaMaxKmh + " km/h"}</td><td>${esc(p.referenciaInmet)}</td>
          </tr>`
        )
        .join("")}
    </tbody>
  </table>`;
}

function tabelaChuva(periodos) {
  return `<table>
    <thead><tr><th>Período</th><th>Probabilidade (Open-Meteo)</th><th>Acumulado estimado</th><th>Resumo INMET</th></tr></thead>
    <tbody>
      ${periodos
        .map(
          (p, i) => `<tr class="${i % 2 === 1 ? "zebra" : ""}">
            <td>${esc(p.periodo)}</td>
            <td>${p.probabilidade == null ? "—" : p.probabilidade + "%"}</td>
            <td>${p.precipitacaoMm == null ? "—" : p.precipitacaoMm + " mm"}</td>
            <td>${esc(p.resumoInmet)}</td>
          </tr>`
        )
        .join("")}
    </tbody>
  </table>`;
}

function tabelaMar(mar) {
  if (!mar?.periodos?.length) return "";
  return `<h4 class="subsecao">Condições de mar${mar.referenciaPonto ? ` (ponto de referência: ${esc(mar.referenciaPonto)})` : ""}</h4>
  <table>
    <thead><tr><th>Período</th><th>Estado do mar</th><th>Altura máx.</th><th>Período de onda</th><th>Direção</th><th>Marulho</th></tr></thead>
    <tbody>
      ${mar.periodos
        .map(
          (p, i) => `<tr class="${i % 2 === 1 ? "zebra" : ""}">
            <td>${esc(p.periodo)}</td><td>${esc(p.estadoMar)}</td>
            <td>${p.alturaMaxM == null ? "—" : p.alturaMaxM + " m"}</td>
            <td>${p.periodoOndaS == null ? "—" : p.periodoOndaS + " s"}</td>
            <td>${esc(p.direcaoOnda)}</td>
            <td>${p.marulhoMaxM == null ? "—" : p.marulhoMaxM + " m"}</td>
          </tr>`
        )
        .join("")}
    </tbody>
  </table>
  ${mar.temperaturaMarC != null ? `<p style="font-size:10pt;">Temperatura média da superfície do mar: <strong>${mar.temperaturaMarC}°C</strong>.</p>` : ""}`;
}

function tabelaQualidadeAr(qa) {
  if (!qa) return "";
  return `<h4 class="subsecao">Índice UV e Qualidade do Ar</h4>
  <table>
    <thead><tr><th>Indicador</th><th>Valor</th><th>Classificação</th><th>Referência</th></tr></thead>
    <tbody>
      <tr>
        <td>Índice UV (máximo do dia)</td>
        <td>${qa.uvMax ?? "—"}${qa.horaPicoUv ? ` (pico ~${esc(qa.horaPicoUv)})` : ""}</td>
        <td>${esc(qa.uvClassificacao?.nivel)}</td>
        <td>Faixas OMS: 8+ muito alto, 11+ extremo</td>
      </tr>
      <tr class="zebra">
        <td>Material particulado fino (PM2,5)</td>
        <td>${qa.pm25Medio == null ? "—" : qa.pm25Medio + " µg/m³"}</td>
        <td>${esc(qa.pm25Classificacao?.nivel)}</td>
        <td>Diretriz OMS 2021: até 15 µg/m³</td>
      </tr>
      <tr>
        <td>Material particulado inalável (PM10)</td>
        <td>${qa.pm10Medio == null ? "—" : qa.pm10Medio + " µg/m³"}</td>
        <td>—</td>
        <td>Diretriz OMS 2021: até 45 µg/m³</td>
      </tr>
    </tbody>
  </table>`;
}

// Fontes apresentadas em tabela, por nome e uso — sem URL: as chamadas de
// API trazem a query completa e poluíam o documento sem servir ao leitor.
function blocoFontes(r) {
  // Relatórios antigos (antes da separação em dois grupos) só tinham `fontes`.
  const automatizadas = r.fontesAutomatizadas || r.fontes || [];
  const manuais = r.fontesManuais || [];

  const linhas = (lista) =>
    lista
      .map(
        (f, i) => `<tr class="${i % 2 === 1 ? "zebra" : ""}">
          <td style="width:32%;"><strong>${esc(f.nome)}</strong></td>
          <td>${esc(f.uso || "")}</td>
        </tr>`
      )
      .join("");

  return `<h4 class="subsecao">Fontes Consultadas</h4>
  ${
    automatizadas.length
      ? `<p style="font-size:10pt;margin:6px 0 4px 0;"><strong>Integradas à coleta automática:</strong></p>
  <table>
    <thead><tr><th>Fonte</th><th>Uso neste informativo</th></tr></thead>
    <tbody>${linhas(automatizadas)}</tbody>
  </table>`
      : ""
  }
  ${
    manuais.length
      ? `<p style="font-size:10pt;margin:10px 0 4px 0;"><strong>Verificação manual (não integradas):</strong></p>
  <table>
    <thead><tr><th>Fonte</th><th>Observação</th></tr></thead>
    <tbody>${linhas(manuais)}</tbody>
  </table>`
      : ""
  }`;
}

function blocoPrevisaoAgendada(r) {
  if (!r.previsaoDias?.length) return "";
  const linhas = r.previsaoDias.map((dia, i) => `<tr class="${i % 2 ? "zebra" : ""}">
    <td>${esc(dia.periodo)}<br/><small>${esc(dia.data)}</small></td>
    <td>${esc(dia.condicao)}</td>
    <td>${dia.tempMin == null ? "—" : `${esc(dia.tempMin)}°C`} / ${dia.tempMax == null ? "—" : `${esc(dia.tempMax)}°C`}</td>
    <td>${dia.chuvaMm == null ? "—" : `${esc(dia.chuvaMm)} mm`}</td>
    <td>${dia.rajadaKmh == null ? "—" : `${esc(dia.rajadaKmh)} km/h`}</td>
  </tr>`).join("");
  return `<h4 class="subsecao">Previsão por dia — ${esc(r.periodoCoberto)}</h4>
    <p class="fontes">Fonte de dados: Open-Meteo. Para hoje, chuva e rajada consideram apenas a janela indicada; os dias seguintes usam previsão diária.</p>
    <table><thead><tr><th>Período</th><th>Condição</th><th>Temperatura mín./máx.</th><th>Chuva</th><th>Rajada prevista</th></tr></thead><tbody>${linhas}</tbody></table>`;
}

function blocoMudancasDia(r) {
  if (!r.mudancasDia) return "";
  return `<h4 class="subsecao">Mudanças do dia em relação ao relatório das 05:00</h4>${listaHtml(r.mudancasDia)}`;
}

function renderPdfHtml(r) {
  const logos = logosComoDataUri();
  const logoPdf = logoPdfComoDataUri();
  const logoCimHtml = logoPdf
    ? `<div class="header-logo-cim"><img src="${logoPdf}" alt="CIM — Centro integrado de monitoramento compartilhado" /></div>`
    : `<div class="header-logo-cim"><div class="header-logo-cim-fallback"><strong>CIM</strong><div class="header-logo-cim-texto"><span>Centro integrado de monitoramento</span><span>compartilhado</span></div></div></div>`;
  const logoPetrobrasHtml = logos.petrobras
    ? `<div class="header-logo-petrobras"><img src="${logos.petrobras}" alt="Petrobras" /></div>`
    : `<div class="logo-placeholder">[ESPAÇO RESERVADO PARA LOGO OFICIAL — inserir manualmente via modelo corporativo aprovado]</div>`;

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<style>
  * { box-sizing: border-box; }
  html { background: #ffffff; }
  body {
    font-family: ${brand.fontePrincipal};
    color: ${brand.cinzaTexto};
    background: #ffffff;
    font-size: 11pt;
    line-height: 1.45;
    margin: 0;
    padding: 0 36px 20px 36px;
  }
  .header {
    background: ${brand.verde};
    color: #ffffff;
    margin: 0 -36px 0 -36px;
    padding: 20px 28px;
    min-height: 112px;
    display: grid;
    grid-template-columns: 200px minmax(0, 1fr) 125px;
    column-gap: 14px;
    align-items: center;
  }
  .header-center {
    min-width: 0;
    text-align: center;
  }
  .header h1 {
    font-size: 19pt;
    font-weight: bold;
    text-align: center;
    margin: 0;
    line-height: 1.18;
    letter-spacing: 0.25px;
  }
  .header h2 {
    font-size: 11pt;
    font-weight: normal;
    text-align: center;
    line-height: 1.35;
    margin: 9px 0 0 0;
  }
  .logo-placeholder {
    font-size: 7pt;
    color: #E4F2E9;
    border: 1px dashed #E4F2E9;
    padding: 8px;
    border-radius: 3px;
    text-align: center;
  }
  .header-logo-cim {
    width: 200px;
    min-height: 78px;
    display: flex;
    align-items: center;
  }
  .header-logo-cim img {
    width: 100%;
    height: auto;
    display: block;
    mix-blend-mode: lighten;
  }
  .header-logo-cim-fallback {
    color: #ffffff;
    width: 200px;
    line-height: 1.25;
    padding: 10px 11px 11px 12px;
    border-left: 3px solid ${brand.amarelo};
    background: rgba(0, 0, 0, 0.12);
  }
  .header-logo-cim-fallback strong { display: block; font-size: 19pt; letter-spacing: -0.5px; line-height: 1; }
  .header-logo-cim-texto { margin-top: 7px; border-top: 1px solid rgba(255,255,255,.5); padding-top: 5px; }
  .header-logo-cim-texto span { display: block; font-size: 7pt; margin-top: 2px; }
  .header-logo-petrobras {
    width: 125px;
    min-height: 48px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #ffffff;
    border-radius: 4px;
    padding: 8px 10px;
  }
  .header-logo-petrobras img { width: 100%; height: auto; max-height: 32px; object-fit: contain; display: block; }
  .divisor-amarelo {
    height: 4px;
    background: ${brand.amarelo};
    margin: 0 -36px 20px -36px;
  }
  h3.secao {
    color: ${brand.verde};
    font-weight: bold;
    font-size: 14pt;
    border-bottom: 2px solid ${brand.verde};
    padding-bottom: 4px;
    margin-top: 26px;
  }
  h4.subsecao {
    font-weight: bold;
    font-size: 12pt;
    margin-bottom: 8px;
    margin-top: 20px;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    margin: 10px 0 14px 0;
    font-size: 10pt;
  }
  th {
    background: ${brand.verde};
    color: #ffffff;
    text-align: left;
    padding: 8px 9px;
  }
  td {
    padding: 8px 9px;
    border-bottom: 1px solid ${brand.cinzaBorda};
  }
  tr.zebra { background: ${brand.cinzaClaro}; }
  .highlight {
    border: 1.5px solid ${brand.amarelo};
    background: #FFFDF2;
    border-radius: 4px;
    padding: 10px 14px;
    margin: 14px 0;
  }
  .bloco-severidade {
    border-width: 2px;
    padding: 20px 22px;
    margin: 24px 0 22px 0;
    box-decoration-break: clone;
    -webkit-box-decoration-break: clone;
  }
  .severidade-cabecalho {
    break-inside: avoid;
    page-break-inside: avoid;
  }
  .severidade-grau {
    display: block;
    font-size: 18pt;
    font-weight: 700;
    line-height: 1.3;
    letter-spacing: 0.4px;
    margin: 2px 0 16px 0;
  }
  .severidade-linha { display: flex; align-items: baseline; justify-content: space-between; gap: 14px; }
  .severidade-fenomeno {
    font-size: 13pt;
    font-weight: 700;
    line-height: 1.4;
    margin: 0 0 14px 0;
  }
  .severidade-fonte { font-size: 9pt; font-weight: 600; color: #555; margin: 0 0 14px 0; line-height: 1.5; }
  .severidade-descricao { margin: 0 0 14px 0; line-height: 1.6; }
  .severidade-janela { margin: 0 0 12px 0; line-height: 1.5; }
  .titulo-recomendacao { margin: 22px 0 12px 0; line-height: 1.5; }
  .bloco-severidade ul { margin: 10px 0 18px 0; }
  .bloco-severidade li { margin-bottom: 9px; line-height: 1.6; }
  .condicao-normal { margin: 14px 0; }
  .evento-secundario {
    border-top: 1px solid ${brand.cinzaBorda};
    margin-top: 20px;
    padding-top: 18px;
    line-height: 1.55;
  }
  .warning-box {
    border-left: 4px solid ${brand.vermelhoAlerta};
    background: #FDF2F1;
    padding: 8px 14px;
    margin: 14px 0;
    font-size: 10pt;
  }
  .aviso-inmet {
    border-left: 4px solid ${brand.vermelhoAlerta};
    background: #FFF8F0;
    padding: 16px 18px;
    margin: 16px 0;
    font-size: 10pt;
    line-height: 1.55;
  }
  .aviso-janela { font-size: 9pt; color: #666; margin: 8px 0; }
  .aviso-fonte { font-size: 9pt; color: #555; margin: 8px 0; }
  .aviso-motivo { margin-top: 10px; line-height: 1.6; }
  ul { margin: 8px 0 14px 0; padding-left: 20px; }
  li { margin-bottom: 6px; line-height: 1.45; }
  .fontes { font-size: 9pt; color: #555; margin-top: 10px; }
  .fontes ul { padding-left: 16px; }
  .fontes a { color: ${brand.verdeEscuro}; }
</style>
</head>
<body>
  <div class="header">
    ${logoCimHtml}
    <div class="header-center">
      <h1>INFORMATIVO METEOROLÓGICO</h1>
      <h2>${esc(r.cidade.nome)} — ${esc(r.cidade.uf)} — ${esc(r.dataFormatadaLonga)}</h2>
    </div>
    ${logoPetrobrasHtml}
  </div>
  <div class="divisor-amarelo"></div>

  <p><strong>Data da previsão:</strong> ${esc(r.dataFormatadaCurta)} &nbsp;|&nbsp; <strong>Hora da consulta:</strong> ${esc(r.horaConsulta)} (Horário de Brasília)</p>
  ${r.periodoCoberto ? `<p><strong>Período coberto:</strong> ${esc(r.periodoCoberto)}.</p>` : ""}
  ${blocoMudancasDia(r)}

  <h3 class="secao">1. Previsão</h3>
  ${blocoPrevisaoAgendada(r)}
  <p><strong>Condição geral do céu:</strong> ${esc(r.condicaoGeral)}</p>

  <h4 class="subsecao">Temperatura e umidade</h4>
  ${tabelaTemperatura(r.tabelaTemperaturaUmidade)}

  <h4 class="subsecao">Vento por período</h4>
  ${tabelaVento(r.ventoPorPeriodo)}

  <h4 class="subsecao">Chuva por período</h4>
  ${tabelaChuva(r.chuvaPorPeriodo)}

  ${tabelaMar(r.mar)}
  ${tabelaQualidadeAr(r.qualidadeAr)}

  ${blocoEventoExtremo(r)}
  ${blocoAvisosInmet(r.avisosInmet)}
  ${blocoDivergencias(r.divergencias)}
  ${blocoAvisosColeta(r.avisosColeta)}

  ${blocoFontes(r)}

  <h3 class="secao">2. Recomendações de Segurança — Deslocamento</h3>
  <p>Considerando o horário da consulta (${esc(r.horaConsulta)}), as recomendações abaixo projetam os riscos meteorológicos para o restante do dia.</p>

  <h4 class="subsecao">a) Pedestres</h4>
  ${listaHtml(r.deslocamento.pedestres)}
  <h4 class="subsecao">b) Transporte Público</h4>
  ${listaHtml(r.deslocamento.transporte)}
  <h4 class="subsecao">c) Condutores de Veículo Próprio</h4>
  ${listaHtml(r.deslocamento.condutores)}

  <h3 class="secao">3. Recomendações de Segurança — Edificação e Ocupantes</h3>
  ${r.edificacao
    .map(
      (secao) => `<h4 class="subsecao">${esc(secao.titulo)}</h4>${listaHtml(secao.itens)}`
    )
    .join("")}

</body>
</html>`;
}

function headerTemplateVazio() {
  return `<div></div>`;
}

function footerTemplate(r) {
  // Só as fontes efetivamente integradas entram no rodapé — citar as de
  // verificação manual aqui daria a entender que foram consultadas.
  const fontesResumo = (r.fontesAutomatizadas || r.fontes || [])
    .slice(0, 3)
    .map((f) => f.nome.split("—")[0].trim())
    .join(", ");
  return `<div style="width:100%;font-family:Arial,sans-serif;font-size:7.5pt;color:#666;padding:0 36px;">
    <div style="border-top:2px solid ${brand.amarelo};padding-top:4px;display:flex;justify-content:space-between;">
      <span>Documento gerado automaticamente por ferramenta de geração assistida por IA em ${esc(r.dataFormatadaCurta)} às ${esc(r.horaConsulta)}. Sujeito a revisão humana antes de uso operacional. Fontes: ${esc(fontesResumo)} e outras listadas no corpo do documento.</span>
      <span style="white-space:nowrap;margin-left:12px;"><span class="pageNumber"></span>/<span class="totalPages"></span></span>
    </div>
  </div>`;
}

module.exports = { renderPdfHtml, headerTemplateVazio, footerTemplate, esc };
