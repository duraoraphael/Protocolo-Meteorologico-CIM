/* Formato canônico dos títulos de alerta, compartilhado por painel e Node. */
(function (raiz, fabrica) {
  const modulo = fabrica();
  if (typeof module === "object" && module.exports) module.exports = modulo;
  else raiz.AlertTitle = modulo;
})(typeof self !== "undefined" ? self : this, function () {
  function semAcento(valor) {
    return String(valor || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  }

  function normalizarGrau(valor) {
    const texto = semAcento(valor).toUpperCase();
    if (/\bEMERGENCI(?:A|AL)\b/.test(texto)) return "EMERGÊNCIA";
    if (/\bALERTA\b/.test(texto)) return "ALERTA";
    if (/\bATENCAO\b/.test(texto)) return "ATENÇÃO";
    if (/\bNORMAL\b/.test(texto)) return "NORMAL";
    return null;
  }

  function removerClassificacao(valor) {
    const partes = String(valor || "").trim().split(/\s+[—–-]\s+/);
    if (partes.length > 1 && normalizarGrau(partes[0])) partes.shift();
    if (partes.length > 1 && normalizarGrau(partes.at(-1))) partes.pop();
    return partes.join(" — ").trim();
  }

  function nomeParametro(valor) {
    const original = removerClassificacao(valor) || "CONDIÇÕES METEOROLÓGICAS";
    const texto = semAcento(original).toLowerCase();
    if (/tempestade|trovoada|raio/.test(texto)) return "TEMPESTADE COM RAIOS";
    if (/calor|risco\s+a\s+saude/.test(texto)) return "CALOR / RISCO À SAÚDE";
    if (/qualidade\s+do\s+ar|poluicao|pm\s*2[,.]?5/.test(texto)) return "QUALIDADE DO AR";
    if (/vento|ventania|rajada/.test(texto)) return "VENTO";
    if (/chuva|precipitacao/.test(texto)) return "CHUVA INTENSA";
    if (/indice\s+uv|ultravioleta|\buv\b/.test(texto)) return "ÍNDICE UV";
    if (/baixa\s+umidade/.test(texto)) return "BAIXA UMIDADE";
    if (/seca|estiagem/.test(texto)) return "SECA";
    if (/mar|onda|ressaca/.test(texto)) return "AGITAÇÃO MARÍTIMA";
    return original.toUpperCase();
  }

  function formatarTitulo(parametro, grau) {
    return `${nomeParametro(parametro)} — ${normalizarGrau(grau) || String(grau || "NORMAL").toUpperCase()}`;
  }

  function tituloEvento(evento, grauPadrao = "NORMAL") {
    const parametro = evento && (evento.fenomeno || evento.rotulo || evento.titulo || evento.tipo);
    return formatarTitulo(parametro, evento?.grau || grauPadrao);
  }

  return { formatarTitulo, nomeParametro, normalizarGrau, removerClassificacao, tituloEvento };
});
