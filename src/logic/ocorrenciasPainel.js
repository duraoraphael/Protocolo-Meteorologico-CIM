// Ocorrências em destaque do painel: uma lista única e ordenada por
// gravidade, montada a partir de três origens já existentes no relatório —
//   1. eventos classificados pelo protocolo (riskEngine/inmetAlertRules);
//   2. avisos oficiais INMET aplicáveis à base (já deduplicados na coleta);
//   3. Clima e Saúde (EHF), quando o nível for ATENÇÃO ou superior.
//
// Nenhuma regra ou limite de classificação é definido aqui: o grau de cada
// origem vem do motor de risco, de grauAvisoInmet (mapeamento oficial do
// projeto) ou do nível do Clima e Saúde. Quando a mesma ocorrência aparece
// em mais de uma origem (mesmo fenômeno, mesma base, mesmo dia), as
// informações são reunidas em um card só e o destaque segue a regra já usada
// no protocolo: prevalece o maior grau. As classificações de cada fonte ficam
// preservadas em `blocos` para a tela de detalhes.

const { GRAUS, maiorGrau, LIMITES_ALERTA_INMET } = require("./inmetAlertRules");
const { grauAvisoInmet, fenomenoAvisoInmet, dataAvisoEmMs } = require("../sources/inmet");
const { eventoDeIndiceUv } = require("../render/eventOrdering");
const { alertaExibivel } = require("./alertPresentation");

// Tipo de evento do riskEngine -> fenômeno comparável ao dos avisos INMET.
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

const ROTULO_FENOMENO = Object.freeze({
  tempestade: "Tempestade com raios",
  chuva: "Chuva intensa",
  vento: "Vento",
  calor: "Calor / risco à saúde",
  "baixa-umidade": "Baixa umidade",
  ressaca: "Agitação marítima",
  uv: "Índice UV elevado",
  ar: "Qualidade do ar",
  frio: "Frio",
  nevoeiro: "Nevoeiro",
});

const ICONE_FENOMENO = Object.freeze({
  tempestade: "storm", chuva: "rain", vento: "wind", calor: "thermometer",
  "baixa-umidade": "drop", ressaca: "waves", uv: "sun", ar: "leaf", nevoeiro: "fog",
});

const FONTE_INMET = "INMET — aviso oficial";

function grauRelevante(grau) {
  return alertaExibivel(grau);
}

function formatarDataHora(valor) {
  const ms = dataAvisoEmMs(valor);
  if (ms === null) return valor || null;
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  }).format(new Date(ms)).replace(",", "");
}

function validadeAviso(aviso) {
  const inicio = formatarDataHora(aviso.inicio);
  const fim = formatarDataHora(aviso.fim);
  if (inicio && fim) return `${inicio} até ${fim}`;
  if (fim) return `Até ${fim}`;
  if (inicio) return `A partir de ${inicio}`;
  return "Validade não informada pela fonte";
}

function janelaEvento(evento) {
  const janela = String(evento.janela || "").trim();
  if (!janela) return "Hoje";
  return /^(hoje|ao longo)/i.test(janela) ? janela.charAt(0).toUpperCase() + janela.slice(1) : `Hoje · ${janela}`;
}

function valoresEvento(evento) {
  const v = evento.valores || {};
  const lista = [];
  if (Number.isFinite(v.rajadaKmh)) lista.push({ rotulo: "Rajada prevista", valor: `${v.rajadaKmh} km/h` });
  if (Number.isFinite(v.intensidadeHorariaMmH)) lista.push({ rotulo: "Intensidade máx.", valor: `${v.intensidadeHorariaMmH} mm/h` });
  if (Number.isFinite(v.acumuladoDiarioMm)) lista.push({ rotulo: "Acumulado do dia", valor: `${v.acumuladoDiarioMm} mm` });
  return lista;
}

// Resumo objetivo para os eventos numéricos do protocolo, citando o limite
// que foi atingido (os valores em si vão em `valores`, sem repetição).
function resumoEvento(evento) {
  if (evento.assinatura === "vento") {
    const l = LIMITES_ALERTA_INMET.rajadaKmh;
    const faixa = { "ATENÇÃO": `a partir de ${l.atencao} km/h`, ALERTA: `a partir de ${l.alerta} km/h`, "EMERGÊNCIA": `acima de ${l.emergenciaAcimaDe} km/h` }[evento.grau];
    return `Rajadas na faixa de ${evento.grau} do protocolo (${faixa}).`;
  }
  if (evento.assinatura === "chuva") {
    return `Chuva na faixa de ${evento.grau} do protocolo pelos critérios de intensidade horária e acumulado diário.`;
  }
  return evento.descricao || null;
}

function blocoProtocolo(evento) {
  return {
    origem: "protocolo",
    titulo: evento.titulo,
    grau: evento.grau,
    descricao: evento.detalhe || evento.descricao || null,
    janela: evento.janela || null,
    fonte: evento.fonteDados || null,
    recomendacoes: evento.recomendacoes || [],
  };
}

function blocoInmet(aviso, linkOficial) {
  return {
    origem: "inmet",
    titulo: `Aviso oficial INMET — ${aviso.descricao || "fenômeno não informado"}`,
    grau: grauAvisoInmet(aviso.severidade),
    fenomeno: aviso.descricao || null,
    classificacaoOficial: aviso.severidade || null,
    validade: validadeAviso(aviso),
    riscos: aviso.riscos || [],
    instrucoes: aviso.instrucoes || [],
    detalhesDisponiveis: Boolean(aviso.riscos?.length || aviso.instrucoes?.length),
    area: { estados: aviso.estados ? aviso.estados.split(/\s*,\s*/).join(", ") : null, totalMunicipios: aviso.totalMunicipios ?? null },
    identificador: aviso.idAviso ? `Aviso nº ${aviso.idAviso}` : aviso.id || null,
    copiasNaFonte: aviso.copiasNaFonte || 1,
    linkOficial: linkOficial || null,
    fonte: FONTE_INMET,
  };
}

function diaBrasilia(valor) {
  const ms = Date.parse(valor || "");
  return Number.isFinite(ms)
    ? new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date(ms))
    : null;
}

// O EHF é diário: a última coleta válida do próprio dia (Brasília) continua
// atual, mesmo lida do armazenamento; de outro dia, é desatualizada.
function calorDesatualizado(dados, agora = new Date()) {
  const dia = diaBrasilia(dados?.consultadoEm);
  return !dia || dia !== diaBrasilia(agora.toISOString());
}

function blocoCalor(integracao) {
  const dados = integracao.dados;
  return {
    origem: "clima-saude",
    titulo: "Clima e Saúde — calor / risco à saúde",
    grau: dados.nivel?.grau || "NORMAL",
    protocolo: dados.nivel?.protocolo || null,
    ehf: dados.ehf || null,
    tempMax: dados.temperatura?.maxima ?? null,
    riscoCombinado: dados.riscoCombinado ?? null,
    geoses: dados.geoses || null,
    recomendacoes: dados.recomendacoes || [],
    consultadoEm: dados.consultadoEm || null,
    desatualizado: calorDesatualizado(dados),
    fonte: dados.source || "Clima e Saúde — Ministério da Saúde",
  };
}

function novaOcorrencia(fenomeno, rotulo) {
  return {
    fenomeno,
    rotulo: rotulo || ROTULO_FENOMENO[fenomeno] || fenomeno,
    icone: ICONE_FENOMENO[fenomeno] || "alert",
    grau: "NORMAL",
    resumo: null,
    valores: [],
    validade: null,
    fontes: [],
    blocos: [],
  };
}

function adicionarFonte(ocorrencia, fonte) {
  for (const f of String(fonte || "").split(/\s*\/\s*/).filter(Boolean)) {
    if (!ocorrencia.fontes.includes(f)) ocorrencia.fontes.push(f);
  }
}

function aplicarBloco(ocorrencia, bloco) {
  ocorrencia.blocos.push(bloco);
  if (bloco.grau) ocorrencia.grau = maiorGrau(ocorrencia.grau, bloco.grau);
  adicionarFonte(ocorrencia, bloco.fonte);
}

// O evento só existe por causa do aviso INMET (sem dado numérico próprio)?
function eventoDerivadoDeAviso(evento) {
  return evento.fonteDados === FONTE_INMET || (evento.avisoInmet && !/código de trovoada/i.test(evento.fonteDados || ""));
}

/**
 * @param {object} report relatório do informativo (montarRelatorio)
 * @returns {Array} ocorrências com grau ATENÇÃO ou superior, ordenadas
 */
function montarOcorrencias(report) {
  const ocorrencias = [];
  const avisos = Array.isArray(report.avisosInmet) ? report.avisosInmet.filter(Boolean) : [];
  const avisosUsados = new Set();
  const linkOficial = report.linkInmet || null;

  // 1. Eventos do protocolo (os candidatos genéricos "avisoInmet" do motor
  //    de risco são substituídos pelos próprios avisos, no passo 2).
  for (const evento of report.severidade?.eventos || []) {
    if (!evento || evento.tipo === "avisoInmet" || !grauRelevante(evento.grau)) continue;
    const fenomeno = FENOMENO_POR_TIPO[evento.tipo] || evento.assinatura || String(evento.tipo);
    const ocorrencia = novaOcorrencia(fenomeno);
    ocorrencia.uv = eventoDeIndiceUv(evento);
    const derivado = eventoDerivadoDeAviso(evento);
    // Evento criado apenas pelo texto de um aviso: o aviso é a fonte real,
    // então o card usa o conteúdo oficial (passo 2), não esta cópia.
    if (!derivado) {
      aplicarBloco(ocorrencia, blocoProtocolo(evento));
      ocorrencia.resumo = resumoEvento(evento);
      ocorrencia.valores = valoresEvento(evento);
      ocorrencia.validade = janelaEvento(evento);
    } else {
      ocorrencia.grauDerivado = evento.grau;
      ocorrencia.blocoDerivado = blocoProtocolo(evento);
    }
    ocorrencias.push(ocorrencia);
  }

  // 2. Avisos INMET: reunidos ao card do mesmo fenômeno (mesma base e mesmo
  //    dia — os avisos já chegam filtrados por área e validade); avisos
  //    distintos do mesmo fenômeno geram cards próprios.
  for (const aviso of avisos) {
    if (!grauRelevante(grauAvisoInmet(aviso.severidade ?? aviso.severity))) continue;
    const fenomeno = fenomenoAvisoInmet(aviso.descricao);
    const bloco = blocoInmet(aviso, linkOficial);
    let alvo = ocorrencias.find((o) => o.fenomeno === fenomeno && !o.blocos.some((b) => b.origem === "inmet"));
    if (!alvo) {
      alvo = novaOcorrencia(fenomeno, aviso.descricao);
      ocorrencias.push(alvo);
    }
    if (alvo.blocoDerivado) {
      // O evento derivado só reforça o próprio aviso: guarda a classificação
      // do protocolo para os detalhes, sem repetir o texto.
      alvo.blocos.push({ ...alvo.blocoDerivado, derivadoDoAviso: true });
      alvo.grau = maiorGrau(alvo.grau, alvo.grauDerivado);
      delete alvo.blocoDerivado;
      delete alvo.grauDerivado;
    }
    aplicarBloco(alvo, bloco);
    if (!bloco.grau) alvo.semMapeamento = true;
    alvo.rotulo = alvo.blocos.some((b) => b.origem === "protocolo" && !b.derivadoDoAviso) ? alvo.rotulo : (aviso.descricao || alvo.rotulo);
    alvo.classificacaoOficial = aviso.severidade || null;
    // Com aviso oficial, o resumo do card é o texto de riscos do próprio
    // aviso (fiel à fonte); os valores numéricos do protocolo continuam em
    // `valores` e a descrição do protocolo nos detalhes.
    if (bloco.riscos.length) alvo.resumo = bloco.riscos.join(" ");
    alvo.validade = validadeAviso(aviso);
    alvo.detalhesIndisponiveis = !bloco.detalhesDisponiveis;
    avisosUsados.add(aviso);
  }

  // Eventos derivados de aviso cujo aviso não está na lista (não deveria
  // ocorrer): mantém o evento do protocolo como está.
  for (const o of ocorrencias) {
    if (!o.blocoDerivado) continue;
    aplicarBloco(o, o.blocoDerivado);
    o.grau = maiorGrau(o.grau, o.grauDerivado);
    delete o.blocoDerivado;
    delete o.grauDerivado;
  }

  // 3. Clima e Saúde: entra no destaque só com nível ATENÇÃO ou superior e
  //    com dado disponível. Desatualizado continua sinalizado no bloco.
  const integracao = report.climaSaude;
  if (integracao?.dados && grauRelevante(integracao.dados.nivel?.grau)) {
    const bloco = blocoCalor(integracao);
    let alvo = ocorrencias.find((o) => o.fenomeno === "calor");
    if (!alvo) {
      alvo = novaOcorrencia("calor", "Calor e saúde");
      ocorrencias.push(alvo);
    }
    aplicarBloco(alvo, bloco);
    const ehf = bloco.ehf?.classificacao ? `EHF ${bloco.ehf.classificacao}` : "EHF";
    alvo.resumo = alvo.resumo || `${ehf}${bloco.protocolo ? ` — protocolo ${bloco.protocolo}` : ""}. Risco combinado à saúde: ${bloco.riscoCombinado ?? "indisponível"}.`;
    if (Number.isFinite(bloco.tempMax)) alvo.valores.push({ rotulo: "Máxima prevista", valor: `${bloco.tempMax} °C` });
    alvo.validade = alvo.validade || "Hoje";
    alvo.desatualizado = bloco.desatualizado;
  }

  for (const o of ocorrencias) {
    const graus = new Set(o.blocos.map((b) => b.grau).filter(Boolean));
    o.classificacoesDivergentes = graus.size > 1;
    o.resumo = o.resumo || "Resumo indisponível na fonte.";
    o.validade = o.validade || "Hoje";
  }

  return ocorrencias
    .filter((o) => grauRelevante(o.grau))
    .map((o, indice) => ({ ...o, ordemOriginal: indice }))
    .sort((a, b) => (GRAUS[b.grau] || 0) - (GRAUS[a.grau] || 0)
      || Number(Boolean(a.uv)) - Number(Boolean(b.uv))
      || a.ordemOriginal - b.ordemOriginal)
    .map(({ ordemOriginal, uv, ...o }, indice) => ({ id: `oc-${indice + 1}`, ...o }));
}

module.exports = { montarOcorrencias, FENOMENO_POR_TIPO };
