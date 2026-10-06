const { esc } = require("./pdfTemplate");
const { renderDailyChanges, renderEmailHeader } = require("./emailComponents");
const { ordenarEventosParaExibicao } = require("./eventOrdering");
const { consolidarAvisosInmet } = require("../sources/inmet");
const { formatarDataBrasilia } = require("../sources/sourceHealth");
const { cartaoCorRioEmail } = require("./corRioEmail");
const AlertTitle = require("../../public/alert-title");
const { calorPorData, dataLocal } = require("../logic/calorPorData");

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

function corGrau(grau) {
  const normalizado = String(grau || "").toUpperCase();
  if (normalizado.includes("EMERGÊNCIA") || normalizado.includes("EMERGENCIA")) return "#B71C1C";
  if (normalizado.includes("ALERTA")) return "#D32F2F";
  if (normalizado.includes("ATENÇÃO") || normalizado.includes("ATENCAO")) return "#F57C00";
  return "#2E7D32";
}

// O laranja de ATENÇÃO (#F57C00) fica abaixo do contraste mínimo como texto
// sobre branco; bordas mantêm a cor original e textos usam o tom escuro.
function corTexto(cor) {
  return cor === "#F57C00" ? "#E65100" : cor;
}

function corAvisoInmet(severidade) {
  const valor = String(severidade || "").toLowerCase();
  if (valor.includes("grande perigo") || valor.includes("extreme")) return "#B71C1C";
  if (valor.includes("perigo") || valor.includes("severe")) return "#D32F2F";
  if (valor.includes("atenção") || valor.includes("atencao") || valor.includes("moderate")) return "#F57C00";
  return "#2E7D32";
}

function celulaMetrica(rotulo, valor, ultimaColuna = false) {
  return `<td width="33.33%" valign="middle" align="center" bgcolor="${COR.celula}" style="width:33.33%;background:${COR.celula};border-right:${ultimaColuna ? "0" : `1px solid ${COR.borda}`};border-bottom:1px solid ${COR.borda};padding:13px 8px 12px;text-align:center;">
    <div style="color:${COR.secundario};font:13px/1.3 Arial,sans-serif;text-transform:uppercase;">${rotulo}</div>
    <div style="color:${COR.texto};font:bold 25px/1.2 Arial,sans-serif;margin-top:3px;">${valor}</div>
  </td>`;
}

// Card "CALOR": classificação de hoje do Clima e Saúde (EHF), na cor do
// nível. Sem classificação para a data → "Indisponível", nunca "Normal".
function valorCalor(r) {
  const hoje = dataLocal(r.geradoEmISO || Date.now(), r.cidade?.fuso);
  const calor = calorPorData(r.climaSaude, hoje);
  if (!calor) return `<span style="color:${COR.secundario};font:bold 21px/1.2 Arial,sans-serif;">Indisponível</span>`;
  return `<span style="color:${corTexto(corGrau(calor.grau))};">${esc(calor.rotulo)}</span>`;
}

function resumoMeteorologico(r) {
  const rajada = rajadaMaxima(r);
  const ar = texto(r.qualidadeAr?.pm25Classificacao?.nivel);
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${COR.celula}" style="width:100%;background:${COR.celula};border:1px solid ${COR.borda};border-bottom:0;border-collapse:separate;">
    <tr>
      ${celulaMetrica("TEMP. MÍN/MÁX", parOuTraco(r.tempMin, r.tempMax, "°", "°C"))}
      ${celulaMetrica("UMIDADE MÍN/MÁX", parOuTraco(r.umidadeMin, r.umidadeMax, "%", "%"))}
      ${celulaMetrica("RAJADA PREVISTA", numeroUnidade(rajada.valor, "km/h"), true)}
    </tr>
    <tr>
      ${celulaMetrica("QUALIDADE DO AR", ar)}
      ${celulaMetrica("CHUVA ACUMULADA", numeroUnidade(r.precipitacaoTotalMm, "mm"))}
      ${celulaMetrica("CALOR", valorCalor(r), true)}
    </tr>
  </table>`;
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
      <td class="email-stack" width="50%" valign="top" style="width:50%;padding-left:4px;">${celulaComplementar("CONDIÇÃO GERAL", texto(r.condicaoGeral), "Previsão para o dia")}</td>
    </tr>
  </table>`;
}

function cartao(titulo, cor, linhas, corTitulo = cor) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${COR.celula}" style="width:100%;background:${COR.celula};border:1.5px solid ${cor};border-left:5px solid ${cor};margin-top:9px;">
    <tr><td bgcolor="${COR.celula}" style="padding:13px 18px 14px;background:${COR.celula};color:${COR.texto};font:15px/1.5 Arial,sans-serif;">
      <div style="color:${corTexto(corTitulo)};font:bold 20px/1.25 Arial,sans-serif;margin-bottom:5px;">${titulo}</div>
      ${linhas.join("")}
    </td></tr>
  </table>`;
}

function eventosLocais(r) {
  const todos = r.severidade?.eventos || (r.eventoMaisRelevante ? [r.eventoMaisRelevante] : []);
  return ordenarEventosParaExibicao(
    (Array.isArray(todos) ? todos : []).filter((evento) => evento && evento.tipo !== "avisoInmet")
  );
}

function cartaoEvento(evento, grauGeral) {
  const grau = evento.grau || AlertTitle.normalizarGrau(evento.titulo) || grauGeral;
  const linhas = [
    `<div>${texto(evento.descricao)}</div>`,
    presente(evento.janela) ? `<div style="margin-top:3px;"><em>Janela prevista:</em> ${esc(evento.janela)}</div>` : "",
    `<div style="margin-top:3px;">Fonte de dados: ${texto(evento.fonteDados)}</div>`,
  ];
  return cartao(esc(AlertTitle.tituloEvento(evento, grau)), corGrau(grau), linhas);
}

function cartaoCalor(climaSaude) {
  const dados = climaSaude?.dados;
  if (!dados) return "";
  const grau = dados.nivel?.grau || "NORMAL";
  const temp = numeroUnidade(dados.temperatura?.maxima, "°C");
  const linhas = [
    `<div>EHF: ${texto(dados.ehf?.classificacao)} · Temperatura máxima prevista: ${temp}</div>`,
    `<div style="margin-top:3px;">RISCO COMBINADO À SAÚDE: ${texto(dados.riscoCombinado)}</div>`,
    `<div style="margin-top:3px;">Fonte de dados: ${texto(dados.source)}</div>`,
  ];
  return cartao(esc(AlertTitle.formatarTitulo("CALOR / RISCO À SAÚDE", grau)), corGrau(grau), linhas);
}

function listaOficial(valor) {
  if (Array.isArray(valor)) return valor.filter(presente);
  return presente(valor) ? [valor] : [];
}

function textoOficial(valor) {
  return esc(valor).replace(/\r?\n/g, "<br>");
}

function avisosInmet(r) {
  const avisos = consolidarAvisosInmet(r.avisosInmet);
  return avisos.map((aviso) => {
    const evento = aviso.event || aviso.evento || aviso.descricao || aviso.headline;
    const severidade = aviso.severity || aviso.severidade;
    const inicio = aviso.onset || aviso.inicio;
    const fim = aviso.expires || aviso.fim;
    const cor = corAvisoInmet(severidade);
    const vigencia = presente(inicio) || presente(fim)
      ? `<div style="margin-top:3px;">Vigência: ${texto(inicio)} até ${texto(fim)}</div>` : "";
    const riscos = listaOficial(aviso.description || aviso.riscos);
    const instrucoes = listaOficial(aviso.instruction || aviso.instrucoes);
    const linhas = [
      `<div style="color:${COR.texto};">${texto(evento)} — <strong style="color:${COR.texto};">${texto(severidade)}</strong></div>`,
      vigencia,
      riscos.length ? `<div style="margin-top:3px;"><strong>Motivo do aviso:</strong> ${riscos.map(textoOficial).join(" ")}</div>` : "",
      instrucoes.length ? `<div style="margin-top:3px;"><strong>Instruções oficiais:</strong><br>${instrucoes.map(textoOficial).join("<br>")}</div>` : "",
      `<div style="margin-top:3px;">Fonte: INMET</div>`,
    ];
    return cartao("AVISO OFICIAL INMET", cor, linhas, corGrau("ALERTA"));
  }).join("");
}

function nomeFenomeno(evento) {
  return AlertTitle.nomeParametro(evento.fenomeno || evento.titulo || evento.tipo);
}

function grupoRecomendacoes(rotulo, grau, itens) {
  if (!Array.isArray(itens) || !itens.length) return null;
  return { rotulo, cor: corGrau(grau), itens: itens.filter(presente) };
}

function recomendacoes(r, eventos) {
  const grupos = eventos.map((evento) => grupoRecomendacoes(nomeFenomeno(evento), evento.grau || evento.titulo, evento.recomendacoes)).filter(Boolean);
  const dadosCalor = r.climaSaude?.dados;
  const calor = dadosCalor && grupoRecomendacoes("CALOR / RISCO À SAÚDE", dadosCalor.nivel?.grau, dadosCalor.recomendacoes);
  if (calor) grupos.push(calor);
  if (!grupos.length) return "";
  // Até três colunas por linha; tabelas mantêm a leitura em Outlook sem Flexbox.
  const linhas = [];
  for (let i = 0; i < grupos.length; i += 3) {
    const fatia = grupos.slice(i, i + 3);
    linhas.push(`<tr>${fatia.map((grupo) => `<td class="email-stack" width="${Math.floor(100 / fatia.length)}%" valign="top" style="width:${Math.floor(100 / fatia.length)}%;padding:4px 15px 7px 4px;color:${COR.texto};font:14px/1.4 Arial,sans-serif;">
      <div style="color:${corTexto(grupo.cor)};font:bold 16px/1.3 Arial,sans-serif;margin-bottom:5px;">${esc(grupo.rotulo)}:</div>
      <ul style="margin:0;padding-left:20px;">${grupo.itens.map((item) => `<li style="margin-bottom:3px;">${esc(item)}</li>`).join("")}</ul>
    </td>`).join("")}</tr>`);
  }
  return `<tr><td bgcolor="${COR.painel}" style="padding:11px 25px 2px;background:${COR.painel};">
    <div style="color:${COR.verde};font:bold 19px/1.3 Arial,sans-serif;margin-bottom:5px;">Recomendações - Protocolo Meteorológico do COMPARTILHADO</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${COR.painel}" style="width:100%;background:${COR.painel};">${linhas.join("")}</table>
  </td></tr>`;
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

function renderEmailHtml(r) {
  const eventos = eventosLocais(r);
  const normal = !eventos.length && r.severidade?.grau === "NORMAL"
    ? cartao(AlertTitle.formatarTitulo("CONDIÇÕES METEOROLÓGICAS", "NORMAL"), corGrau("NORMAL"), ["<div>Não foram identificadas condições meteorológicas que atinjam os níveis de Atenção, Alerta ou Emergência no período analisado.</div>"])
    : "";
  const mudancas = renderDailyChanges(r.mudancasDia);

  return `<!doctype html>
<html lang="pt-BR">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light only"></head>
<body bgcolor="${COR.fundo}" style="margin:0;padding:0;background:${COR.fundo};background-color:${COR.fundo};color:${COR.texto};font-family:Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${COR.fundo}" style="width:100%;background:${COR.fundo};background-color:${COR.fundo};">
    <tr><td align="center" bgcolor="${COR.fundo}" style="padding:8px 6px;background:${COR.fundo};">
      <!--[if mso]><table role="presentation" width="850" cellpadding="0" cellspacing="0" bgcolor="${COR.painel}"><tr><td bgcolor="${COR.painel}"><![endif]-->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${COR.painel}" style="width:100%;max-width:850px;background:${COR.painel};background-color:${COR.painel};color:${COR.texto};border:1px solid ${COR.borda};">
        ${renderEmailHeader({
          titulo: "INFORMATIVO METEOROLÓGICO",
          cidade: r.cidade?.nome,
          uf: r.cidade?.uf,
          data: r.dataFormatadaLonga,
        })}
        <tr><td class="email-pad" bgcolor="${COR.painel}" style="background:${COR.painel};padding:11px 25px 3px;color:${COR.texto};font:16px/1.4 Arial,sans-serif;"><strong>Hora da consulta:</strong> ${texto(r.horaConsulta)} (Horário de Brasília)</td></tr>
        <tr><td class="email-pad" bgcolor="${COR.painel}" style="background:${COR.painel};padding:5px 20px;">${resumoMeteorologico(r)}</td></tr>
        <tr><td class="email-pad" bgcolor="${COR.painel}" style="background:${COR.painel};padding:3px 20px 0;">${marECondicao(r)}</td></tr>
        <tr><td class="email-pad" bgcolor="${COR.painel}" style="background:${COR.painel};padding:2px 20px 0;">${eventos.map((evento) => cartaoEvento(evento, r.severidade?.grau)).join("")}${normal}${cartaoCalor(r.climaSaude)}${mudancas}</td></tr>
        <tr><td class="email-pad" bgcolor="${COR.painel}" style="background:${COR.painel};padding:0 20px;">${cartaoCorRioEmail(r)}${avisosInmet(r)}</td></tr>
        ${recomendacoes(r, eventos)}
        <tr><td class="email-pad" bgcolor="${COR.painel}" style="background:${COR.painel};padding:10px 25px 6px;color:${COR.texto};font:14px/1.4 Arial,sans-serif;"><strong>Fontes de dados:</strong><br>${fontesDeDados(r, eventos)}</td></tr>
        <tr><td class="email-pad" bgcolor="${COR.painel}" style="background:${COR.painel};padding:0 20px 10px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${COR.celula}" style="width:100%;background:${COR.celula};border:1px solid ${COR.borda};border-left:4px solid ${COR.verde};"><tr><td bgcolor="${COR.celula}" style="padding:11px 17px;background:${COR.celula};color:#333333;font:14px/1.4 Arial,sans-serif;">Relatório completo com todas as tabelas, avisos oficiais, fontes consultadas e recomendações detalhadas em anexo (PDF).</td></tr></table></td></tr>
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
