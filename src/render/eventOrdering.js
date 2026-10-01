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

/**
 * Ordenação exclusivamente visual: preserva a ordem relativa existente e
 * move apenas os eventos de índice UV para o fim.
 */
function ordenarEventosParaExibicao(eventos) {
  const lista = Array.isArray(eventos) ? eventos.filter(Boolean) : [];
  return [
    ...lista.filter((evento) => !eventoDeIndiceUv(evento)),
    ...lista.filter(eventoDeIndiceUv),
  ];
}

module.exports = { eventoDeIndiceUv, ordenarEventosParaExibicao };
