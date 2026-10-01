const brand = require("./brand");
const { logosComoDataUri, logoPdfComoDataUri } = require("../config/logos");
const { ordenarEventosParaExibicao } = require("./eventOrdering");
const { consolidarAvisosInmet } = require("../sources/inmet");
const { formatarDataBrasilia } = require("../sources/sourceHealth");

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

function corSeveridade(severidade = "") {
  const s = String(severidade).toLowerCase();
  if (s.includes("grande perigo") || s.includes("extreme")) return "#B71C1C";
  if (s.includes("perigo") || s.includes("severe")) return "#D32F2F";
  if (s.includes("atenção") || s.includes("atencao") || s.includes("moderate")) return "#F57C00";
  return "#2E7D32";
}

function visualCard(grau) {
  return grau === "NORMAL" ? { cor: "#2E7D32", fundo: "#E8F5E9" } : brand.statusVisual(grau);
}

function eventosLocais(r) {
  const eventos = r.severidade?.eventos || (r.eventoMaisRelevante ? [r.eventoMaisRelevante] : []);
  return ordenarEventosParaExibicao(
    (Array.isArray(eventos) ? eventos : []).filter((evento) => evento && evento.tipo !== "avisoInmet")
  );
}

function textoOficialHtml(valor) {
  const texto = Array.isArray(valor) ? valor.filter(Boolean).join(" ") : valor;
  return esc(texto).replace(/\r?\n/g, "<br>");
}

function cardEvento({ titulo, grau, descricao, janela, fonteDados, detalhes = "", semFonte = false }) {
  const visual = visualCard(grau);
  return `<div class="evento-card" style="border-color:${visual.cor};background:${visual.fundo};">
    <div class="evento-titulo" style="color:${visual.cor};"><span class="evento-icone">●</span> ${esc(titulo)}</div>
    ${descricao ? `<p class="evento-descricao">${esc(descricao)}</p>` : ""}
    ${detalhes}
    ${janela ? `<p class="evento-linha"><em>Janela prevista:</em> ${esc(janela)}</p>` : ""}
    ${semFonte ? "" : `<p class="evento-linha">Fonte de dados: ${esc(fonteDados || "Indisponível")}</p>`}
  </div>`;
}

function blocoEventoExtremo(r) {
  const eventos = eventosLocais(r);
  if (eventos.length) return eventos.map((evento) => cardEvento(evento)).join("");
  if ((r.severidade?.grau || "NORMAL") !== "NORMAL") return "";
  return cardEvento({
    titulo: "CONDIÇÃO NORMAL",
    grau: "NORMAL",
    descricao: "Não foram identificadas condições meteorológicas que atinjam os níveis de Atenção, Alerta ou Emergência no período analisado.",
    semFonte: true,
  });
}

function blocoRecomendacoesPorFenomeno(r) {
  const grupos = eventosLocais(r)
    .filter((evento) => Array.isArray(evento.recomendacoes) && evento.recomendacoes.length)
    .map((evento) => ({
      nome: String(evento.titulo || evento.tipo).split(/\s+—\s+/).slice(-1)[0],
      grau: evento.grau,
      itens: evento.recomendacoes,
    }));
  const calor = r.climaSaude?.dados;
  if (calor?.recomendacoes?.length) grupos.push({ nome: "CALOR / RISCO À SAÚDE", grau: calor.nivel?.grau, itens: calor.recomendacoes });
  if (!grupos.length) return "";
  return `<h4 class="subsecao">Recomendações - Protocolo Meteorológico do COMPARTILHADO</h4>
    ${grupos.map((grupo) => `<div class="recomendacao-grupo">
      <strong style="color:${visualCard(grupo.grau).cor};">${esc(grupo.nome)}:</strong>
      ${listaHtml(grupo.itens)}
    </div>`).join("")}`;
}

function blocoDivergencias(divergencias) {
  if (!divergencias || divergencias.length === 0) return "";
  return `<div class="warning-box">
    <strong>⚠ Ressalva sobre divergência entre fontes</strong>
    ${listaHtml(divergencias)}
  </div>`;
}

function blocoAvisosColeta(r) {
  const windyValido = (r.fontesAutomatizadas || r.fontes || []).some((fonte) => /^Windy\b/i.test(fonte.nome || ""));
  const avisosColeta = [...new Set((r.avisosColeta || [])
    .filter((aviso) => typeof aviso === "string" && aviso.trim())
    .filter((aviso) => windyValido || !/^Windy\b/i.test(aviso.trim()))
    .map((aviso) => aviso.trim()))];
  if (!avisosColeta.length) return "";
  return `<div class="warning-box">
    <strong>⚠ Avisos de coleta automática</strong>
    ${listaHtml(avisosColeta)}
  </div>`;
}

function blocoAvisosInmet(avisos) {
  const consolidados = consolidarAvisosInmet(avisos);
  if (!consolidados.length) return "";
  return consolidados
    .map(
      (a) => {
        const evento = a.event || a.evento || a.descricao || a.headline;
        const severidade = a.severity || a.severidade;
        const inicio = a.onset || a.inicio;
        const fim = a.expires || a.fim;
        const motivo = a.description || a.riscos;
        const instrucoes = a.instruction || a.instrucoes;
        const cor = corSeveridade(severidade);
        return `<div class="aviso-inmet evento-card" style="border-color:${cor};background:#FFF8F0;">
        <div class="evento-titulo" style="color:${cor};"><span class="evento-icone">●</span> Aviso oficial INMET</div>
        <p class="evento-descricao"><strong>${esc(evento)}</strong> — <strong style="color:${cor};">${esc(severidade)}</strong></p>
        ${(inicio || fim) ? `<p class="evento-linha"><strong>Vigência:</strong> ${esc(inicio)} até ${esc(fim)}</p>` : ""}
        <p class="evento-linha"><strong>Fonte de dados:</strong> INMET</p>
        ${motivo?.length ? `<p class="evento-linha"><strong>Motivo do aviso:</strong> ${textoOficialHtml(motivo)}</p>` : ""}
        ${instrucoes?.length ? `<p class="evento-linha"><strong>Instruções oficiais:</strong> ${textoOficialHtml(instrucoes)}</p>` : ""}
      </div>`;
      }
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
  ${mar.desatualizado ? `<p class="nota"><strong>Dado armazenado.</strong> Última atualização válida: ${esc(formatarDataBrasilia(mar.ultimaAtualizacao) || "horário indisponível")}.</p>` : ""}
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
  const linhasParticulado = [
    qa.pm25Medio == null ? "" : `<tr class="zebra">
      <td>Material particulado inalável (PM2,5)</td>
      <td>${qa.pm25Medio} µg/m³</td>
      <td>—</td>
      <td>Diretriz OMS 2021: até 15 µg/m³</td>
    </tr>`,
    qa.pm10Medio == null ? "" : `<tr>
      <td>Material particulado inalável (PM10)</td>
      <td>${qa.pm10Medio} µg/m³</td>
      <td>—</td>
      <td>Diretriz OMS 2021: até 45 µg/m³</td>
    </tr>`,
  ].join("");
  return `<h4 class="subsecao">Qualidade do Ar e Índice UV</h4>
  <table>
    <thead><tr><th>Indicador</th><th>Valor</th><th>Classificação</th><th>Referência</th></tr></thead>
    <tbody>
      <tr>
        <td>QUALIDADE DO AR</td>
        <td></td>
        <td>${esc(qa.pm25Classificacao?.nivel)}</td>
        <td></td>
      </tr>
      ${linhasParticulado}
      <tr class="zebra">
        <td>Índice UV (máximo do dia)</td>
        <td>${qa.uvMax ?? "—"}${qa.horaPicoUv ? ` (pico ~${esc(qa.horaPicoUv)})` : ""}</td>
        <td>${esc(qa.uvClassificacao?.nivel)}</td>
        <td>Faixas OMS: 8+ muito alto, 11+ extremo</td>
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
  }
  ${blocoDivergencias(r.divergencias)}`;
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

function blocoClimaSaude(r) {
  const integracao = r.climaSaude;
  if (!integracao) return '';
  const dados = integracao.dados;
  if (!dados) return `<p class="clima-indisponivel">${esc(integracao.mensagem || "Dados do Clima e Saúde indisponíveis nesta atualização.")}</p>`;
  const nivel = dados.nivel || { grau: "NORMAL" };
  const temperatura = dados.temperatura || {};
  const previsao = (dados.previsaoDias || []).map((dia) => `<li>${esc(dia.data)}: EHF ${esc(dia.classificacao)}; máxima ${dia.tempMax == null ? 'indisponível' : `${esc(dia.tempMax)} °C`}</li>`).join('');
  const detalhes = `<p class="evento-linha">Temperatura média: ${temperatura.media == null ? 'indisponível' : `${esc(temperatura.media)} °C`}</p>
    <p class="evento-linha">Temperatura máxima prevista: ${temperatura.maxima == null ? 'indisponível' : `${esc(temperatura.maxima)} °C`}</p>
    <p class="evento-linha">Temperatura mínima: ${temperatura.minima == null ? 'indisponível' : `${esc(temperatura.minima)} °C`}</p>
    <p class="evento-linha">RISCO COMBINADO À SAÚDE: ${esc(dados.riscoCombinado)}</p>
    <p class="evento-linha">GeoSES / vulnerabilidade social: ${dados.geoses?.valor == null ? 'indisponível' : esc(dados.geoses.valor)}${dados.geoses?.classificacao ? ` (${esc(dados.geoses.classificacao)})` : ''}</p>
    <p class="evento-linha">Consulta: ${esc(dados.consultadoEm)}${integracao.status === 'armazenado' ? ' — última coleta válida armazenada' : ''}</p>
    ${previsao ? `<div class="evento-linha"><strong>Previsão Clima e Saúde</strong><ul>${previsao}</ul></div>` : ''}`;
  return cardEvento({
    titulo: `${nivel.grau} — CALOR / RISCO À SAÚDE${nivel.protocolo ? ` ${nivel.protocolo}` : ''}`,
    grau: nivel.grau,
    descricao: `EHF: ${dados.ehf?.classificacao || "Indisponível"}${dados.ehf?.valor == null ? '' : ` (${dados.ehf.valor})`}`,
    fonteDados: dados.source,
    detalhes,
  });
}

function renderPdfHtml(r) {
  const logos = logosComoDataUri();
  const logoPdf = logoPdfComoDataUri();
  const logoCimHtml = logoPdf
    ? `<div class="header-logo-cim"><img src="${logoPdf}" alt="CIM — Centro Integrado de Monitoramento COMPARTILHADO" /></div>`
    : `<div class="header-logo-cim"><div class="header-logo-cim-fallback"><strong>CIM</strong><div class="header-logo-cim-texto"><span>Centro Integrado de Monitoramento</span><span>COMPARTILHADO</span></div></div></div>`;
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
  .evento-card {
    width: 100%;
    border: 1.5px solid;
    border-left-width: 5px;
    border-radius: 5px;
    padding: 18px 20px;
    margin: 16px 0;
    font-size: 10.5pt;
    line-height: 1.55;
    break-inside: avoid;
    page-break-inside: avoid;
    -webkit-column-break-inside: avoid;
  }
  .evento-titulo {
    font-size: 15pt;
    font-weight: 700;
    line-height: 1.4;
    margin: 0 0 12px 0;
  }
  .evento-icone { font-size: 11pt; vertical-align: 1px; }
  .evento-descricao { margin: 0 0 10px 0; line-height: 1.55; }
  .evento-linha { margin: 8px 0 0 0; line-height: 1.55; }
  .evento-linha ul { margin-bottom: 0; }
  .recomendacao-grupo { margin: 12px 0; break-inside: avoid; page-break-inside: avoid; }
  .recomendacao-grupo ul { margin: 5px 0 0 0; }
  .clima-indisponivel { color: #666; font-size: 10pt; margin: 12px 0; }
  .warning-box {
    border-left: 4px solid ${brand.vermelhoAlerta};
    background: #FDF2F1;
    padding: 8px 14px;
    margin: 14px 0;
    font-size: 10pt;
  }
  .aviso-inmet { break-inside: avoid; page-break-inside: avoid; }
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

  <h4 class="subsecao">Temperatura e umidade</h4>
  ${tabelaTemperatura(r.tabelaTemperaturaUmidade)}

  <h4 class="subsecao">Vento por período</h4>
  ${tabelaVento(r.ventoPorPeriodo)}

  <h4 class="subsecao">Chuva por período</h4>
  ${tabelaChuva(r.chuvaPorPeriodo)}

  ${tabelaMar(r.mar)}
  ${tabelaQualidadeAr(r.qualidadeAr)}
  ${blocoEventoExtremo(r)}
  ${blocoClimaSaude(r)}
  ${blocoAvisosInmet(r.avisosInmet)}
  ${blocoRecomendacoesPorFenomeno(r)}
  ${blocoAvisosColeta(r)}

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
