// Herança de recomendações por severidade (regra única do CIM).
//
// ATENÇÃO -> [ATENÇÃO]; ALERTA -> [ATENÇÃO, ALERTA];
// EMERGÊNCIA -> [ATENÇÃO, ALERTA, EMERGÊNCIA]. Cada nível guarda apenas as
// suas próprias orientações; o resultado é a concatenação dos níveis
// aplicáveis, na ordem operacional, sem repetições. Site, PDF e e-mail
// consomem este resultado e não duplicam textos.

const NIVEIS_ACUMULAVEIS = Object.freeze(["ATENÇÃO", "ALERTA", "EMERGÊNCIA"]);

function normalizarNivel(nivel) {
  const texto = String(nivel || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
  return NIVEIS_ACUMULAVEIS.find((n) => n.normalize("NFD").replace(/[\u0300-\u036f]/g, "") === texto) || null;
}

function chaveTexto(texto) {
  return String(texto).normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ").trim().toLowerCase();
}

/** Remove duplicidades (ignorando caixa/acentos) preservando a primeira ocorrência. */
function semDuplicidade(lista) {
  const vistos = new Set();
  const resultado = [];
  for (const item of lista || []) {
    if (typeof item !== "string" || !item.trim()) continue;
    const chave = chaveTexto(item);
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    resultado.push(item);
  }
  return resultado;
}

/**
 * @param {string} fenomeno chave em `configuracao`
 * @param {string} nivel    ATENÇÃO | ALERTA | EMERGÊNCIA (NORMAL => [])
 * @param {Object<string, Object<string, string[]>>} configuracao
 * @returns {string[]} recomendações cumulativas, sem duplicidade
 */
function acumularRecomendacoes(fenomeno, nivel, configuracao) {
  const alvo = normalizarNivel(nivel);
  if (!alvo) return [];
  const porNivel = configuracao?.[fenomeno] || {};
  const aplicaveis = NIVEIS_ACUMULAVEIS.slice(0, NIVEIS_ACUMULAVEIS.indexOf(alvo) + 1);
  return semDuplicidade(aplicaveis.flatMap((n) => porNivel[n] || []));
}

/**
 * Mesma regra, agrupada por nível de origem (para cards e PDF).
 * Um texto repetido aparece apenas no primeiro nível que o contém.
 */
function acumularRecomendacoesPorNivel(fenomeno, nivel, configuracao) {
  const alvo = normalizarNivel(nivel);
  if (!alvo) return [];
  const porNivel = configuracao?.[fenomeno] || {};
  const vistos = new Set();
  const grupos = [];
  for (const n of NIVEIS_ACUMULAVEIS.slice(0, NIVEIS_ACUMULAVEIS.indexOf(alvo) + 1)) {
    const itens = semDuplicidade(porNivel[n]).filter((item) => {
      const chave = chaveTexto(item);
      if (vistos.has(chave)) return false;
      vistos.add(chave);
      return true;
    });
    if (itens.length) grupos.push({ nivel: n, itens });
  }
  return grupos;
}

module.exports = {
  NIVEIS_ACUMULAVEIS,
  normalizarNivel,
  semDuplicidade,
  acumularRecomendacoes,
  acumularRecomendacoesPorNivel,
};
