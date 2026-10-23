const { esc } = require("./pdfTemplate");
const { renderEmailHeader, renderEmailHeaderStyles } = require("./emailComponents");
const { montarCardsAlerta, visualNivel } = require("./alertCards");
const { formatarDataBrasilia } = require("../sources/sourceHealth");
const { cartaoCorRioEmail } = require("./corRioEmail");
const AlertTitle = require("../../public/alert-title");
const { calorPorData, dataLocal, ROTULOS_CALOR } = require("../logic/calorPorData");
const { TIPOS_DOCUMENTO, alertaExibivel } = require("../logic/alertPresentation");
const { edicaoInformativo } = require("../logic/informativoValidity");
const { formatarRajadaPrevista } = require("../../public/weather-format");

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

const ESTILO_REFERENCIA_EMAIL = `background:${COR.painel};padding:0 5px;color:${COR.texto};font-family:Arial,sans-serif;font-size:16px;font-weight:400;line-height:1.4;`;

function presente(valor) {
  return valor !== null && valor !== undefined && valor !== "";
}

function texto(valor) {
  return presente(valor) ? esc(valor) : "—";
}

function horaConsultaEmail(valor) {
  const horaCheia = /^(\d{2}):00$/.exec(String(valor || "").trim());
  return texto(horaCheia ? `${horaCheia[1]}h` : valor);
}

function numeroUnidade(valor, unidade, casas = null) {
  if (!Number.isFinite(valor)) return "Dado indisponível";
  const exibido = Number.isInteger(casas)
    ? valor.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas })
    : valor;
  return `${esc(exibido)} ${unidade}`;
}

function parOuTraco(minimo, maximo, sufixoMin, sufixoMax) {
  if (!Number.isFinite(minimo) || !Number.isFinite(maximo)) return "Dado indisponível";
  return `${esc(minimo)}${sufixoMin} / ${esc(maximo)}${sufixoMax}`;
}

function rajadaMaxima(r) {
  if (Number.isFinite(r.rajadaMaxKmh)) {
    return {
      valor: r.rajadaMaxKmh,
      periodo: r.rajadaPrevistaReferencia?.periodoReferencia || null,
    };
  }
  const periodos = Array.isArray(r.ventoPorPeriodo) ? r.ventoPorPeriodo : [];
  const validos = periodos.filter((p) => Number.isFinite(p?.rajadaMaxKmh));
  if (!validos.length) return { valor: null, periodo: null };
  const maximo = validos.reduce((maior, atual) => atual.rajadaMaxKmh > maior.rajadaMaxKmh ? atual : maior);
  return { valor: maximo.rajadaMaxKmh, periodo: maximo.periodo };
}

// Hora final de um período ("12h–18h" → 18; "18h–00h" → 24).
function fimPeriodo(p) {
  const fim = String(p?.janela || "").match(/[–-]\s*(\d{1,2})h/);
  if (fim) return Number(fim[1]) === 0 ? 24 : Number(fim[1]);
  return { "manhã": 12, manha: 12, tarde: 18, noite: 24 }[String(p?.periodo || "").toLowerCase()] ?? null;
}

// Períodos que ainda importam para a edição: os que terminam depois do
// horário dela (às 15h, a manhã já passou).
function periodosDaEdicao(r, periodos) {
  const inicio = edicaoInformativo(r.horarioAgendado)?.inicioHora;
  if (!Number.isFinite(inicio)) return periodos;
  return periodos.filter((p) => { const fim = fimPeriodo(p); return fim === null || fim > inicio; });
}

function chuvaPrevistaAcumulada(r) {
  const diaria = r.previsaoDias?.[0]?.chuvaMm;
  if (Number.isFinite(diaria)) return diaria;

  const periodos = Array.isArray(r.chuvaPorPeriodo) ? r.chuvaPorPeriodo : [];
  const relevantes = periodosDaEdicao(r, periodos);
  if (!relevantes.length || relevantes.some((p) => !Number.isFinite(p?.precipitacaoMm))) return null;
  return Math.round(relevantes.reduce((total, p) => total + p.precipitacaoMm, 0) * 10) / 10;
}

function probabilidadeChuvaPrevista(r) {
  if (Number.isFinite(r.probabilidadeChuvaPrevista)) return r.probabilidadeChuvaPrevista;
  const periodos = Array.isArray(r.chuvaPorPeriodo) ? r.chuvaPorPeriodo : [];
  // Todas as edições consideram a previsão do seu horário até 00h.
  const relevantes = periodosDaEdicao(r, periodos);
  const valores = relevantes.map((p) => p?.probabilidade).filter(Number.isFinite);
  return valores.length ? Math.max(...valores) : null;
}


function celulaMetrica(rotulo, valor, ultimaColuna = false) {
  return `<td colspan="2" width="33.33%" valign="middle" align="center" bgcolor="${COR.celula}" style="width:33.33%;background:${COR.celula};border-right:${ultimaColuna ? "0" : `1px solid ${COR.borda}`};border-bottom:1px solid ${COR.borda};padding:13px 8px 12px;text-align:center;vertical-align:middle;overflow-wrap:anywhere;word-break:break-word;">
    <div style="color:${COR.secundario};font:13px/1.3 Arial,sans-serif;text-transform:uppercase;">${rotulo}</div>
    <div class="email-metric-value" style="color:${COR.texto};font:bold 25px/1.2 Arial,sans-serif;margin-top:3px;overflow-wrap:anywhere;word-break:break-word;">${valor}</div>
  </td>`;
}

function celulaChuva(chuvaPrevista, probabilidade) {
  const bloco = (tipo, rotulo, valor, bordaInferior) => `<tr><td data-email-rain-metric="${tipo}" align="center" bgcolor="${COR.celula}" style="background:${COR.celula};${bordaInferior ? `border-bottom:1px solid ${COR.borda};` : ""}padding:7px 8px 6px;text-align:center;vertical-align:middle;overflow-wrap:anywhere;word-break:break-word;">
    <div style="color:${COR.secundario};font:12px/1.25 Arial,sans-serif;text-transform:uppercase;">${rotulo}</div>
    <div class="email-metric-value" style="color:${COR.texto};font:bold 21px/1.15 Arial,sans-serif;margin-top:2px;overflow-wrap:anywhere;word-break:break-word;">${valor}</div>
  </td></tr>`;
  return `<td data-email-rain-card="true" colspan="2" width="33.33%" valign="middle" align="center" bgcolor="${COR.celula}" style="width:33.33%;background:${COR.celula};border-right:1px solid ${COR.borda};border-bottom:1px solid ${COR.borda};padding:0;text-align:center;vertical-align:middle;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${COR.celula}" style="width:100%;background:${COR.celula};border-collapse:collapse;table-layout:fixed;">
      ${bloco("acumulado", "CHUVA ACUMULADA/DIA", chuvaPrevista, true)}
      ${bloco("probabilidade", "PROBABILIDADE DE CHUVA", probabilidade, false)}
    </table>
  </td>`;
}

// A janela da previsão depende da edição (horário agendado), não da hora em
// que o e-mail é aberto.
function frasePrevisao(r) {
  if (!r.horarioAgendado || !r.previsaoAte) return "";
  return `Previsão até ${r.previsaoAte}`;
}

// Linha acima dos cards: "Hora da consulta" à esquerda e a janela da previsão
// fora do card, centralizada sobre a 3ª coluna. As colunas
// 66,67% + 33,33% espelham a tabela de cards, inclusive no Outlook.
function linhaReferencia(r) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${COR.painel}" style="width:100%;background:${COR.painel};border-collapse:collapse;">
    <tr>
      <td width="66.67%" valign="bottom" align="left" bgcolor="${COR.painel}" style="width:66.67%;${ESTILO_REFERENCIA_EMAIL}text-align:left;"><strong style="font-weight:bold;">Hora da consulta:</strong> ${horaConsultaEmail(r.horaConsulta)} (Horário de Brasília)</td>
      <td width="33.33%" valign="bottom" align="right" bgcolor="${COR.painel}" style="width:33.33%;${ESTILO_REFERENCIA_EMAIL}text-align:right;">${esc(frasePrevisao(r))}</td>
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
    return `<span style="color:${COR.secundario};font:bold 21px/1.2 Arial,sans-serif;">Dado indisponível</span>`;
  }
  const grau = calor.grau;
  return `<span style="color:${visualNivel(grau).texto};">${esc(ROTULOS_CALOR[grau])}</span>`;
}

function resumoMeteorologico(r) {
  const rajada = rajadaMaxima(r);
  const rajadaValor = Number.isFinite(rajada.valor) ? formatarRajadaPrevista(rajada.valor) : "Dado indisponível";
  const chuvaPrevista = chuvaPrevistaAcumulada(r);
  const probabilidade = probabilidadeChuvaPrevista(r);
  const ar = Number.isFinite(r.qualidadeAr?.aqiPm25) && presente(r.qualidadeAr?.pm25Classificacao?.nivel)
    ? texto(r.qualidadeAr?.pm25Classificacao?.nivel)
    : "Dado indisponível";
  return `<table data-email-metrics="true" role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${COR.celula}" style="width:100%;background:${COR.celula};border:1px solid ${COR.borda};border-collapse:collapse;table-layout:fixed;">
    <colgroup>
      <col width="16.67%"><col width="16.67%"><col width="16.66%">
      <col width="16.67%"><col width="16.67%"><col width="16.66%">
    </colgroup>
    <tr data-email-metric-row="1">
      ${celulaMetrica("PREVISÃO TEMP. MÍN/MÁX", parOuTraco(r.tempMin, r.tempMax, "°", "°C"))}
      ${celulaMetrica("PREVISÃO UMIDADE MÍN/MÁX", parOuTraco(r.umidadeMin, r.umidadeMax, "%", "%"))}
      ${celulaMetrica("RAJADA PREVISTA", rajadaValor, true)}
    </tr>
    <tr data-email-metric-row="2">
      ${celulaMetrica("QUALIDADE DO AR", ar)}
      ${celulaChuva(
        Number.isFinite(chuvaPrevista) ? numeroUnidade(chuvaPrevista, "mm") : "Dado indisponível",
        Number.isFinite(probabilidade) ? `${esc(probabilidade)}%` : "Indisponível"
      )}
      ${celulaMetrica("CALOR", valorCalor(r), true)}
    </tr>
    ${marECondicao(r)}
  </table>`;
}

function celulaComplementar(rotulo, valor, detalhe, ultimaColuna = false) {
  return `<td class="email-stack" colspan="3" width="50%" valign="middle" align="center" bgcolor="${COR.celula}" style="width:50%;background:${COR.celula};border-right:${ultimaColuna ? "0" : `1px solid ${COR.borda}`};border-bottom:1px solid ${COR.borda};padding:13px 10px 12px;text-align:center;vertical-align:middle;overflow-wrap:anywhere;word-break:break-word;">
    <div style="color:${COR.secundario};font:13px/1.3 Arial,sans-serif;text-transform:uppercase;">${rotulo}</div>
    <div class="email-metric-value" style="color:${COR.texto};font:bold 22px/1.25 Arial,sans-serif;margin-top:3px;overflow-wrap:anywhere;word-break:break-word;">${valor}</div>
    <div style="color:${COR.texto};font:15px/1.3 Arial,sans-serif;margin-top:2px;overflow-wrap:anywhere;word-break:break-word;">${detalhe}</div>
  </td>`;
}

function marECondicao(r) {
  const mar = numeroUnidade(r.mar?.alturaMaxDiaM, "m");
  const detalheMar = r.mar?.desatualizado
    ? `Dado armazenado — última atualização válida: ${formatarDataBrasilia(r.mar.ultimaAtualizacao) || "horário indisponível"}`
    : mar === "Dado indisponível" || !presente(r.mar?.estadoMarDia) ? "Dado indisponível" : texto(r.mar.estadoMarDia);
  return `<tr data-email-metric-row="3">
    ${celulaComplementar("MAR — ALTURA MÁX. DE ONDA", mar, detalheMar)}
    ${celulaComplementar("CONDIÇÃO GERAL", presente(r.condicaoGeral) ? texto(r.condicaoGeral) : "Dado indisponível", "Previsão para o dia", true)}
  </tr>`;
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

const FONTES_DADOS_EMAIL = "INMET | Clima e Saúde — Ministério da Saúde | Open-Meteo — todos (previsão complementar, Air Quality / CAMS e Marine)";

function fontesDeDados() {
  const relatorio = arguments[0];
  const valores = [relatorio?.mar?.fonte, ...Object.values(relatorio?.fontesPorCampo || {})].map(String);
  const adicionais = [];
  if (valores.some((fonte) => fonte === "Petrobras — OCEANOP")) adicionais.push("Petrobras — OCEANOP");
  if (valores.some((fonte) => fonte === "Tetra Tech/OCEANOP")) {
    const referencia = relatorio?.rajadaPrevistaReferencia?.periodoReferencia;
    adicionais.push(`Tetra Tech/OCEANOP${referencia ? ` (${referencia})` : ""}`);
  }
  return esc([FONTES_DADOS_EMAIL, ...adicionais].join(" | "));
}

const { faixaSimulacaoEmail } = require("./simulationBanner");

function renderEmailHtml(r, { incluirCorRio = true } = {}) {
  const eventos = eventosLocais(r);
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
        <tr><td class="email-pad" bgcolor="${COR.painel}" style="background:${COR.painel};padding:2px 20px 0;">${cartoesAlerta}</td></tr>
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

module.exports = {
  renderEmailHtml,
  // Usados pelo painel para exibir os mesmos valores do e-mail.
  chuvaPrevistaAcumulada,
  probabilidadeChuvaPrevista,
  frasePrevisao,
  FONTES_DADOS_EMAIL,
};
