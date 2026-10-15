function chave(valor) {
  return String(valor || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

const ORIENTACAO_AR = Object.freeze({
  boa: "Qualidade do ar boa.",
  razoavel: "Qualidade do ar aceitável.",
  moderada: "Qualidade do ar moderada; atenção para pessoas mais sensíveis.",
  ruim: "Qualidade do ar ruim.",
  "muito ruim": "Qualidade do ar muito ruim.",
  "extremamente ruim": "Qualidade do ar extremamente ruim.",
});

const ORIENTACAO_UV = Object.freeze({
  baixo: "Risco baixo de exposição solar.",
  moderado: "Use proteção solar.",
  alto: "Reduza a exposição ao sol e use proteção solar.",
  "muito alto": "Evite exposição prolongada ao sol e use proteção solar.",
  extremo: "Evite exposição ao sol nos horários de maior intensidade.",
});

function apresentarQualidadeAr(qualidadeAr) {
  const classificacao = qualidadeAr?.pm25Classificacao?.nivel;
  if (!Number.isFinite(qualidadeAr?.aqiPm25) || !classificacao || chave(classificacao) === "sem dado") {
    return {
      resultado: "Classificação indisponível",
      orientacao: "A fonte não publicou um índice classificável nesta emissão.",
      disponivel: false,
    };
  }
  return {
    resultado: classificacao,
    orientacao: ORIENTACAO_AR[chave(classificacao)] || `Qualidade do ar: ${String(classificacao).toLowerCase()}.`,
    disponivel: true,
  };
}

function apresentarIndiceUv(indiceUv) {
  const classificacao = indiceUv?.classificacao;
  if (!Number.isFinite(indiceUv?.valorAtual) || !classificacao) {
    return {
      resultado: "Índice UV indisponível",
      orientacao: "Não publicado pelo Clima e Saúde nesta emissão.",
      disponivel: false,
    };
  }
  const valor = String(indiceUv.valorAtual).replace(".", ",");
  return {
    resultado: `${valor} — ${classificacao}`,
    orientacao: ORIENTACAO_UV[chave(classificacao)] || "Consulte as orientações oficiais de proteção solar.",
    disponivel: true,
  };
}

module.exports = { apresentarQualidadeAr, apresentarIndiceUv };
