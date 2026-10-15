const { esc } = require("./pdfTemplate");
const { renderDailyChanges, renderEmailHeader, renderEmailHeaderStyles } = require("./emailComponents");
const { montarCardsAlerta, visualNivel } = require("./alertCards");
const { formatarDataBrasilia } = require("../sources/sourceHealth");
const { cartaoCorRioEmail } = require("./corRioEmail");
const AlertTitle = require("../../public/alert-title");
const { calorPorData, dataLocal, ROTULOS_CALOR } = require("../logic/calorPorData");
const { TIPOS_DOCUMENTO, alertaExibivel } = require("../logic/alertPresentation");
const { apresentarQualidadeAr, apresentarIndiceUv } = require("./indicatorPresentation");

// Corpo do e-mail em fundo branco explícito (body, tabelas e células recebem
// bgcolor + background) para que nenhum cliente herde áreas escuras. Só o
// cabeçalho institucional verde mantém texto branco.
const COR = {
  fundo: "#FFFFFF",
  painel: "#FFFFFF",
  celula: "#FFFFFF",
  texto: "#222222",
  secundario: "#5F6B66",
  borda: "#D5DBD8",
  verde: "#00843D",
  amarelo: "#FFCC00",
};

const ESTILO_REFERENCIA_EMAIL = `background:${COR.painel};padding:0 5px;color:${COR.texto};font-family:Arial,sans-serif;font-size:16px;font-weight:normal;line-height:1.4;`;

function presente(valor) {
  return valor !== null && valor !== undefined && valor !== "";
}

function texto(valor) {
  return presente(valor) ? esc(valor) : "—";
}

function numeroUnidade(valor, unidade) {
  return Number.isFinite(valor) ? `${esc(valor)} ${unidade}` : "—";
}

function parOuTraco(minimo, maximo, sufixoMin, sufixoMax) {
  if (!Number.isFinite(minimo) && !Number.isFinite(maximo)) return "—";
  return `${Number.isFinite(minimo) ? `${esc(minimo)}${sufixoMin}` : "—"} / ${Number.isFinite(maximo) ? `${esc(maximo)}${sufixoMax}` : "—"}`;
}

function rajadaMaxima(r) {
  const periodos = Array.isArray(r.ventoPorPeriodo) ? r.ventoPorPeriodo : [];
  const validos = periodos.filter((p) => Number.isFinite(p?.rajadaMaxKmh));
  if (!validos.length) return { valor: null, periodo: null };
  const maximo = validos.reduce((maior, atual) => atual.rajadaMaxKmh > maior.rajadaMaxKmh ? atual : maior);
  return { valor: maximo.rajadaMaxKmh, periodo: maximo.periodo };
}


function celulaMetrica(rotulo, valor, ultimaColuna = false, detalhe = "") {
  return `<td width="33.33%" valign="middle" align="center" bgcolor="${COR.celula}" style="width:33.33%;background:${COR.celula};border-right:${ultimaColuna ? "0" : `1px solid ${COR.borda}`};border-bottom:1px solid ${COR.borda};padding:13px 8px 12px;text-align:center;overflow-wrap:anywhere;word-break:break-word;">
    <div style="color:${COR.secundario};font:13px/1.3 Arial,sans-serif;text-transform:uppercase;">${rotulo}</div>
    <div class="email-metric-value" style="color:${COR.texto};font:bold 25px/1.2 Arial,sans-serif;margin-top:3px;overflow-wrap:anywhere;word-break:break-word;">${valor}</div>
    ${detalhe ? `<div style="color:${COR.secundario};font:12px/1.35 Arial,sans-serif;margin-top:4px;">${esc(detalhe)}</div>` : ""}
  </td>`;
}

// A janela da previsão depende da edição (horário agendado), não da hora em
// que o e-mail é aberto.
function frasePrevisao(r) {
  if (!r.horarioAgendado || !r.previsaoAte) return "";
  return `Previsão até as ${r.previsaoAte}`;
}

// Linha acima dos cards: "Hora da consulta" à esquerda e a janela da previsão
// fora do card, centralizada sobre a 3ª coluna. As colunas
// 66,67% + 33,33% espelham a tabela de cards, inclusive no Outlook.
function linhaReferencia(r) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${COR.painel}" style="width:100%;background:${COR.painel};border-collapse:collapse;">
    <tr>
      <td width="66.67%" valign="bottom" align="left" bgcolor="${COR.painel}" style="width:66.67%;${ESTILO_REFERENCIA_EMAIL}text-align:left;"><strong style="font-weight:bold;">Hora da consulta:</strong> ${texto(r.horaConsulta)} (Horário de Brasília)</td>
      <td width="33.33%" valign="bottom" align="center" bgcolor="${COR.painel}" style="width:33.33%;${ESTILO_REFERENCIA_EMAIL}text-align:center;"><strong style="font-weight:bold;">${esc(frasePrevisao(r))}</strong></td>
    </tr>
  </table>`;
}

// Card "CALOR": fonte única EHF/Clima e Saúde. Temperatura elevada e avisos
// meteorológicos de calor permanecem informações separadas e não substituem
// a classificação oficial do indicador de saúde.
function valorCalor(r) {
  const hoje = dataLocal(r.geradoEmISO || Date.now(), r.cidade?.fuso);
  const calor = calorPorData(r.climaSaude, hoje);
  if (!calor) {
    return `<span style="color:${COR.secundario};font:bold 21px/1.2 Arial,sans-serif;">Indisponível</span>`;
  }
  const grau = calor.grau;
  return `<span style="color:${visualNivel(grau).texto};">${esc(ROTULOS_CALOR[grau])}</span>`;
}

function resumoMeteorologico(r) {
  const rajada = rajadaMaxima(r);
  const rajadaValor = Number.isFinite(rajada.valor) ? numeroUnidade(rajada.valor, "km/h") : "Dado indisponível";
  const ar = apresentarQualidadeAr(r.qualidadeAr);
  const uv = apresentarIndiceUv(r.indiceUv);
  const fonteUv = uv.disponivel ? "Fonte de dados: Clima e Saúde." : "Fonte consultada: Clima e Saúde · indicador não publicado.";
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${COR.celula}" style="width:100%;background:${COR.celula};border:1px solid ${COR.borda};border-bottom:0;border-collapse:separate;">
    <tr>
      ${celulaMetrica("PREVISÃO TEMP. MÍN/MÁX", parOuTraco(r.tempMin, r.tempMax, "°", "°C"))}
      ${celulaMetrica("PREVISÃO UMIDADE MÍN/MÁX", parOuTraco(r.umidadeMin, r.umidadeMax, "%", "%"))}
      ${celulaMetrica("RAJADA PREVISTA", rajadaValor, true)}
    </tr>
    <tr>
      ${celulaMetrica("QUALIDADE DO AR", esc(ar.resultado), false, ar.orientacao)}
      ${celulaMetrica("CHUVA ACUMULADA/DIA", numeroUnidade(r.precipitacaoDiariaMm, "mm"))}
      ${celulaMetrica("CALOR", valorCalor(r), true)}
    </tr>
    <tr><td colspan="3" align="center" bgcolor="${COR.celula}" style="background:${COR.celula};border-bottom:1px solid ${COR.borda};padding:11px 8px;text-align:center;overflow-wrap:anywhere;word-break:break-word;">
      <div style="color:${COR.secundario};font:13px/1.3 Arial,sans-serif;text-transform:uppercase;">ÍNDICE UV</div>
      <div class="email-metric-value" style="color:${COR.texto};font:bold 21px/1.2 Arial,sans-serif;margin-top:3px;">${esc(uv.resultado)}</div>
      <div style="color:${COR.secundario};font:12px/1.35 Arial,sans-serif;margin-top:4px;">${esc(uv.orientacao)}</div>
      <div style="color:${COR.secundario};font:10px/1.35 Arial,sans-serif;margin-top:4px;">${esc(fonteUv)}</div>
    </td></tr>
  </table>`;
}

function valorTabela(valor, unidade = "") {
  return Number.isFinite(valor) ? `${esc(String(valor).replace(".", ","))}${unidade}` : "Não disponível";
}

function tabelaInformativoEmail({ titulo, subtitulo = "", cabecalhos, linhas, fonte }) {
  const corpo = linhas.map((linha, indice) => `<tr>${linha.map((valor, coluna) => `<td bgcolor="${indice % 2 ? "#F3F5F4" : "#FFFFFF"}" align="${coluna === 0 ? "left" : "center"}" style="background:${indice % 2 ? "#F3F5F4" : "#FFFFFF"};border:1px solid ${COR.borda};padding:9px 6px;color:${COR.texto};font:${coluna === 0 ? "bold " : ""}12px/1.35 Arial,sans-serif;${coluna === 0 ? "text-align:left;" : "text-align:center;"}">${valor}</td>`).join("")}</tr>`).join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#FFFFFF" style="width:100%;background:#FFFFFF;border-collapse:collapse;margin-top:9px;">
    <tr><td style="padding:8px 0 5px;border:0;">
      <div class="email-period-title" style="color:${COR.verde};font:bold 19px/1.25 Arial,sans-serif;">${esc(titulo)}</div>
      ${subtitulo ? `<div style="color:${COR.secundario};font:12px/1.4 Arial,sans-serif;margin-top:2px;">${esc(subtitulo)}</div>` : ""}
    </td></tr>
    <tr><td style="padding:0;border:0;"><table class="email-period-table" role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;table-layout:fixed;border-collapse:collapse;">
      <thead><tr>${cabecalhos.map((item) => `<th bgcolor="${COR.verde}" align="center" style="background:${COR.verde};border:1px solid ${COR.verde};padding:9px 5px;color:#FFFFFF;font:bold 11px/1.3 Arial,sans-serif;text-align:center;">${esc(item)}</th>`).join("")}</tr></thead>
      <tbody>${corpo}</tbody>
    </table></td></tr>
    <tr><td class="email-period-source" style="padding:5px 2px 3px;color:${COR.secundario};font:11px/1.4 Arial,sans-serif;">${esc(fonte)}</td></tr>
  </table>`;
}

function tabelasPrevisaoEmail(r) {
  const temperatura = tabelaInformativoEmail({
    titulo: "Temperatura e umidade",
    subtitulo: "Indicadores consolidados do período consultado.",
    cabecalhos: ["Temp. Mínima", "Temp. Máxima", "Umidade Mínima", "Umidade Máxima"],
    linhas: [[valorTabela(r.tempMin, "°C"), valorTabela(r.tempMax, "°C"), valorTabela(r.umidadeMin, "%"), valorTabela(r.umidadeMax, "%")]],
    fonte: "Fonte de dados: INMET.",
  });

  const vento = tabelaInformativoEmail({
    titulo: "Vento por período",
    cabecalhos: ["Período", "Direção", "Vento (velocidade média)", "Rajada prevista (máx.)", "Referência INMET"],
    linhas: (r.ventoPorPeriodo || []).map((p) => [
      `${esc(p.periodo)}${p.janela ? `<br><span style="font-weight:normal;font-size:10px;">${esc(p.janela)}</span>` : ""}`,
      texto(p.direcao),
      valorTabela(p.velocidadeMediaKmh, " km/h"),
      valorTabela(p.rajadaMaxKmh, " km/h"),
      esc(p.referenciaInmet || "Previsão municipal INMET"),
    ]),
    fonte: "Fonte de dados: INMET. A intensidade qualitativa oficial não é convertida em velocidade numérica; campos não publicados aparecem como Não disponível.",
  });

  const chuva = tabelaInformativoEmail({
    titulo: "Chuva por período",
    cabecalhos: ["Período", "Probabilidade", "Chuva por período (mm)", "Resumo INMET"],
    linhas: (r.chuvaPorPeriodo || []).map((p) => [
      `${esc(p.periodo)}${p.janela ? `<br><span style="font-weight:normal;font-size:10px;">${esc(p.janela)}</span>` : ""}`,
      valorTabela(p.probabilidade, "%"),
      valorTabela(p.precipitacaoMm, " mm"),
      p.resumoInmet ? esc(p.resumoInmet) : "Não disponível",
    ]),
    fonte: "Fonte de dados: INMET. O total diário não é distribuído entre períodos; campos numéricos ausentes permanecem indisponíveis.",
  });

  return `${temperatura}${vento}${chuva}`;
}

function celulaComplementar(rotulo, valor, detalhe) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${COR.celula}" style="width:100%;background:${COR.celula};border:1px solid ${COR.borda};">
    <tr><td align="center" bgcolor="${COR.celula}" style="padding:11px 8px 10px;text-align:center;background:${COR.celula};">
      <div style="color:${COR.secundario};font:13px/1.3 Arial,sans-serif;text-transform:uppercase;">${rotulo}</div>
      <div style="color:${COR.texto};font:bold 22px/1.25 Arial,sans-serif;margin-top:3px;">${valor}</div>
      <div style="color:${COR.texto};font:15px/1.3 Arial,sans-serif;margin-top:2px;">${detalhe}</div>
    </td></tr>
  </table>`;
}

function marECondicao(r) {
  const mar = numeroUnidade(r.mar?.alturaMaxDiaM, "m");
  const detalheMar = r.mar?.desatualizado
    ? `Dado armazenado — última atualização válida: ${formatarDataBrasilia(r.mar.ultimaAtualizacao) || "horário indisponível"}`
    : mar === "—" ? "—" : texto(r.mar?.estadoMarDia);
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${COR.painel}" style="width:100%;background:${COR.painel};">
    <tr>
      <td class="email-stack" width="50%" valign="top" style="width:50%;padding-right:4px;">${celulaComplementar("MAR — ALTURA MÁX. DE ONDA", mar, detalheMar)}</td>
      <td class="email-stack" width="50%" valign="top" style="width:50%;padding-left:4px;">${celulaComplementar("CONDIÇÃO GERAL", texto(r.condicaoGeral), "Previsão para o dia · Fonte de dados: INMET")}</td>
    </tr>
  </table>`;
}

function eventosLocais(r) {
  const todos = r.severidade?.eventos || (r.eventoMaisRelevante ? [r.eventoMaisRelevante] : []);
  return (Array.isArray(todos) ? todos : []).filter((evento) =>
    evento && evento.tipo !== "avisoInmet"
    && alertaExibivel(evento.grau || AlertTitle.normalizarGrau(evento.titulo))
  );
}

function linhaCard(item) {
  const valor = item.multilinha ? esc(item.texto).replace(/\r?\n/g, "<br>") : esc(item.texto);
  if (item.lista) {
    return `<div style="margin-top:6px;"><strong>${esc(item.rotulo)}:</strong><ul style="margin:3px 0 0;padding-left:20px;">${item.lista.map((i) => `<li style="margin-bottom:2px;">${esc(i)}</li>`).join("")}</ul></div>`;
  }
  return `<div style="margin-top:6px;">${item.rotulo ? `<strong>${esc(item.rotulo)}:</strong> ` : ""}${valor}</div>`;
}

// Card único (alerta + recomendações) em tabelas e estilos inline para o
// Outlook: faixa lateral numa célula própria (bgcolor) e card inteiro no tom
// claro do nível. Uma só coluna de texto — lê bem no celular.
function cartaoAlerta(card) {
  const v = card.visual;
  const rec = card.recomendacoes;
  const recomendacoesHtml = rec && rec.itens.length ? `<tr><td data-alert-recommendations="true" bgcolor="${v.fundo}" style="background:${v.fundo};padding:0 16px 14px;">
      <div style="border-top:1px solid ${COR.borda};padding-top:11px;">
        <div style="color:${v.texto};font:bold 15px/1.3 Arial,sans-serif;letter-spacing:0.4px;">RECOMENDAÇÕES</div>
        <div style="color:${COR.secundario};font:12px/1.35 Arial,sans-serif;margin-top:1px;">${esc(rec.titulo)}</div>
        <ul style="margin:7px 0 0;padding-left:20px;color:${COR.texto};font:14px/1.45 Arial,sans-serif;">${rec.itens.map((item) => `<li data-alert-recommendation="true" style="margin-bottom:4px;">${esc(item)}</li>`).join("")}</ul>
      </div>
    </td></tr>` : "";
  return `<table data-alert-card="true" data-nivel="${esc(card.nivel)}" role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${v.fundo}" style="width:100%;background:${v.fundo};border:1.5px solid ${v.cor};border-collapse:separate;margin-top:10px;">
    <tr>
      <td width="6" bgcolor="${v.cor}" style="width:6px;min-width:6px;background:${v.cor};font-size:0;line-height:0;">&nbsp;</td>
      <td valign="top" style="padding:0;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;">
          <tr><td bgcolor="${v.fundo}" style="background:${v.fundo};padding:10px 16px 11px;border-bottom:1px solid ${v.cor};">
            <span data-alert-level="${esc(card.nivel)}" style="display:inline-block;background:${v.selo};color:${v.textoSelo};padding:3px 9px;font:bold 11px/1.3 Arial,sans-serif;letter-spacing:0.6px;">${esc(v.rotulo)}</span>
            <span style="color:${COR.secundario};font:12px/1.3 Arial,sans-serif;padding-left:6px;">${esc(card.rotuloOrigem)}</span>
            <div data-alert-title="true" style="color:${v.texto};font:bold 19px/1.3 Arial,sans-serif;margin-top:6px;"><span style="color:${v.cor};">&#9679;</span> ${esc(card.titulo)}</div>
          </td></tr>
          <tr><td bgcolor="${v.fundo}" style="background:${v.fundo};padding:6px 16px 12px;color:${COR.texto};font:14px/1.5 Arial,sans-serif;">${card.linhas.map(linhaCard).join("")}</td></tr>
          ${recomendacoesHtml}
        </table>
      </td>
    </tr>
  </table>`;
}

function fontesDeDados(r, eventos) {
  const fontes = new Set();
  const adicionar = (fonte) => {
    if (!presente(fonte) || fonte === "Indisponível" || fonte === "Consulte as fontes por campo") return;
    const nome = String(fonte).trim();
    fontes.add(/^INMET(?:\s*[—-].*)?$/i.test(nome) ? "INMET" : nome);
  };
  const porCampo = r.fontesPorCampo || {};
  if (presente(r.condicaoGeral)) adicionar(porCampo.condicaoGeral);
  for (const campo of ["tempMin", "tempMax", "umidadeMin", "umidadeMax", "precipitacaoTotalMm"]) {
    if (Number.isFinite(r[campo])) adicionar(porCampo[campo]);
  }
  const rajada = rajadaMaxima(r);
  if (presente(rajada.valor)) {
    const periodo = String(rajada.periodo || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    adicionar(porCampo[`periodos.${periodo}.rajadaMaxKmh`] || porCampo.rajadaMaxKmh);
  }
  if (Number.isFinite(r.qualidadeAr?.pm25Medio)) adicionar(porCampo["ar.pm25Medio"] || r.qualidadeAr.fonte);
  if (Number.isFinite(r.mar?.alturaMaxDiaM)) adicionar(porCampo["mar.alturaMaxDiaM"] || r.mar.fonte);
  eventos.forEach((evento) => adicionar(evento.fonteDados));
  if (Array.isArray(r.avisosInmet) && r.avisosInmet.length) adicionar("INMET");
  if (r.climaSaude?.dados) adicionar(r.climaSaude.dados.source);
  return fontes.size ? [...fontes].map(esc).join(" | ") : "Dados indisponíveis nesta emissão.";
}

const { faixaSimulacaoEmail } = require("./simulationBanner");

function renderEmailHtml(r, { incluirCorRio = true } = {}) {
  const eventos = eventosLocais(r);
  const mudancas = renderDailyChanges(r.mudancasDia);
  // O corpo do e-mail mantém o filtro de antes (oculta NORMAL); ordem, cores
  // e recomendações vêm do mesmo modelo usado no PDF.
  const cartoesAlerta = montarCardsAlerta(r, { tipoDocumento: TIPOS_DOCUMENTO.EXTRAORDINARIO }).map(cartaoAlerta).join("");

  return `<!doctype html>
<html lang="pt-BR">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light only">${renderEmailHeaderStyles()}</head>
<body bgcolor="${COR.fundo}" style="margin:0;padding:0;background:${COR.fundo};background-color:${COR.fundo};color:${COR.texto};font-family:Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${COR.fundo}" style="width:100%;background:${COR.fundo};background-color:${COR.fundo};">
    <tr><td align="center" bgcolor="${COR.fundo}" style="padding:8px 6px;background:${COR.fundo};">
      <!--[if mso]><table role="presentation" width="850" cellpadding="0" cellspacing="0" bgcolor="${COR.painel}"><tr><td bgcolor="${COR.painel}"><![endif]-->
      <table class="cim-email-shell" role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${COR.painel}" style="width:100%;max-width:850px;background:${COR.painel};background-color:${COR.painel};color:${COR.texto};border:1px solid ${COR.borda};">
        ${faixaSimulacaoEmail(r)}
        ${renderEmailHeader({
          titulo: "INFORMATIVO METEOROLÓGICO",
          cidade: r.cidade?.nome,
          uf: r.cidade?.uf,
          data: r.dataFormatadaLonga,
        })}
        <tr><td class="email-pad" bgcolor="${COR.painel}" style="background:${COR.painel};padding:11px 20px 0;">${linhaReferencia(r)}</td></tr>
        <tr><td class="email-pad" bgcolor="${COR.painel}" style="background:${COR.painel};padding:4px 20px 5px;">${resumoMeteorologico(r)}</td></tr>
        <tr><td class="email-pad" bgcolor="${COR.painel}" style="background:${COR.painel};padding:0 20px 5px;">${tabelasPrevisaoEmail(r)}</td></tr>
        <tr><td class="email-pad" bgcolor="${COR.painel}" style="background:${COR.painel};padding:3px 20px 0;">${marECondicao(r)}</td></tr>
        <tr><td class="email-pad" bgcolor="${COR.painel}" style="background:${COR.painel};padding:2px 20px 0;">${cartoesAlerta}${mudancas}</td></tr>
        ${incluirCorRio ? `<tr><td class="email-pad" bgcolor="${COR.painel}" style="background:${COR.painel};padding:0 20px;">${cartaoCorRioEmail(r)}</td></tr>` : ""}
        <tr><td class="email-pad" bgcolor="${COR.painel}" style="background:${COR.painel};padding:10px 25px 6px;color:${COR.texto};font:14px/1.4 Arial,sans-serif;"><strong>Fontes de dados:</strong><br>${fontesDeDados(r, eventos)}</td></tr>
        <tr><td class="email-pad" bgcolor="${COR.painel}" style="background:${COR.painel};padding:0 20px 10px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${COR.celula}" style="width:100%;background:${COR.celula};border:1px solid ${COR.borda};border-left:4px solid ${COR.verde};"><tr><td bgcolor="${COR.celula}" style="padding:11px 17px;background:${COR.celula};color:#333333;font:14px/1.4 Arial,sans-serif;">Relatório técnico completo com tabelas, avisos oficiais e fontes consultadas em anexo (PDF).</td></tr></table></td></tr>
        <tr><td bgcolor="${COR.amarelo}" style="height:3px;background:${COR.amarelo};font-size:0;line-height:3px;">&nbsp;</td></tr>
        <tr><td align="center" bgcolor="${COR.painel}" style="padding:8px 20px 10px;background:${COR.painel};color:${COR.texto};text-align:center;font:12px/1.25 Arial,sans-serif;"><strong style="font-size:16px;color:${COR.verde};">CIM</strong><br>Centro Integrado de Monitoramento<br>COMPARTILHADO<br><span style="color:${COR.secundario};">Informativo gerado automaticamente pelo Protocolo Meteorológico do COMPARTILHADO.</span></td></tr>
      </table>
      <!--[if mso]></td></tr></table><![endif]-->
    </td></tr>
  </table>
</body>
</html>`;
}

module.exports = { renderEmailHtml };
