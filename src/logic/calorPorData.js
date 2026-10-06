// Classificação de calor por data para o informativo (card do e-mail e
// colunas "Calor" do PDF). Fonte única: Clima e Saúde — Ministério da Saúde
// (EHF, Excess Heat Factor), convertida nos níveis do protocolo pelo mesmo
// mapeamento já usado no projeto (nivelEhf): Sem excesso → Normal, Baixo →
// Atenção, Severo → Alerta, Extremo → Emergência.
//
// Não usa índice UV nem temperatura máxima, e não tem relação com o estágio
// de calor do COR-Rio. Data sem classificação na fonte → indisponível; nunca
// se presume Normal nem se repete a classificação de outro dia.
const { nivelEhf } = require("../sources/climaSaudeService");

const ROTULOS = Object.freeze({ NORMAL: "Normal", "ATENÇÃO": "Atenção", ALERTA: "Alerta", "EMERGÊNCIA": "Emergência" });

/** "AAAA-MM-DD" do instante no fuso informado. */
function dataLocal(instante, fuso = "America/Sao_Paulo") {
  const data = new Date(instante);
  if (Number.isNaN(data.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", { timeZone: fuso, year: "numeric", month: "2-digit", day: "2-digit" }).format(data);
}

/**
 * @param {object} climaSaude integração do relatório (r.climaSaude)
 * @param {string} dataIso "AAAA-MM-DD"
 * @returns {{grau: string, rotulo: string, classificacaoEhf: string} | null}
 */
function calorPorData(climaSaude, dataIso) {
  const dados = climaSaude?.dados;
  if (!dados || !dataIso) return null;
  const previsto = (dados.previsaoDias || []).find((dia) => dia.data === dataIso);
  // A classificação "atual" da página vale só para o dia da própria coleta.
  const classificacao = previsto?.classificacao
    || (dados.dataConsulta === dataIso ? dados.ehf?.classificacao : null);
  const nivel = nivelEhf(classificacao);
  if (!nivel) return null;
  return { grau: nivel.grau, rotulo: ROTULOS[nivel.grau], classificacaoEhf: classificacao };
}

/** Texto curto da fonte de calor, com o horário da coleta quando não é atual. */
function fonteCalor(climaSaude, formatarData) {
  const dados = climaSaude?.dados;
  if (!dados) return "Clima e Saúde — Ministério da Saúde: indisponível nesta emissão";
  const coleta = climaSaude.status === "operacional"
    ? ""
    : ` (última coleta válida: ${formatarData?.(dados.consultadoEm) || "horário indisponível"})`;
  return `${dados.source || "Clima e Saúde — Ministério da Saúde"}${coleta}`;
}

const DESCRICAO_CALOR = "classificação EHF (Excess Heat Factor) por data, convertida nos níveis do protocolo (Sem excesso = Normal; Baixo = Atenção; Severo = Alerta; Extremo = Emergência); não é o estágio de calor do COR-Rio";

module.exports = { calorPorData, dataLocal, fonteCalor, DESCRICAO_CALOR, ROTULOS_CALOR: ROTULOS };
