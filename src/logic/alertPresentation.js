const { GRAUS, recomendacoesChuvaAvisoInmet } = require("./inmetAlertRules");
const { fenomenoAvisoInmet, grauAvisoInmet, normalizarComparacao } = require("../sources/inmet");

const RECOMENDACAO_NEUTRA =
  "Consulte as orientações oficiais associadas ao aviso meteorológico vigente.";

const TIPOS_DOCUMENTO = Object.freeze({
  INFORMATIVO_05H: "INFORMATIVO_05H",
  INFORMATIVO_15H: "INFORMATIVO_15H",
  EXTRAORDINARIO: "ALERTA_EXTRAORDINARIO",
  ALERTA_CIM: "ALERTA_CIM",
});

const FENOMENO_POR_TIPO = Object.freeze({
  raios: "tempestade",
  chuvaIntensa: "chuva",
  chuvaModerada: "chuva",
  ventoForte: "vento",
  ventoModerado: "vento",
  calorExtremo: "calor",
  baixaUmidade: "baixa-umidade",
  marGrosso: "ressaca",
  marModerado: "ressaca",
  uvAlto: "uv",
  qualidadeArRuim: "ar",
});

function pesoNivel(grau) {
  const canonico = normalizarComparacao(grau);
  return GRAUS[grau] || {
    atencao: GRAUS["ATENÇÃO"],
    alerta: GRAUS.ALERTA,
    emergencia: GRAUS["EMERGÊNCIA"],
    emergencial: GRAUS["EMERGÊNCIA"],
  }[canonico] || 0;
}

function tipoDocumentoPorHorario(horarioAgendado) {
  if (horarioAgendado === "05:00") return TIPOS_DOCUMENTO.INFORMATIVO_05H;
  if (horarioAgendado === "15:00") return TIPOS_DOCUMENTO.INFORMATIVO_15H;
  return TIPOS_DOCUMENTO.EXTRAORDINARIO;
}

function tipoDocumentoDoRelatorio(report) {
  return report?.tipoDocumento || tipoDocumentoPorHorario(report?.horarioAgendado);
}

function informativoProgramado(tipoDocumento) {
  return tipoDocumento === TIPOS_DOCUMENTO.INFORMATIVO_05H
    || tipoDocumento === TIPOS_DOCUMENTO.INFORMATIVO_15H;
}

function deveExibirNoDocumento({ nivel, tipoDocumento = TIPOS_DOCUMENTO.EXTRAORDINARIO } = {}) {
  return informativoProgramado(tipoDocumento) || pesoNivel(nivel) >= GRAUS["ATENÇÃO"];
}

function alertaExibivel(grau) {
  return deveExibirNoDocumento({ nivel: grau, tipoDocumento: TIPOS_DOCUMENTO.EXTRAORDINARIO });
}

function textosUnicos(...valores) {
  const unicos = new Map();
  for (const valor of valores.flat(Infinity)) {
    const texto = typeof valor === "string" ? valor.trim() : "";
    const chave = normalizarComparacao(texto);
    if (texto && chave && !unicos.has(chave)) unicos.set(chave, texto);
  }
  return [...unicos.values()];
}

function orientacoesOficiaisInmet(aviso) {
  return textosUnicos(aviso?.instrucoes, aviso?.instruction);
}

function fenomenoDoEvento(evento) {
  if (!evento) return "aviso";
  if (evento.tipo && FENOMENO_POR_TIPO[evento.tipo]) return FENOMENO_POR_TIPO[evento.tipo];
  if (evento.fenomeno) return fenomenoAvisoInmet(evento.fenomeno);
  if (evento.assinatura) return fenomenoAvisoInmet(evento.assinatura);
  return fenomenoAvisoInmet(evento.tipo || evento.titulo || evento.descricao);
}

function avisosExibiveis(avisos, tipoDocumento = TIPOS_DOCUMENTO.EXTRAORDINARIO) {
  return (Array.isArray(avisos) ? avisos : []).filter((aviso) =>
    aviso && deveExibirNoDocumento({
      nivel: grauAvisoInmet(aviso.severidade ?? aviso.severity),
      tipoDocumento,
    })
  );
}

function avisoCorrespondente(evento, avisos) {
  const fenomeno = fenomenoDoEvento(evento);
  return avisosExibiveis(avisos).find((aviso) =>
    fenomenoAvisoInmet(aviso.descricao || aviso.event || aviso.evento || aviso.headline) === fenomeno
  );
}

function eventoCorrespondente(aviso, eventos) {
  const fenomeno = fenomenoAvisoInmet(aviso?.descricao || aviso?.event || aviso?.evento || aviso?.headline);
  return (Array.isArray(eventos) ? eventos : []).find((evento) =>
    evento && alertaExibivel(evento.grau) && fenomenoDoEvento(evento) === fenomeno
  );
}

/**
 * Resolve as recomendações exibidas sem alterar a classificação do alerta.
 * Prioridade: cadastro local -> `instrucoes` do aviso real do INMET -> texto
 * neutro. `instruction` é mantido apenas para payloads CAP compatíveis.
 */
function resolverRecomendacoesAlerta({ evento = null, aviso = null, avisosInmet = [], eventosLocais = [] } = {}) {
  let locais = textosUnicos(evento?.recomendacoes);

  // Esta regra de chuva já existia no projeto e representa recomendações
  // locais cadastradas por nível para avisos oficiais desse fenômeno.
  if (!locais.length && aviso) {
    locais = textosUnicos(recomendacoesChuvaAvisoInmet(aviso)?.recomendacoes);
  }
  if (!locais.length && aviso) {
    locais = textosUnicos(eventoCorrespondente(aviso, eventosLocais)?.recomendacoes);
  }
  if (locais.length) return { itens: locais, origem: "local" };

  const avisoOficial = aviso || avisoCorrespondente(evento, avisosInmet);
  const oficiais = orientacoesOficiaisInmet(avisoOficial);
  if (oficiais.length) return { itens: oficiais, origem: "inmet" };

  return { itens: [RECOMENDACAO_NEUTRA], origem: "fallback" };
}

module.exports = {
  RECOMENDACAO_NEUTRA,
  TIPOS_DOCUMENTO,
  alertaExibivel,
  avisosExibiveis,
  deveExibirNoDocumento,
  fenomenoDoEvento,
  informativoProgramado,
  orientacoesOficiaisInmet,
  resolverRecomendacoesAlerta,
  tipoDocumentoDoRelatorio,
  tipoDocumentoPorHorario,
};
