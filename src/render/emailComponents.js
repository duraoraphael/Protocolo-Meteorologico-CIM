const { logosComoDataUri } = require("../config/logos");

const EMAIL_HEADER_VERDE = "#006527";
const EMAIL_HEADER_VERDE_ESCURO = "#00451B";
const EMAIL_HEADER_AMARELO = "#FFCC00";

const EMAIL_STATUS = Object.freeze({
  NORMAL: Object.freeze({ cor: "#2E7D32", fundo: "#E8F5E9" }),
  "ATENÇÃO": Object.freeze({ cor: "#F57C00", fundo: "#FFF3E0" }),
  ALERTA: Object.freeze({ cor: "#D32F2F", fundo: "#FFEBEE" }),
  "EMERGÊNCIA": Object.freeze({ cor: "#B71C1C", fundo: "#FFEBEE" }),
});

const ORDEM_STATUS = Object.freeze({ NORMAL: 0, "ATENÇÃO": 1, ALERTA: 2, "EMERGÊNCIA": 3 });

function esc(valor) {
  if (valor === null || valor === undefined || valor === "") return "—";
  return String(valor)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function normalizarGrau(valor) {
  const texto = String(valor || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
  if (/\bEMERGENCIA\b/.test(texto)) return "EMERGÊNCIA";
  if (/\bALERTA\b/.test(texto)) return "ALERTA";
  if (/\bATENCAO\b/.test(texto)) return "ATENÇÃO";
  if (/\bNORMAL\b/.test(texto)) return "NORMAL";
  return null;
}

function statusEmail(grau) {
  return EMAIL_STATUS[normalizarGrau(grau)] || EMAIL_STATUS.NORMAL;
}

function identidadeCimHtml() {
  // A identidade nunca depende de imagem: esse HTML permanece legível mesmo
  // quando Gmail/Outlook bloqueiam imagens externas e Data URIs.
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;"><tr>
    <td valign="middle" style="color:#ffffff;font:bold 38px/1 Arial,sans-serif;padding-right:9px;white-space:nowrap;"><span style="color:#ffffff;">C</span><span style="color:${EMAIL_HEADER_AMARELO};">I</span><span style="color:#ffffff;">M</span></td>
    <td valign="middle" style="border-left:2px solid #ffffff;padding-left:9px;color:#ffffff;font:bold 11px/1.18 Arial,sans-serif;white-space:nowrap;">Centro Integrado<br>de Monitoramento<br><span style="color:#ffffff;letter-spacing:0.2px;">COMPARTILHADO</span></td>
  </tr></table>`;
}

function petrobrasHtml() {
  const { petrobras } = logosComoDataUri();
  if (petrobras) {
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" align="center" style="width:100%;background:${EMAIL_HEADER_VERDE_ESCURO};"><tr><td align="center" style="padding:7px;line-height:0;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;background:#ffffff;"><tr><td align="center" style="padding:8px 6px;line-height:0;">
        <img src="${petrobras}" width="135" alt="Petrobras" style="display:block;width:135px;max-width:100%;height:auto;border:0;color:#00843D;font:bold 16px/1.2 Arial,sans-serif;">
      </td></tr></table>
    </td></tr></table>`;
  }
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;background:${EMAIL_HEADER_VERDE_ESCURO};"><tr><td align="center" style="padding:13px 6px;color:#ffffff;font:italic bold 19px/1.2 Arial,sans-serif;">Petrobras</td></tr></table>`;
}

function linhaLocal({ cidade, uf, data, horario, contexto }) {
  if (contexto) return esc(contexto);
  const local = [cidade, uf].filter((item) => item !== null && item !== undefined && item !== "").map(esc).join(" — ");
  const dataHora = [data, horario ? `${esc(data) === "—" ? "" : "às "}${esc(horario)}` : null]
    .filter((item) => item && item !== "—")
    .join(" ");
  return [local, dataHora].filter(Boolean).join(" — ") || "—";
}

function renderEmailHeader({ titulo, cidade, uf, data, horario, contexto }) {
  return `<tr data-email-header="true"><td style="background:${EMAIL_HEADER_VERDE};padding:15px 18px 13px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;"><tr>
      <td data-email-header-cim="true" width="32%" valign="middle" style="width:32%;color:#ffffff;padding-right:10px;">${identidadeCimHtml()}</td>
      <td data-email-header-title="true" width="49%" valign="middle" align="center" style="width:49%;color:#ffffff;padding:0 8px;text-align:center;">
        <div style="color:#ffffff;font:bold 21px/1.18 Arial,sans-serif;letter-spacing:0.2px;">${esc(titulo)}</div>
        <div style="color:#ffffff;font:13px/1.4 Arial,sans-serif;margin-top:8px;">${linhaLocal({ cidade, uf, data, horario, contexto })}</div>
      </td>
      <td data-email-header-petrobras="true" width="19%" valign="middle" align="center" style="width:19%;text-align:center;padding-left:8px;">${petrobrasHtml()}</td>
    </tr></table>
  </td></tr>
  <tr data-email-header-stripe="true"><td style="height:4px;background:${EMAIL_HEADER_AMARELO};font-size:0;line-height:4px;">&nbsp;</td></tr>`;
}

// Compatibilidade para consumidores externos antigos. Os templates do
// projeto usam obrigatoriamente o nome canônico renderEmailHeader.
const renderInstitutionalHeader = renderEmailHeader;

function classificacaoMudanca(grauAnterior, grauAtual, motivo) {
  const anterior = normalizarGrau(grauAnterior);
  const atual = normalizarGrau(grauAtual);
  const motivoNormalizado = String(motivo || "").toLowerCase();
  if (atual === "NORMAL" || motivoNormalizado === "normalizou") return "NORMALIZAÇÃO";
  if (motivoNormalizado === "agravou") return "AGRAVAMENTO";
  if (motivoNormalizado === "reduziu") return "REDUÇÃO";
  if (motivoNormalizado === "novo") return "NOVO ALERTA";
  if (!anterior) return "NOVO ALERTA";
  if ((ORDEM_STATUS[atual] ?? 0) > (ORDEM_STATUS[anterior] ?? 0)) return "AGRAVAMENTO";
  if ((ORDEM_STATUS[atual] ?? 0) < (ORDEM_STATUS[anterior] ?? 0)) return "REDUÇÃO";
  return "ATUALIZAÇÃO";
}

function seloStatus(grau, atual = false) {
  const normalizado = normalizarGrau(grau) || "NORMAL";
  const visual = atual ? statusEmail(normalizado) : { cor: "#687078", fundo: "#ECEFF1" };
  const corTexto = atual ? "#FFFFFF" : "#333333";
  return `<span style="display:inline-block;border:2px solid ${visual.cor};background:${atual ? visual.cor : visual.fundo};color:${corTexto};padding:7px 12px;font:bold 14px/1.1 Arial,sans-serif;white-space:nowrap;">${esc(normalizado)}</span>`;
}

function recomendacoesHtml(itens) {
  if (!Array.isArray(itens) || !itens.length) return "";
  return `<div style="margin-top:16px;color:#333333;font:13px/1.5 Arial,sans-serif;"><strong>Recomendações - Protocolo Meteorológico do COMPARTILHADO</strong><ul style="margin:8px 0 0 20px;padding:0;">${itens.map((item) => `<li style="margin-bottom:7px;">${esc(item)}</li>`).join("")}</ul></div>`;
}

function renderStatusChangeCard({ tipo, grauAnterior, grau, motivo, detalhe, janela, fonteDados, protocolo, naturezaDado, severidadeTexto, instrucoesOficiais, recomendacoes }) {
  const atual = normalizarGrau(grau) || "NORMAL";
  const anterior = normalizarGrau(grauAnterior);
  const visual = statusEmail(atual);
  const classificacao = classificacaoMudanca(anterior, atual, motivo);
  const fenomeno = String(tipo || "Meteorológico").toUpperCase();
  const avisoOficial = naturezaDado === "Aviso oficial";
  const normalizacaoOficial = avisoOficial && atual === "NORMAL";
  const tituloMudanca = avisoOficial
    ? `${normalizacaoOficial ? "NORMALIZAÇÃO" : "MUDANÇA"} DE AVISO OFICIAL INMET — ${fenomeno}`
    : `MUDANÇA DE STATUS — ${fenomeno}`;
  const linhaStatus = anterior
    ? `${seloStatus(anterior)}<span style="display:inline-block;padding:0 12px;color:#333333;font:bold 22px/1 Arial,sans-serif;vertical-align:middle;">→</span>${seloStatus(atual, true)}`
    : `${seloStatus(atual, true)}`;
  const textoTransicao = anterior
    ? `<div style="color:#555555;font:12px/1.4 Arial,sans-serif;margin-top:10px;">Mudança de gatilho: <strong>${esc(anterior)} → ${esc(atual)}</strong></div>`
    : `<div style="color:#555555;font:12px/1.4 Arial,sans-serif;margin-top:10px;">Grau atual: <strong>${esc(atual)}</strong></div>`;
  const rotuloAtual = `${atual}${protocolo ? ` ${esc(protocolo)}` : ""} — ${esc(fenomeno)}`;

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;background:${visual.fundo};border:1.5px solid ${visual.cor};border-left:5px solid ${visual.cor};margin:0 0 12px;">
    <tr><td style="padding:15px 18px;color:#333333;font-family:Arial,sans-serif;">
      <div style="color:${visual.cor};font:bold 18px/1.25 Arial,sans-serif;">${esc(tituloMudanca)}</div>
      <div style="color:${visual.cor};font:bold 12px/1.3 Arial,sans-serif;margin-top:4px;">${avisoOficial ? "Classificação: " : ""}${classificacao}</div>
      <div style="margin-top:12px;">${linhaStatus}</div>
      ${textoTransicao}
      <div style="color:${visual.cor};font:bold 13px/1.4 Arial,sans-serif;margin-top:10px;">${rotuloAtual}</div>
      ${severidadeTexto ? `<div style="color:${visual.cor};font:bold 12px/1.4 Arial,sans-serif;margin-top:5px;">${esc(severidadeTexto)}</div>` : ""}
      ${detalhe ? `<div style="font:13px/1.55 Arial,sans-serif;margin-top:12px;">${avisoOficial && !normalizacaoOficial ? "<strong>Motivo do aviso:</strong> " : ""}${esc(detalhe)}</div>` : ""}
      ${Array.isArray(instrucoesOficiais) && instrucoesOficiais.length ? `<div style="font:13px/1.55 Arial,sans-serif;margin-top:9px;"><strong>Instruções oficiais:</strong> ${instrucoesOficiais.map(esc).join(" ")}</div>` : ""}
      ${janela ? `<div style="color:#555555;font:12px/1.5 Arial,sans-serif;margin-top:9px;">${avisoOficial ? "Vigência" : "Período"}: ${esc(janela)}</div>` : ""}
      ${fonteDados ? `<div style="color:#555555;font:12px/1.5 Arial,sans-serif;margin-top:6px;">Fonte de dados: ${esc(fonteDados)}</div>` : ""}
      ${recomendacoesHtml(recomendacoes)}
    </td></tr>
  </table>`;
}

const PADRAO_TRANSICAO = /(NORMAL|ATEN(?:ÇÃO|CAO)|ALERTA|EMERG(?:ÊNCIA|ENCIA))(?:\s+P\d)?\s*→\s*(NORMAL|ATEN(?:ÇÃO|CAO)|ALERTA|EMERG(?:ÊNCIA|ENCIA))(?:\s+P\d)?/i;

function normalizarSetas(valor) {
  return String(valor || "").replace(/\s*(?:--?>|→)\s*/g, " → ");
}

function nomeFenomenoMudanca(rotulo) {
  const valor = String(rotulo || "Mudança meteorológica").replace(/:\s*$/, "").trim();
  if (/^grau\s+geral$/i.test(valor)) return "GERAL";
  return valor.replace(/^gatilho\s+de\s+/i, "").toUpperCase();
}

function interpretarMudanca(valor) {
  const texto = normalizarSetas(valor);
  const transicao = PADRAO_TRANSICAO.exec(texto);
  if (!transicao) return { tipo: "numerica", texto };
  return {
    tipo: "status",
    fenomeno: nomeFenomenoMudanca(texto.slice(0, transicao.index)),
    grauAnterior: normalizarGrau(transicao[1]),
    grau: normalizarGrau(transicao[2]),
    texto,
  };
}

function renderMudancaNeutra(mudanca) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;background:#F5F7F8;border:1px solid #B0BEC5;border-left:5px solid #607D8B;margin:0 0 12px;">
    <tr><td style="padding:13px 18px;color:#37474F;font-family:Arial,sans-serif;">
      <div style="font:bold 13px/1.35 Arial,sans-serif;">ATUALIZAÇÃO DE PREVISÃO</div>
      <div style="font:13px/1.5 Arial,sans-serif;margin-top:6px;">${esc(mudanca.texto)}</div>
    </td></tr>
  </table>`;
}

function renderDailyChanges(mudancas) {
  if (!Array.isArray(mudancas) || !mudancas.length) return "";
  return mudancas.map((item) => {
    const mudanca = interpretarMudanca(item);
    if (mudanca.tipo === "status") {
      return renderStatusChangeCard({
        tipo: mudanca.fenomeno,
        grauAnterior: mudanca.grauAnterior,
        grau: mudanca.grau,
      });
    }
    return renderMudancaNeutra(mudanca);
  }).join("");
}

module.exports = {
  EMAIL_STATUS,
  classificacaoMudanca,
  esc,
  interpretarMudanca,
  normalizarGrau,
  renderDailyChanges,
  renderEmailHeader,
  renderInstitutionalHeader,
  renderStatusChangeCard,
  statusEmail,
};
