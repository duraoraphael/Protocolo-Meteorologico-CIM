// Critérios operacionais de chuva intensa e vento solicitados com referência
// INMET. A fonte do dado numérico continua registrada separadamente, pois o
// endpoint municipal de previsão do INMET não fornece chuva horária nem
// rajada numérica; esses gatilhos recebem apenas observações de estação INMET.
const { formatarTitulo } = require("../../public/alert-title");
const { fenomenoAvisoInmet, grauAvisoInmet, normalizarComparacao } = require("../sources/inmet");
const { acumularRecomendacoes, acumularRecomendacoesPorNivel } = require("./recomendacoesCumulativas");
const { formatarRajadaPrevista } = require("../../public/weather-format");

const GRAUS = Object.freeze({
  NORMAL: 0,
  "ATENÇÃO": 1,
  ALERTA: 2,
  "EMERGÊNCIA": 3,
});

const LIMITES_ALERTA_INMET = Object.freeze({
  chuvaHorariaMmH: Object.freeze({ atencao: 20, alerta: 30, emergenciaAcimaDe: 60 }),
  // PENDÊNCIA DE CONFIGURAÇÃO: a tabela operacional não define mínimo diário
  // para ATENÇÃO. O limiar de 20 mm/dia é anterior a este motor e foi
  // preservado; precisa de aprovação formal do CIM (ver README, gatilhos).
  chuvaDiariaMm: Object.freeze({ atencao: 20, alerta: 50, emergenciaAcimaDe: 100 }),
  rajadaKmh: Object.freeze({ atencao: 30, alerta: 40, emergenciaAcimaDe: 60 }),
});

const RECOMENDACOES = Object.freeze({
  chuva: Object.freeze({
    "ATENÇÃO": Object.freeze([
      "Reforçar comunicação preventiva.",
      "Checar drenagem.",
      "Suspender preventivamente serviços em telhados, atividades em altura e serviços a céu aberto.",
      "Preparar abrigo interno.",
    ]),
    ALERTA: Object.freeze([
      "Suspender trabalho em altura e em telhados.",
      "Suspender atividades externas não essenciais.",
      "Controlar acesso a áreas alagáveis.",
      "Manter prontidão de saúde e equipes de contingência.",
    ]),
    "EMERGÊNCIA": Object.freeze([
      "Evacuar áreas vulneráveis conforme o plano de resposta local.",
      "Isolar áreas com risco elétrico conforme procedimento operacional local.",
    ]),
  }),
  vento: Object.freeze({
    "ATENÇÃO": Object.freeze([
      "Manter o monitoramento durante o dia.",
    ]),
    ALERTA: Object.freeze([
      "Paralisar atividades externas gerais, incluindo roçagem, capina, jardinagem, manutenção civil externa e obras civis.",
      "Suspender trabalho em altura, serviços em telhados, içamentos e serviços a céu aberto.",
      "Interditar áreas sob risco de queda de objetos e árvores.",
      "Intensificar o controle de queda de objetos.",
      "Direcionar pessoas para áreas internas seguras.",
    ]),
    "EMERGÊNCIA": Object.freeze([
      "Evacuar áreas externas conforme os procedimentos locais.",
      "Operar em modo de abrigo interno.",
      "Controlar acessos e coordenar a resposta a feridos, quando houver.",
      "Incorporar as recomendações aplicáveis de avisos oficiais INMET, conforme a severidade do fenômeno.",
    ]),
  }),
});

function classificar(valor, limites) {
  if (!Number.isFinite(valor)) return "NORMAL";
  if (valor > limites.emergenciaAcimaDe) return "EMERGÊNCIA";
  if (valor >= limites.alerta) return "ALERTA";
  if (valor >= limites.atencao) return "ATENÇÃO";
  return "NORMAL";
}

function classificarChuvaHoraria(valorMmH) {
  return classificar(valorMmH, LIMITES_ALERTA_INMET.chuvaHorariaMmH);
}

function classificarChuvaDiaria(valorMm) {
  return classificar(valorMm, LIMITES_ALERTA_INMET.chuvaDiariaMm);
}

function classificarRajada(valorKmh) {
  return classificar(valorKmh, LIMITES_ALERTA_INMET.rajadaKmh);
}

function maiorGrau(...graus) {
  return graus.reduce(
    (maior, grau) => (GRAUS[grau] > GRAUS[maior] ? grau : maior),
    "NORMAL"
  );
}

function classificarChuva(intensidadeHorariaMmH, acumuladoDiarioMm) {
  const grauHorario = classificarChuvaHoraria(intensidadeHorariaMmH);
  const grauDiario = classificarChuvaDiaria(acumuladoDiarioMm);
  return {
    grau: maiorGrau(grauHorario, grauDiario),
    grauHorario,
    grauDiario,
  };
}

function recomendacoes(fenomeno, grau) {
  return acumularRecomendacoes(fenomeno, grau, RECOMENDACOES);
}

/** Mesma regra cumulativa, agrupada por nível de origem (cards, PDF e e-mail). */
function recomendacoesPorNivel(fenomeno, grau) {
  return acumularRecomendacoesPorNivel(fenomeno, grau, RECOMENDACOES);
}

/**
 * Recomendações de chuva para um aviso oficial do INMET aplicável à base.
 * Vale para avisos de chuva e para os de tempestade cujo texto oficial cita
 * chuva ou alagamento. O nível vem só da severidade oficial, pelo mesmo
 * mapeamento do restante do projeto (Perigo Potencial → ATENÇÃO, Perigo →
 * ALERTA, Grande Perigo → EMERGÊNCIA); severidade não reconhecida não gera
 * recomendação. Retorna null quando o aviso não é de chuva.
 */
function recomendacoesChuvaAvisoInmet(aviso) {
  if (!aviso) return null;
  const evento = aviso.descricao || aviso.event || aviso.evento || aviso.headline;
  const fenomeno = fenomenoAvisoInmet(evento);
  const textoOficial = normalizarComparacao([evento, aviso.riscos, aviso.description].flat().filter(Boolean).join(" "));
  const deChuva = fenomeno === "chuva" || (fenomeno === "tempestade" && /chuva|alagamento/.test(textoOficial));
  if (!deChuva) return null;
  const grau = grauAvisoInmet(aviso.severidade ?? aviso.severity);
  if (!grau) return null;
  return { fenomeno: "chuva", grau, recomendacoes: recomendacoes("chuva", grau) };
}

/**
 * Classifica, em uma única passagem, os gatilhos numéricos usados pelo
 * informativo e pelo monitor de alertas. Os limites continuam definidos
 * somente em LIMITES_ALERTA_INMET.
 */
function classificarCondicoesMeteorologicas({
  rajadaKmh = null,
  rajadaObservadaKmh = null,
  chuvaHorariaMmH = null,
  chuvaDiariaMm = null,
} = {}) {
  // `rajadaKmh` é a rajada de referência do relatório (previsão ou legado);
  // `rajadaObservadaKmh` é a medição local. Os dois são classificados
  // separadamente: a medição manda quando atinge o maior grau, e a previsão
  // gera alerta preventivo, sem nunca ser apresentada como medição.
  const grauPrevisto = classificarRajada(rajadaKmh);
  const grauObservado = classificarRajada(rajadaObservadaKmh);
  const grauVento = maiorGrau(grauPrevisto, grauObservado);
  const classificacaoChuva = classificarChuva(chuvaHorariaMmH, chuvaDiariaMm);
  const eventos = [];

  if (grauVento !== "NORMAL") {
    const observado = grauObservado === grauVento;
    const valorGatilho = observado ? rajadaObservadaKmh : rajadaKmh;
    const outro = observado ? rajadaKmh : rajadaObservadaKmh;
    const rotuloOutro = observado ? "Rajada de referência da previsão" : "Rajada observada na estação INMET";
    const principal = `Rajada medida pela estação INMET: ${formatarRajadaPrevista(valorGatilho)}`;
    const detalhe = [
      principal,
      Number.isFinite(outro) ? `${rotuloOutro}: ${formatarRajadaPrevista(outro)}` : null,
    ].filter(Boolean).join(" · ");
    eventos.push({
      assinatura: "vento",
      fenomeno: "vento",
      tipo: "Vento",
      titulo: formatarTitulo("VENTO", grauVento),
      grau: grauVento,
      detalhe,
      descricao: detalhe,
      valores: { rajadaKmh: valorGatilho, rajadaObservadaKmh, rajadaPrevistaKmh: rajadaKmh },
      baseDado: observado ? "observada" : "referencia",
      unidade: "km/h",
      recomendacoes: recomendacoes("vento", grauVento),
      recomendacoesPorNivel: recomendacoesPorNivel("vento", grauVento),
    });
  }

  if (classificacaoChuva.grau !== "NORMAL") {
    const detalhes = [];
    if (Number.isFinite(chuvaHorariaMmH)) {
      detalhes.push(`Intensidade horária máxima observada: ${chuvaHorariaMmH} mm/h`);
    }
    if (Number.isFinite(chuvaDiariaMm)) {
      detalhes.push(`Acumulado observado no histórico disponível do dia: ${chuvaDiariaMm} mm`);
    }
    const detalhe = detalhes.join(" · ");
    eventos.push({
      assinatura: "chuva",
      fenomeno: "chuva",
      tipo: "Chuva intensa",
      titulo: formatarTitulo("CHUVA INTENSA", classificacaoChuva.grau),
      grau: classificacaoChuva.grau,
      detalhe,
      descricao: detalhe,
      valores: {
        intensidadeHorariaMmH: chuvaHorariaMmH,
        acumuladoDiarioMm: chuvaDiariaMm,
      },
      unidade: "mm/h e mm/dia",
      recomendacoes: recomendacoes("chuva", classificacaoChuva.grau),
      recomendacoesPorNivel: recomendacoesPorNivel("chuva", classificacaoChuva.grau),
    });
  }

  eventos.sort((a, b) => GRAUS[b.grau] - GRAUS[a.grau]);
  return {
    grau: maiorGrau(grauVento, classificacaoChuva.grau),
    vento: { grau: grauVento, rajadaKmh, rajadaObservadaKmh, grauObservado, grauPrevisto },
    chuva: {
      ...classificacaoChuva,
      intensidadeHorariaMmH: chuvaHorariaMmH,
      acumuladoDiarioMm: chuvaDiariaMm,
    },
    eventos,
  };
}

module.exports = {
  RECOMENDACOES,
  GRAUS,
  LIMITES_ALERTA_INMET,
  classificarChuvaHoraria,
  classificarChuvaDiaria,
  classificarChuva,
  classificarRajada,
  maiorGrau,
  recomendacoes,
  recomendacoesPorNivel,
  recomendacoesChuvaAvisoInmet,
  classificarCondicoesMeteorologicas,
};
