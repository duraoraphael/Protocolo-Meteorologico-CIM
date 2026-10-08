// Peso de severidade único para toda saída visual (maior = mais grave). NORMAL
// só chega à renderização nos informativos programados; quando chega, fica
// depois de todos os alertas ativos.
const PRIORIDADE_NIVEL = Object.freeze({
  NORMAL: 0,
  "ATENÇÃO": 1,
  ALERTA: 2,
  "EMERGÊNCIA": 3,
});

// O painel usa esta identificação para seu agrupamento visual próprio. Ela
// não interfere na ordenação por severidade aplicada ao PDF e aos e-mails.
function eventoDeIndiceUv(evento) {
  if (!evento || typeof evento !== "object") return false;
  if (evento.tipo === "uvAlto" || evento.assinatura === "uv") return true;
  const texto = [evento.titulo, evento.tipo, evento.descricao]
    .filter(Boolean)
    .join(" ")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  return /indice\s+uv|uv\s+(?:alto|elevado|extremo)/.test(texto);
}

function normalizarNivel(valor) {
  const texto = String(valor || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
  if (/\bEMERGENCI(?:A|AL)\b/.test(texto)) return "EMERGÊNCIA";
  if (/\bALERTA\b/.test(texto)) return "ALERTA";
  if (/\bATENCAO\b/.test(texto)) return "ATENÇÃO";
  if (/\bNORMAL\b/.test(texto)) return "NORMAL";
  return null;
}

function nivelDoEvento(evento) {
  if (!evento || typeof evento !== "object") return null;
  return normalizarNivel(evento.grau || evento.nivel || evento.titulo || evento.severidade);
}

function prioridadeNivel(valor) {
  const nivel = normalizarNivel(valor);
  return nivel === null ? Number.POSITIVE_INFINITY : PRIORIDADE_NIVEL[nivel];
}

// Posição na exibição: 0 = EMERGÊNCIA … 3 = NORMAL; sem nível reconhecido, ao final.
function posicaoExibicao(evento) {
  const nivel = nivelDoEvento(evento);
  return nivel === null ? PRIORIDADE_NIVEL["EMERGÊNCIA"] + 1 : PRIORIDADE_NIVEL["EMERGÊNCIA"] - PRIORIDADE_NIVEL[nivel];
}

/**
 * Ordenação visual estável por severidade decrescente: EMERGÊNCIA, ALERTA,
 * ATENÇÃO, NORMAL. O índice original desempata fenômenos do mesmo nível.
 */
function ordenarEventosParaExibicao(eventos) {
  return (Array.isArray(eventos) ? eventos : [])
    .filter(Boolean)
    .map((evento, indiceOriginal) => ({ evento, indiceOriginal }))
    .sort((a, b) => {
      const diferenca = posicaoExibicao(a.evento) - posicaoExibicao(b.evento);
      return diferenca || a.indiceOriginal - b.indiceOriginal;
    })
    .map(({ evento }) => evento);
}

module.exports = {
  PRIORIDADE_NIVEL,
  eventoDeIndiceUv,
  nivelDoEvento,
  normalizarNivel,
  ordenarEventosParaExibicao,
  prioridadeNivel,
};
