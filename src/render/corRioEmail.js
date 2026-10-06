// Card "Comunicado oficial COR-Rio" do CORPO DO E-MAIL — só o comunicado do
// dia. Site e PDF continuam mostrando o comunicado vigente completo e os
// demais; esta seleção e este recorte valem apenas para o e-mail.
//
// Comunicado do dia: comunicado meteorológico (categoria "Previsão do Tempo"
// do cor.rio) publicado na data do informativo, no horário de Brasília, até o
// momento da geração; se houver vários, o mais recente. Um título que cita
// datas, nenhuma delas a de hoje, não é do dia.
//
// Conteúdo do dia: o texto oficial é mantido como publicado; só saem os
// trechos que, pelas datas citadas e pela estrutura (subtítulos em destaque),
// tratam exclusivamente de dias seguintes.
const CorRio = require("../../public/cor-rio-compartilhado");
const { CATEGORIA_PREVISAO_TEMPO } = require("../sources/corRio");
const { formatarDataBrasilia } = require("../sources/sourceHealth");

const FUSO = "America/Sao_Paulo";
const DIA_MS = 24 * 60 * 60 * 1000;
const MESES = { janeiro: 1, fevereiro: 2, marco: 3, abril: 4, maio: 5, junho: 6, julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12 };
const DIAS_SEMANA = { domingo: 0, segunda: 1, terca: 2, quarta: 3, quinta: 4, sexta: 5, sabado: 6 };

function esc(valor) {
  return String(valor ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
const semAcento = (t) => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Data civil em Brasília ({ano, mes, dia}) de um instante. */
function diaBrasilia(instante) {
  const partes = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: FUSO, year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(new Date(instante)).filter((p) => p.type !== "literal").map((p) => [p.type, Number(p.value)]));
  return { ano: partes.year, mes: partes.month, dia: partes.day };
}
const diaUtc = ({ ano, mes, dia }) => Date.UTC(ano, mes - 1, dia);

// Data sem ano: o ano que deixa a data mais próxima da referência (vira de ano).
function deslocamento(dia, mes, ano, ref) {
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;
  const anos = ano ? [ano < 100 ? 2000 + ano : ano] : [ref.ano - 1, ref.ano, ref.ano + 1];
  const opcoes = anos.map((a) => (Date.UTC(a, mes - 1, dia) - diaUtc(ref)) / DIA_MS);
  return opcoes.reduce((melhor, d) => (Math.abs(d) < Math.abs(melhor) ? d : melhor));
}

/**
 * Dias citados no texto, em dias de diferença da data de referência
 * (0 = hoje, 1 = amanhã, -1 = ontem). Datas numéricas ("3/10", "1º/10/2026")
 * e por extenso ("3 de outubro"); dias da semana só quando não há data
 * explícita, interpretados como a ocorrência mais próxima.
 */
function diasCitados(texto, ref) {
  const t = semAcento(texto);
  const dias = new Set();
  for (const m of t.matchAll(/(?<![\d/])(\d{1,2})\s*[ºo°]?\s*\/\s*(\d{1,2})(?:\s*\/\s*(\d{2,4}))?(?![\d/])/g)) {
    const d = deslocamento(Number(m[1]), Number(m[2]), m[3] ? Number(m[3]) : null, ref);
    if (d !== null) dias.add(d);
  }
  for (const m of t.matchAll(/\b(\d{1,2})\s*[ºo°]?\s+de\s+(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)(?:\s+de\s+(\d{4}))?/g)) {
    const d = deslocamento(Number(m[1]), MESES[m[2]], m[3] ? Number(m[3]) : null, ref);
    if (d !== null) dias.add(d);
  }
  if (!dias.size) {
    const semanaRef = new Date(diaUtc(ref)).getUTCDay();
    for (const m of t.matchAll(/\b(domingo|segunda|terca|quarta|quinta|sexta|sabado)\b/g)) {
      const frente = (DIAS_SEMANA[m[1]] - semanaRef + 7) % 7;
      dias.add(frente <= 3 ? frente : frente - 7);
    }
  }
  return [...dias];
}

const apenasFuturo = (dias) => dias.length > 0 && dias.every((d) => d > 0);

/**
 * Mantém só o conteúdo referente ao dia. Os parágrafos em destaque abrem
 * seções; uma seção sai inteira quando o subtítulo, ou todos os seus
 * parágrafos datados, tratam apenas de dias seguintes. Nas seções mantidas
 * sai só o parágrafo que cita exclusivamente dias seguintes.
 */
function conteudoDoDia(paragrafos, ref) {
  const secoes = [];
  for (const p of paragrafos || []) {
    if (p.destaque || !secoes.length) secoes.push({ titulo: p.destaque ? p : null, itens: [] });
    if (!p.destaque) secoes.at(-1).itens.push(p);
  }
  const resultado = [];
  for (const secao of secoes) {
    const datados = secao.itens.map((p) => diasCitados(p.texto, ref)).filter((d) => d.length);
    const tituloFuturo = secao.titulo && apenasFuturo(diasCitados(secao.titulo.texto, ref));
    const secaoFutura = tituloFuturo || (secao.titulo && !diasCitados(secao.titulo.texto, ref).length && datados.length && datados.every(apenasFuturo));
    if (secaoFutura) continue;
    const itens = secao.itens.filter((p) => !apenasFuturo(diasCitados(p.texto, ref)));
    if (secao.titulo && !itens.length && secao.itens.length) continue;
    if (secao.titulo) resultado.push(secao.titulo);
    resultado.push(...itens);
  }
  return resultado;
}

/** Comunicado meteorológico do dia do informativo, ou null. */
function comunicadoDoDia(itens, { geradoEm = Date.now() } = {}) {
  const limite = typeof geradoEm === "number" ? geradoEm : Date.parse(geradoEm);
  const ref = diaBrasilia(limite);
  const candidatos = (itens || []).filter((c) => {
    const publicado = Date.parse(c.publicadoEm);
    if (!Number.isFinite(publicado) || publicado > limite) return false;
    if (diaUtc(diaBrasilia(publicado)) !== diaUtc(ref)) return false;
    if (!(c.categorias || []).includes(CATEGORIA_PREVISAO_TEMPO)) return false;
    const diasTitulo = diasCitados(c.titulo, ref);
    return !diasTitulo.length || diasTitulo.includes(0);
  }).sort((a, b) => Date.parse(b.publicadoEm) - Date.parse(a.publicadoEm));
  for (const c of candidatos) {
    const paragrafos = conteudoDoDia(c.paragrafos, ref);
    if (paragrafos.length) return { ...c, paragrafos };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Apresentação (tabelas + estilos inline, compatível com Outlook/Gmail)
// ---------------------------------------------------------------------------
const TEXTO = "#1F2A26";
const quando = (iso) => (formatarDataBrasilia(iso) ? `${formatarDataBrasilia(iso)} (Brasília)` : "horário indisponível");
const textoOficial = (t) => esc(t).replace(/\r?\n/g, "<br>");
const link = (url, rotulo) => (/^https:\/\/cor\.rio\//.test(url || "") ? `<a href="${esc(url)}" style="color:#00612C;font-weight:bold;text-decoration:underline;">${esc(rotulo)}</a>` : "");
const linha = (rotulo, valor) => `<div style="margin-top:3px;"><strong>${rotulo}:</strong> ${valor}</div>`;
const aviso = (t) => `<div style="margin-top:8px;padding:6px 10px;border:1px dashed #B7791F;background:#FFF8E6;font:13px/1.45 Arial,sans-serif;">${t}</div>`;

function paragrafosHtml(paragrafos) {
  let html = "";
  let lista = [];
  const fechar = () => { if (lista.length) html += `<ul style="margin:4px 0 0;padding-left:20px;">${lista.join("")}</ul>`; lista = []; };
  for (const p of paragrafos) {
    if (p.item) { lista.push(`<li style="margin-bottom:3px;">${textoOficial(p.texto)}</li>`); continue; }
    fechar();
    html += `<div style="margin-top:${p.destaque ? 10 : 6}px;${p.destaque ? "font-weight:bold;" : ""}">${textoOficial(p.texto)}</div>`;
  }
  fechar();
  return html;
}

/** Card do e-mail; "" quando o relatório não tem dados do COR-Rio (outras bases). */
function cartaoCorRioEmail(r) {
  const estado = r.corRio;
  if (!estado) return "";
  const s = CorRio.situacao(estado);
  const est = estado.estagio || {};
  const com = estado.comunicados || {};
  const cor = s.estagio ? s.estagio.cor : CorRio.NEUTRO.cor;
  const fundo = s.estagio ? CorRio.tomClaro(cor, 0.1) : CorRio.NEUTRO.fundo;
  const selo = s.nivel
    ? `<span style="display:inline-block;background:${cor};color:${CorRio.TINTA};font:bold 14px/1.2 Arial,sans-serif;letter-spacing:0.5px;padding:5px 12px;border-radius:5px;white-space:nowrap;">ESTÁGIO ${s.nivel}</span>`
    : `<span style="display:inline-block;background:#DDE3E1;color:#2B3431;border:1px dashed #8A9894;font:bold 13px/1.2 Arial,sans-serif;padding:5px 10px;border-radius:5px;white-space:nowrap;">ESTÁGIO INDISPONÍVEL</span>`;
  const corCalor = s.calor ? s.calor.cor : CorRio.NEUTRO.cor;
  const seloCalor = s.nivelCalor
    ? `<span style="display:inline-block;background:${corCalor};color:${CorRio.TINTA};font:bold 14px/1.2 Arial,sans-serif;letter-spacing:0.3px;padding:5px 12px;border-radius:5px;white-space:nowrap;margin-top:5px;">ESTÁGIO DE CALOR ${s.nivelCalor}</span>`
    : `<span style="display:inline-block;background:#DDE3E1;color:#2B3431;border:1px dashed #8A9894;font:bold 13px/1.2 Arial,sans-serif;padding:5px 10px;border-radius:5px;white-space:nowrap;margin-top:5px;">CALOR INDISPONÍVEL</span>`;

  const geradoEm = r.geradoEmISO || Date.now();
  const doDia = s.comunicados === "indisponivel" ? null : comunicadoDoDia(com.itens, { geradoEm });
  let corpo;
  if (s.comunicados === "indisponivel") {
    corpo = `<div style="font-weight:bold;">Não foi possível consultar os comunicados do COR-Rio nesta geração${com.falha ? ` (${esc(com.falha)})` : ""}.</div>`;
  } else if (!doDia) {
    corpo = `<div style="font-weight:bold;">Nenhum comunicado do dia disponível até o horário da consulta.</div>
      ${linha("Consulta à fonte", esc(quando(com.consultadoEm)))}`;
  } else {
    const atualizado = doDia.atualizadoEm && formatarDataBrasilia(doDia.atualizadoEm) !== formatarDataBrasilia(doDia.publicadoEm) ? ` · atualizado em ${esc(quando(doDia.atualizadoEm))}` : "";
    corpo = `<div style="font:bold 17px/1.35 Arial,sans-serif;color:${TEXTO};">${esc(doDia.titulo)}</div>
      ${paragrafosHtml(doDia.paragrafos)}
      <div style="margin-top:10px;padding-top:8px;border-top:1px solid rgba(0,0,0,0.12);font:14px/1.45 Arial,sans-serif;">
        ${linha("Abrangência", esc(doDia.abrangencia || estado.abrangencia))}
        ${linha("Publicação", `${esc(quando(doDia.publicadoEm))}${atualizado}`)}
        ${linha("Fonte", esc(estado.fonte || "COR-Rio"))}
        ${linha("Consulta à fonte", esc(quando(com.consultadoEm)))}
        ${link(doDia.link, "Consultar publicação oficial") ? `<div style="margin-top:6px;">${link(doDia.link, "Consultar publicação oficial")}</div>` : ""}
      </div>`;
  }
  if (s.comunicados !== "indisponivel" && s.comunicadosDesatualizados) {
    corpo += aviso(`<strong>Dados desatualizados</strong> — última consulta bem-sucedida dos comunicados: ${esc(quando(com.consultadoEm))}.`);
  }

  const estagio = s.nivel
    ? `<div style="margin-top:10px;font:14px/1.45 Arial,sans-serif;"><strong>Estágio operacional da cidade:</strong> Estágio ${s.nivel}${est.dados.vigenteDesde ? `, em vigor desde ${esc(quando(est.dados.vigenteDesde))}` : ""}. Consulta à fonte: ${esc(quando(est.consultadoEm))}. Estágio e comunicado são publicados separadamente pelo COR-Rio.</div>
       ${s.estagioDesatualizado ? aviso(`<strong>Dados desatualizados</strong> — última consulta bem-sucedida do estágio: ${esc(quando(est.consultadoEm))}.`) : ""}`
    : `<div style="margin-top:10px;font:14px/1.45 Arial,sans-serif;"><strong>Estágio indisponível</strong> — não há consulta válida ao estágio operacional do COR-Rio${est.falha ? ` (${esc(est.falha)})` : ""}.</div>`;
  const calorParte = estado.calor || {};
  const calor = s.nivelCalor
    ? `<div style="margin-top:8px;font:14px/1.45 Arial,sans-serif;"><strong>Estágio de calor:</strong> Estágio de Calor ${s.nivelCalor}. Consulta à fonte: ${esc(quando(calorParte.consultadoEm))}. Protocolo independente do estágio operacional.</div>
       ${s.calorDesatualizado ? aviso(`<strong>Dados desatualizados</strong> — última consulta bem-sucedida do estágio de calor: ${esc(quando(calorParte.consultadoEm))}.`) : ""}`
    : `<div style="margin-top:8px;font:14px/1.45 Arial,sans-serif;"><strong>Estágio de calor indisponível</strong> — não há consulta válida ao Protocolo de Calor do COR-Rio${calorParte.falha ? ` (${esc(calorParte.falha)})` : ""}.</div>`;
  const rodape = doDia ? "" : linha("Abrangência", esc(estado.abrangencia || "Município do Rio de Janeiro")) + linha("Fonte", esc(estado.fonte || "COR-Rio"));

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${fundo}" style="width:100%;background:${fundo};border:1.5px solid ${cor};border-left:7px solid ${cor};border-radius:8px;border-collapse:separate;margin-top:9px;">
    <tr><td bgcolor="${fundo}" style="padding:13px 18px 14px;background:${fundo};color:${TEXTO};font:15px/1.5 Arial,sans-serif;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;"><tr>
        <td valign="top" style="color:${TEXTO};font:bold 20px/1.25 Arial,sans-serif;padding:0 10px 8px 0;">Comunicado oficial COR-Rio</td>
        <td valign="top" align="right" style="text-align:right;padding-bottom:8px;">${selo}<br>${seloCalor}</td>
      </tr></table>
      ${corpo}
      ${estagio}
      ${calor}
      ${rodape ? `<div style="font:14px/1.45 Arial,sans-serif;">${rodape}</div>` : ""}
    </td></tr>
  </table>`;
}

module.exports = { cartaoCorRioEmail, comunicadoDoDia, conteudoDoDia, diasCitados, diaBrasilia };
