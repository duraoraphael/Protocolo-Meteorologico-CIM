const FONTE_CONDICAO = "INMET — previsão oficial municipal";
const CONDICAO_INDISPONIVEL = "Condição indisponível";

function textoValido(valor) {
  if (typeof valor !== "string") return null;
  const texto = valor.trim();
  return texto && texto !== "—" ? texto : null;
}

function resumoDiario(previsao) {
  const periodos = ["manha", "tarde", "noite"]
    .map((chave) => textoValido(previsao?.periodos?.[chave]?.resumo))
    .filter(Boolean);
  if (periodos.length) {
    const frequencias = new Map();
    periodos.forEach((resumo, ordem) => {
      const registro = frequencias.get(resumo) || { resumo, quantidade: 0, ordem };
      registro.quantidade += 1;
      frequencias.set(resumo, registro);
    });
    return [...frequencias.values()]
      .sort((a, b) =>
        b.quantidade - a.quantidade
        || b.resumo.length - a.resumo.length
        || a.ordem - b.ordem
      )[0].resumo;
  }

  const dia = (previsao?.dias || []).find((item) => item?.dataBr === previsao?.data);
  return textoValido(dia?.resumo);
}

/**
 * Vincula a condição oficial ao identificador estável da base. O cálculo é
 * puro e não mantém estado entre chamadas, impedindo que a condição de uma
 * base seja reutilizada em outra quando a previsão estiver ausente.
 */
function montarContextoMeteorologicoSetor(cidade, inmetPrevisao) {
  if (!cidade?.chave) throw new TypeError("Base meteorológica sem identificador estável.");
  const condicao = resumoDiario(inmetPrevisao);
  return {
    setorId: cidade.chave,
    localizacao: {
      nome: cidade.nome || null,
      uf: cidade.uf || null,
      latitude: Number.isFinite(cidade.latitude) ? cidade.latitude : null,
      longitude: Number.isFinite(cidade.longitude) ? cidade.longitude : null,
      codigoIbge: cidade.codigoIbge ? String(cidade.codigoIbge) : null,
    },
    condicaoGeral: condicao || CONDICAO_INDISPONIVEL,
    fonteCondicao: condicao ? FONTE_CONDICAO : "Indisponível",
    dataReferencia: inmetPrevisao?.data || null,
    natureza: condicao ? "previsto" : "indisponivel",
  };
}

module.exports = {
  montarContextoMeteorologicoSetor,
  resumoDiario,
  FONTE_CONDICAO,
  CONDICAO_INDISPONIVEL,
};
