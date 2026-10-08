// Modelo único dos cards de alerta do Informativo (e-mail e PDF): quais cards
// entram, em que ordem, com quais cores, informações e recomendações. Os dois
// renderizadores só convertem este modelo em HTML — assim ordem, cores e
// recomendações não divergem entre o corpo do e-mail e o PDF anexado.
const AlertTitle = require("../../public/alert-title");
const { ordenarEventosParaExibicao } = require("./eventOrdering");
const { consolidarAvisosInmet, grauAvisoInmet } = require("../sources/inmet");
const {
  TIPOS_DOCUMENTO,
  alertaExibivel,
  avisosExibiveis,
  deveExibirNoDocumento,
  informativoProgramado,
  resolverRecomendacoesAlerta,
} = require("../logic/alertPresentation");

// cor: borda, faixa lateral e ícone · fundo: card inteiro · texto: título
// e destaques sobre fundo claro (ATENÇÃO usa tom escuro para leitura) · selo:
// etiqueta de severidade com textoSelo legível sobre ela.
const VISUAL_NIVEL = Object.freeze({
  "EMERGÊNCIA": Object.freeze({ rotulo: "EMERGENCIAL", cor: "#C62828", fundo: "#FDECEA", texto: "#B71C1C", selo: "#C62828", textoSelo: "#FFFFFF" }),
  ALERTA: Object.freeze({ rotulo: "ALERTA", cor: "#EF6C00", fundo: "#FFF1E0", texto: "#B34700", selo: "#E65100", textoSelo: "#FFFFFF" }),
  "ATENÇÃO": Object.freeze({ rotulo: "ATENÇÃO", cor: "#F9A825", fundo: "#FFF8D6", texto: "#5C4400", selo: "#FBC02D", textoSelo: "#1F1A00" }),
  NORMAL: Object.freeze({ rotulo: "NORMAL", cor: "#2E7D32", fundo: "#E8F5E9", texto: "#2E7D32", selo: "#2E7D32", textoSelo: "#FFFFFF" }),
});

const ORIGEM_RECOMENDACOES = Object.freeze({
  local: "Protocolo Meteorológico do COMPARTILHADO",
  inmet: "Orientações oficiais do INMET",
  fallback: "Protocolo Meteorológico do COMPARTILHADO",
});

function nivelCanonico(grau) {
  return AlertTitle.normalizarGrau(grau) || "NORMAL";
}

function visualNivel(grau) {
  return VISUAL_NIVEL[nivelCanonico(grau)];
}

function presente(valor) {
  return valor !== null && valor !== undefined && valor !== "";
}

function listaOficial(valor) {
  if (Array.isArray(valor)) return valor.filter(presente).map(String);
  return presente(valor) ? [String(valor)] : [];
}

function linha(rotulo, texto, extra = {}) {
  return presente(texto) ? { rotulo, texto: String(texto), ...extra } : null;
}

function unidade(valor, sufixo) {
  return valor === null || valor === undefined ? "indisponível" : `${valor} ${sufixo}`;
}

// NORMAL não recebe recomendações — mesma regra que já valia nos dois formatos.
function recomendacoesDoCard(grau, resolver) {
  if (!alertaExibivel(grau)) return null;
  const resolucao = resolver();
  return {
    titulo: ORIGEM_RECOMENDACOES[resolucao.origem] || ORIGEM_RECOMENDACOES.local,
    origem: resolucao.origem,
    itens: resolucao.itens,
  };
}

function eventosDoRelatorio(r, tipoDocumento) {
  const eventos = r.severidade?.eventos || (r.eventoMaisRelevante ? [r.eventoMaisRelevante] : []);
  return (Array.isArray(eventos) ? eventos : []).filter((evento) =>
    evento && evento.tipo !== "avisoInmet"
    && deveExibirNoDocumento({ nivel: evento.grau || AlertTitle.normalizarGrau(evento.titulo), tipoDocumento })
  );
}

function cardEvento(evento, r) {
  const nivel = nivelCanonico(evento.grau || AlertTitle.normalizarGrau(evento.titulo) || r.severidade?.grau);
  return {
    origem: "previsao",
    nivel,
    titulo: AlertTitle.tituloEvento(evento, nivel),
    rotuloOrigem: "Previsão meteorológica",
    linhas: [
      linha(null, evento.descricao),
      linha("Janela prevista", evento.janela),
      linha("Fonte de dados", evento.fonteDados || "Indisponível"),
    ].filter(Boolean),
    recomendacoes: recomendacoesDoCard(nivel, () => resolverRecomendacoesAlerta({ evento, avisosInmet: r.avisosInmet })),
  };
}

function cardCalor(r, detalhado) {
  const dados = r.climaSaude?.dados;
  const nivel = nivelCanonico(dados.nivel?.grau);
  const temperatura = dados.temperatura || {};
  const ehf = `${dados.ehf?.classificacao || "Indisponível"}${dados.ehf?.valor == null ? "" : ` (${dados.ehf.valor})`}`;
  const linhas = detalhado
    ? [
      linha("EHF", ehf),
      linha("Temperatura média", unidade(temperatura.media, "°C")),
      linha("Temperatura máxima prevista", unidade(temperatura.maxima, "°C")),
      linha("Temperatura mínima", unidade(temperatura.minima, "°C")),
      linha("RISCO COMBINADO À SAÚDE", dados.riscoCombinado),
      linha("GeoSES / vulnerabilidade social", dados.geoses?.valor == null
        ? "indisponível"
        : `${dados.geoses.valor}${dados.geoses.classificacao ? ` (${dados.geoses.classificacao})` : ""}`),
      linha("Consulta", presente(dados.consultadoEm)
        ? `${dados.consultadoEm}${r.climaSaude.status === "armazenado" ? " — última coleta válida armazenada" : ""}`
        : null),
      (dados.previsaoDias || []).length ? {
        rotulo: "Previsão Clima e Saúde",
        lista: dados.previsaoDias.map((dia) =>
          `${dia.data}: EHF ${dia.classificacao}; máxima ${dia.tempMax == null ? "indisponível" : `${dia.tempMax} °C`}`),
      } : null,
      linha("Fonte de dados", dados.source || "Indisponível"),
    ]
    : [
      linha("EHF", `${dados.ehf?.classificacao || "Indisponível"} · Temperatura máxima prevista: ${unidade(temperatura.maxima, "°C")}`),
      linha("RISCO COMBINADO À SAÚDE", dados.riscoCombinado),
      linha("Fonte de dados", dados.source || "Indisponível"),
    ];
  return {
    origem: "calor",
    nivel,
    titulo: AlertTitle.formatarTitulo("CALOR / RISCO À SAÚDE", nivel),
    rotuloOrigem: "Clima e Saúde",
    linhas: linhas.filter(Boolean),
    recomendacoes: recomendacoesDoCard(nivel, () => resolverRecomendacoesAlerta({
      evento: { fenomeno: "calor", grau: nivel, recomendacoes: dados.recomendacoes },
      avisosInmet: r.avisosInmet,
    })),
  };
}

function cardAvisoInmet(aviso, eventosLocais) {
  const evento = aviso.event || aviso.evento || aviso.descricao || aviso.headline;
  const severidade = aviso.severity || aviso.severidade;
  const inicio = aviso.onset || aviso.inicio;
  const fim = aviso.expires || aviso.fim;
  const nivel = nivelCanonico(grauAvisoInmet(severidade));
  const recomendacoes = recomendacoesDoCard(nivel, () => resolverRecomendacoesAlerta({ aviso, eventosLocais }));
  // Quando as recomendações já são as instruções oficiais, elas aparecem só
  // na seção RECOMENDAÇÕES (sem repetir o mesmo texto dentro do card).
  const instrucoes = recomendacoes?.origem === "inmet" ? [] : listaOficial(aviso.instruction || aviso.instrucoes);
  return {
    origem: "inmet",
    nivel,
    titulo: AlertTitle.formatarTitulo(evento || "Aviso oficial INMET", nivel),
    rotuloOrigem: "Aviso oficial INMET",
    linhas: [
      linha("Aviso", `${evento || "—"} — ${severidade || "—"}`),
      presente(inicio) || presente(fim) ? linha("Vigência", `${inicio || "—"} até ${fim || "—"}`) : null,
      linha("Motivo do aviso", listaOficial(aviso.description || aviso.riscos).join("\n") || null, { multilinha: true }),
      instrucoes.length ? linha("Instruções oficiais", instrucoes.join("\n"), { multilinha: true }) : null,
      linha("Fonte de dados", "INMET"),
    ].filter(Boolean),
    recomendacoes,
  };
}

function cardCondicoesNormais() {
  return {
    origem: "condicoes",
    nivel: "NORMAL",
    titulo: AlertTitle.formatarTitulo("CONDIÇÕES METEOROLÓGICAS", "NORMAL"),
    rotuloOrigem: "Previsão meteorológica",
    linhas: [linha(null, "Não foram identificadas condições meteorológicas que atinjam os níveis de Atenção, Alerta ou Emergência no período analisado.")],
    recomendacoes: null,
  };
}

/**
 * Cards de alerta do Informativo, já ordenados por severidade:
 * EMERGÊNCIA → ALERTA → ATENÇÃO → NORMAL (estável dentro do mesmo nível).
 * As regras de exibição não mudam: o filtro de cada fonte usa o mesmo
 * `tipoDocumento` de antes (o e-mail usa o filtro de alerta extraordinário,
 * que oculta NORMAL; o PDF dos informativos programados inclui NORMAL).
 *
 * @param {object} r relatório
 * @param {object} [opcoes]
 * @param {string} [opcoes.tipoDocumento]
 * @param {boolean} [opcoes.detalhado] linhas completas do Clima e Saúde (PDF)
 * @param {boolean} [opcoes.cardCondicoesNormais] card "CONDIÇÕES — NORMAL"
 *   quando o informativo programado não tem nenhum evento (PDF)
 */
function montarCardsAlerta(r, { tipoDocumento = TIPOS_DOCUMENTO.EXTRAORDINARIO, detalhado = false, cardCondicoesNormais: incluirNormal = false } = {}) {
  const eventos = eventosDoRelatorio(r, tipoDocumento);
  const cards = eventos.map((evento) => cardEvento(evento, r));

  if (r.climaSaude?.dados && deveExibirNoDocumento({ nivel: r.climaSaude.dados.nivel?.grau || "NORMAL", tipoDocumento })) {
    cards.push(cardCalor(r, detalhado));
  }

  for (const aviso of avisosExibiveis(consolidarAvisosInmet(r.avisosInmet), tipoDocumento)) {
    cards.push(cardAvisoInmet(aviso, eventos));
  }

  if (incluirNormal && !eventos.length && informativoProgramado(tipoDocumento) && (r.severidade?.grau || "NORMAL") === "NORMAL") {
    cards.push(cardCondicoesNormais());
  }

  return ordenarEventosParaExibicao(cards.map((card) => ({ ...card, grau: card.nivel, visual: visualNivel(card.nivel) })));
}

module.exports = { ORIGEM_RECOMENDACOES, VISUAL_NIVEL, montarCardsAlerta, visualNivel };
