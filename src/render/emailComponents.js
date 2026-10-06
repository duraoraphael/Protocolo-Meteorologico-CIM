const { HEADER_AMARELO, HEADER_VERDE, srcLogoEmail } = require("../config/headerAssets");
const AlertTitle = require("../../public/alert-title");

const EMAIL_HEADER_VERDE = HEADER_VERDE;
const EMAIL_HEADER_AMARELO = HEADER_AMARELO;
// Amarelo do "I" na marca original (Logo/Logo_PDF.png).
const EMAIL_CIM_AMARELO = "#FEBF0A";
// petrobras-header.png tem 640x165 (logo colorida em cartão branco);
// exibida a 150px de largura.
const EMAIL_PETROBRAS_LARGURA = 150;
const EMAIL_PETROBRAS_ALTURA = 39;

const EMAIL_STATUS = Object.freeze({
  NORMAL: Object.freeze({ cor: "#2E7D32", fundo: "#E8F5E9", selo: "#2E7D32", textoSelo: "#FFFFFF" }),
  "ATENÇÃO": Object.freeze({ cor: "#9A7600", fundo: "#FFF9DB", selo: "#FBC02D", textoSelo: "#222222" }),
  ALERTA: Object.freeze({ cor: "#EF6C00", fundo: "#FFF3E0", selo: "#EF6C00", textoSelo: "#FFFFFF" }),
  "EMERGÊNCIA": Object.freeze({ cor: "#C62828", fundo: "#FFEBEE", selo: "#C62828", textoSelo: "#FFFFFF" }),
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
  return AlertTitle.normalizarGrau(valor);
}

function nivelExibicao(grau) {
  return normalizarGrau(grau) || "NORMAL";
}

function nomeParametroAlerta(tipo) {
  return AlertTitle.nomeParametro(tipo || "Condições meteorológicas");
}

function statusEmail(grau) {
  return EMAIL_STATUS[normalizarGrau(grau)] || EMAIL_STATUS.NORMAL;
}

function identidadeCimHtml() {
  // Réplica em HTML da marca de Logo/Logo_PDF.png: "CIM" em letras pesadas
  // e próximas (o "I" em Arial Black é uma barra retangular, aqui amarela),
  // divisória branca e o texto institucional. Não depende de imagem, então
  // continua legível quando Gmail/Outlook bloqueiam imagens.
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;"><tr>
    <td valign="middle" style="padding:0 11px 0 0;color:#ffffff;font-family:'Arial Black','Arial Bold',Arial,sans-serif;font-size:42px;font-weight:900;line-height:42px;letter-spacing:-3px;white-space:nowrap;mso-line-height-rule:exactly;"><span style="color:#ffffff;">C</span><span style="color:${EMAIL_CIM_AMARELO};">I</span><span style="color:#ffffff;">M</span></td>
    <td valign="middle" style="border-left:2px solid #ffffff;padding:1px 0 1px 11px;color:#ffffff;font-family:Arial,sans-serif;font-size:13px;font-weight:bold;line-height:15px;white-space:nowrap;mso-line-height-rule:exactly;">Centro Integrado<br>de Monitoramento<br><span style="color:#ffffff;font-weight:normal;font-size:12px;letter-spacing:1.2px;">COMPARTILHADO</span></td>
  </tr></table>`;
}

function petrobrasHtml() {
  // Logo em cartão branco embutido na própria imagem (aparece igual em
  // Gmail e Outlook), anexada inline por Content-ID — ver
  // src/config/headerAssets.js e scripts/gerarLogosHeader.js.
  const src = srcLogoEmail("petrobras");
  if (src) {
    return `<img src="${src}" width="${EMAIL_PETROBRAS_LARGURA}" height="${EMAIL_PETROBRAS_ALTURA}" alt="Petrobras" style="display:block;width:${EMAIL_PETROBRAS_LARGURA}px;height:auto;max-width:100%;border:0;outline:none;text-decoration:none;color:#ffffff;font:italic bold 20px/1.2 Arial,sans-serif;">`;
  }
  return `<span style="color:#ffffff;font:italic bold 20px/1.2 Arial,sans-serif;">PETROBRAS</span>`;
}

function linhaLocal({ cidade, uf, data, contexto }) {
  if (contexto) return esc(contexto);
  const partes = [cidade, uf, data].filter((item) => item !== null && item !== undefined && item !== "");
  return partes.length ? partes.map(esc).join(" — ") : "—";
}

function renderEmailHeader({ titulo, cidade, uf, data, contexto }) {
  return `<tr data-email-header="true"><td bgcolor="${EMAIL_HEADER_VERDE}" style="background:${EMAIL_HEADER_VERDE};padding:16px 22px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;"><tr>
      <td data-email-header-cim="true" width="31%" valign="middle" align="left" style="width:31%;color:#ffffff;">${identidadeCimHtml()}</td>
      <td data-email-header-title="true" width="47%" valign="middle" align="center" style="width:47%;color:#ffffff;padding:0 10px;text-align:center;">
        <div style="color:#ffffff;font-family:Arial,sans-serif;font-size:21px;font-weight:bold;line-height:25px;letter-spacing:0.3px;text-align:center;">${esc(titulo)}</div>
        <div data-email-header-local="true" style="color:#ffffff;font-family:Arial,sans-serif;font-size:13px;line-height:18px;margin-top:6px;text-align:center;">${linhaLocal({ cidade, uf, data, contexto })}</div>
      </td>
      <td data-email-header-petrobras="true" width="22%" valign="middle" align="right" style="width:22%;text-align:right;line-height:0;">${petrobrasHtml()}</td>
    </tr></table>
  </td></tr>
  <tr data-email-header-stripe="true"><td bgcolor="${EMAIL_HEADER_AMARELO}" style="height:4px;background:${EMAIL_HEADER_AMARELO};font-size:0;line-height:4px;mso-line-height-rule:exactly;">&nbsp;</td></tr>`;
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
  const fundo = atual ? visual.selo : visual.fundo;
  const corTexto = atual ? visual.textoSelo : "#333333";
  return `<span style="display:inline-block;border:2px solid ${visual.cor};background:${fundo};color:${corTexto};padding:7px 12px;font:bold 14px/1.1 Arial,sans-serif;white-space:nowrap;">${esc(nivelExibicao(normalizado))}</span>`;
}

function recomendacoesHtml(itens) {
  if (!Array.isArray(itens) || !itens.length) return "";
  return `<div data-alert-recommendations="true" style="border-top:1px solid #E5E7E6;margin-top:16px;padding-top:14px;color:#333333;font:13px/1.5 Arial,sans-serif;"><strong style="display:block;color:#333333;font-size:13px;line-height:1.4;text-transform:uppercase;">Recomendações – Protocolo Meteorológico do COMPARTILHADO</strong><ul style="margin:9px 0 0 20px;padding:0;">${itens.map((item) => `<li data-alert-recommendation="true" style="margin-bottom:7px;">${esc(item)}</li>`).join("")}</ul></div>`;
}

function renderStatusChangeCard({ tipo, grauAnterior, grau, motivo, detalhe, janela, fonteDados, protocolo, naturezaDado, severidadeTexto, instrucoesOficiais, recomendacoes }) {
  const atual = normalizarGrau(grau) || "NORMAL";
  const anterior = normalizarGrau(grauAnterior);
  const visual = statusEmail(atual);
  const classificacao = classificacaoMudanca(anterior, atual, motivo);
  const fenomeno = nomeParametroAlerta(tipo);
  const nivelAtual = nivelExibicao(atual);
  const avisoOficial = naturezaDado === "Aviso oficial";
  const normalizacaoOficial = avisoOficial && atual === "NORMAL";
  const tituloMudanca = avisoOficial
    ? `${normalizacaoOficial ? "NORMALIZAÇÃO" : "MUDANÇA"} DE AVISO OFICIAL INMET`
    : "MUDANÇA DE STATUS";
  const linhaStatus = anterior
    ? `${seloStatus(anterior)}<span style="display:inline-block;padding:0 12px;color:#333333;font:bold 22px/1 Arial,sans-serif;vertical-align:middle;">→</span>${seloStatus(atual, true)}`
    : `${seloStatus(atual, true)}`;
  const textoTransicao = anterior
    ? `<div style="color:#555555;font:12px/1.4 Arial,sans-serif;margin-top:10px;">Mudança de gatilho: <strong>${esc(nivelExibicao(anterior))} → ${esc(nivelAtual)}</strong></div>`
    : "";
  const tituloAtual = AlertTitle.formatarTitulo(fenomeno, atual);

  return `<table data-alert-card="true" role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;background:#FFFFFF;border:1.5px solid ${visual.cor};border-left:5px solid ${visual.cor};margin:0 0 14px;">
    <tr><td style="padding:15px 18px;color:#333333;font-family:Arial,sans-serif;">
      <div style="color:#666666;font:bold 10px/1.3 Arial,sans-serif;letter-spacing:0.7px;text-transform:uppercase;">${esc(tituloMudanca)} · ${esc(classificacao)}</div>
      <div data-alert-title="true" style="color:${visual.cor};font:bold 18px/1.3 Arial,sans-serif;margin-top:5px;">${esc(tituloAtual)}</div>
      <div data-alert-level="${esc(nivelAtual)}" style="color:#333333;font:13px/1.45 Arial,sans-serif;margin-top:8px;"><strong>Classificação:</strong> ${esc(nivelAtual)}</div>
      ${protocolo ? `<div style="color:#555555;font:12px/1.45 Arial,sans-serif;margin-top:4px;"><strong>Protocolo aplicável:</strong> ${esc(protocolo)}</div>` : ""}
      <div style="margin-top:12px;">${linhaStatus}</div>
      ${textoTransicao}
      ${severidadeTexto ? `<div style="color:${visual.cor};font:bold 12px/1.4 Arial,sans-serif;margin-top:5px;">${esc(severidadeTexto)}</div>` : ""}
      ${detalhe ? `<div style="font:13px/1.55 Arial,sans-serif;margin-top:12px;"><strong>${avisoOficial && !normalizacaoOficial ? "Motivo do aviso" : "Informação meteorológica"}:</strong> ${esc(detalhe)}</div>` : ""}
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
  nivelExibicao,
  nomeParametroAlerta,
  normalizarGrau,
  renderDailyChanges,
  renderEmailHeader,
  renderInstitutionalHeader,
  renderStatusChangeCard,
  statusEmail,
};
