// Conteúdo do e-mail do informativo exposto ao painel (/api/preview): os
// mesmos valores e cards de alerta que renderEmailHtml usa, para o site
// mostrar nos cards tudo o que o e-mail mostra — sem recalcular nada por
// outro caminho.
const { montarCardsAlerta } = require("../render/alertCards");
const { TIPOS_DOCUMENTO } = require("./alertPresentation");
const email = require("../render/emailTemplate");

function fontesUnicas(fontes) {
  const validas = [...new Set(fontes.filter((f) => f && f !== "Indisponível"))];
  return validas.join(" / ") || null;
}

function conteudoEmailPainel(r) {
  const chuva = email.chuvaPrevistaAcumulada(r);
  const probabilidade = email.probabilidadeChuvaPrevista(r);
  const fontes = r.fontesPorCampo || {};
  const fonteProbabilidade = Number.isFinite(r.probabilidadeChuvaPrevista)
    ? fontesUnicas([fontes.probabilidadeChuvaPrevista])
    : fontesUnicas(["manha", "tarde", "noite"].map((p) => fontes[`periodos.${p}.probabilidadeChuva`]));
  return {
    horaConsulta: r.horaConsulta || null,
    // Fora das edições agendadas o painel cobre o dia operacional (05h–00h).
    frasePrevisao: email.frasePrevisao(r) || "Previsão até 00h",
    chuvaPrevistaMm: Number.isFinite(chuva) ? chuva : null,
    fonteChuvaPrevista: fontesUnicas([fontes.chuvaPrevistaDiaMm, fontes.precipitacaoTotalMm]),
    probabilidadeChuva: Number.isFinite(probabilidade) ? probabilidade : null,
    janelaProbabilidade: r.probabilidadeChuvaJanela || null,
    fonteProbabilidade,
    // Cards de alerta do e-mail (mesmo filtro: só ATENÇÃO ou superior).
    cards: montarCardsAlerta(r, { tipoDocumento: TIPOS_DOCUMENTO.EXTRAORDINARIO }).map((card) => ({
      fenomeno: card.fenomeno || null,
      nivel: card.nivel,
      titulo: card.titulo,
      rotuloOrigem: card.rotuloOrigem,
      linhas: (card.linhas || []).map(({ rotulo, texto, lista, multilinha }) => ({
        rotulo: rotulo || null, texto: texto ?? null, lista: lista || null, multilinha: Boolean(multilinha),
      })),
      recomendacoes: card.recomendacoes?.itens?.length
        ? { titulo: card.recomendacoes.titulo, itens: card.recomendacoes.itens }
        : null,
    })),
    mudancasDia: Array.isArray(r.mudancasDia) ? r.mudancasDia : [],
    fontes: email.FONTES_DADOS_EMAIL,
  };
}

/** Cópia do relatório com `conteudoEmail`; falha aqui nunca derruba o painel. */
function comConteudoEmail(report) {
  try {
    return { ...report, conteudoEmail: conteudoEmailPainel(report) };
  } catch (erro) {
    console.error(`[PAINEL] Conteúdo do e-mail indisponível: ${erro.message}`);
    return report;
  }
}

module.exports = { conteudoEmailPainel, comConteudoEmail };
