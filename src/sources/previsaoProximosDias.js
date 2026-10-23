const DIAS_PREVISAO = 3;
const FUSO_PADRAO = "America/Sao_Paulo";
const DIAS_SEMANA = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];
const INDISPONIVEL = "Informação indisponível";

const fusoDaCidade = (cidade) => cidade?.fusoHorario || FUSO_PADRAO;
function dataLocalIso(instante, fuso) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: fuso, year: "numeric", month: "2-digit", day: "2-digit" }).format(instante);
}
function somarDias(dataIso, dias) {
  const [ano, mes, dia] = dataIso.split("-").map(Number);
  return new Date(Date.UTC(ano, mes - 1, dia + dias)).toISOString().slice(0, 10);
}
function proximasDatas(instante, fuso, quantidade = DIAS_PREVISAO) {
  const hoje = dataLocalIso(instante, fuso);
  return Array.from({ length: quantidade }, (_, i) => somarDias(hoje, i + 1));
}
function formatarDataBr(dataIso) {
  const [ano, mes, dia] = dataIso.split("-");
  return `${dia}/${mes}/${ano}`;
}
function diaDaSemana(dataIso) {
  return DIAS_SEMANA[new Date(`${dataIso}T12:00:00Z`).getUTCDay()];
}
function diaSemDados(data) {
  return {
    data, dataFormatada: formatarDataBr(data), diaSemana: diaDaSemana(data),
    tempMaxC: null, tempMinC: null, umidadeMaxPct: null, umidadeMinPct: null,
    rajadaMaxKmh: null, chuvaMm: null, probabilidadeChuvaPct: null,
    uvMax: null, codigoTempo: null, condicao: null,
  };
}

function montarPrevisaoProximosDiasInmet(cidade, previsaoInmet, { agora = new Date() } = {}) {
  const fuso = fusoDaCidade(cidade);
  const datas = proximasDatas(agora, fuso);
  const porData = new Map((previsaoInmet?.dias || []).map((dia) => [dia.data, dia]));
  const dias = datas.map((data) => {
    const oficial = porData.get(data);
    return {
      ...diaSemDados(data),
      tempMaxC: Number.isFinite(oficial?.tempMax) ? oficial.tempMax : null,
      tempMinC: Number.isFinite(oficial?.tempMin) ? oficial.tempMin : null,
      umidadeMaxPct: Number.isFinite(oficial?.umidadeMax) ? oficial.umidadeMax : null,
      umidadeMinPct: Number.isFinite(oficial?.umidadeMin) ? oficial.umidadeMin : null,
      condicao: oficial?.resumo || null,
      direcaoVento: oficial?.direcaoVento || null,
      intensidadeVento: oficial?.intensidadeVento || null,
      rajadaMaxKmh: Number.isFinite(oficial?.rajadaMaxKmh) ? oficial.rajadaMaxKmh : null,
      chuvaMm: Number.isFinite(oficial?.precipitacaoMm) ? oficial.precipitacaoMm : null,
      probabilidadeChuvaPct: Number.isFinite(oficial?.probabilidadeChuva) ? oficial.probabilidadeChuva : null,
    };
  });
  const temDados = dias.some((dia) => Number.isFinite(dia.tempMaxC) || Number.isFinite(dia.tempMinC) || dia.condicao);
  const fonteCampo = (campo, mensagem) => dias.some((dia) => Number.isFinite(dia[campo])) ? "INMET — previsão oficial" : `${INDISPONIVEL} — ${mensagem}`;
  return {
    fonte: "INMET — previsão oficial",
    status: temDados ? "parcial" : "indisponivel",
    fuso,
    localidade: { nome: cidade.nome, uf: cidade.uf, latitude: cidade.latitude, longitude: cidade.longitude },
    datasSolicitadas: datas,
    consultadoEm: new Date().toISOString(),
    mensagem: temDados ? null : "O INMET não retornou previsão para as datas solicitadas.",
    dias,
    fontesCampo: {
      temperatura: fonteCampo("tempMaxC", "temperatura numérica não publicada"),
      umidade: fonteCampo("umidadeMaxPct", "umidade numérica não publicada"),
      rajada: fonteCampo("rajadaMaxKmh", "rajada máxima numérica não publicada"),
      chuva: fonteCampo("chuvaMm", "volume previsto numérico não publicado"),
      probabilidadeChuva: fonteCampo("probabilidadeChuvaPct", "probabilidade diária não publicada"),
      uv: INDISPONIVEL,
      condicao: dias.some((dia) => dia.condicao) ? "INMET — previsão oficial" : INDISPONIVEL,
    },
  };
}

function montarPrevisaoProximosDiasOpenMeteo(cidade, previsaoDias, { agora = new Date() } = {}) {
  const fuso = fusoDaCidade(cidade);
  const datas = proximasDatas(agora, fuso);
  const porData = new Map((previsaoDias || []).map((dia) => [dia.data, dia]));
  const dias = datas.map((data) => {
    const previsto = porData.get(data);
    return {
      ...diaSemDados(data),
      tempMaxC: Number.isFinite(previsto?.tempMax) ? previsto.tempMax : null,
      tempMinC: Number.isFinite(previsto?.tempMin) ? previsto.tempMin : null,
      umidadeMaxPct: Number.isFinite(previsto?.umidadeMax) ? previsto.umidadeMax : null,
      umidadeMinPct: Number.isFinite(previsto?.umidadeMin) ? previsto.umidadeMin : null,
      condicao: previsto?.condicao || null,
      rajadaMaxKmh: null,
      chuvaMm: Number.isFinite(previsto?.chuvaMm) ? previsto.chuvaMm : null,
      probabilidadeChuvaPct: Number.isFinite(previsto?.probabilidadeChuvaPct) ? previsto.probabilidadeChuvaPct : null,
      uvMax: Number.isFinite(previsto?.uvMax) ? previsto.uvMax : null,
    };
  });
  const temDados = dias.some((dia) => Number.isFinite(dia.tempMaxC) || dia.condicao);
  const fonteCampo = (campo) => dias.some((dia) => Number.isFinite(dia[campo])) ? "Open-Meteo — previsão meteorológica" : INDISPONIVEL;
  return {
    fonte: "Open-Meteo — previsão meteorológica",
    status: temDados ? "operacional" : "indisponivel",
    fuso,
    localidade: { nome: cidade.nome, uf: cidade.uf, latitude: cidade.latitude, longitude: cidade.longitude },
    datasSolicitadas: datas,
    consultadoEm: new Date().toISOString(),
    mensagem: temDados ? null : "A Open-Meteo não retornou previsão para as datas solicitadas.",
    dias,
    fontesCampo: {
      temperatura: fonteCampo("tempMaxC"), umidade: fonteCampo("umidadeMaxPct"),
      rajada: INDISPONIVEL, chuva: fonteCampo("chuvaMm"),
      probabilidadeChuva: fonteCampo("probabilidadeChuvaPct"), uv: fonteCampo("uvMax"),
      condicao: dias.some((dia) => dia.condicao) ? "Open-Meteo — previsão meteorológica" : INDISPONIVEL,
    },
  };
}

function aplicarRajadasOceanop(previsao, diasOceanop = [], fontePadrao = "Petrobras — OCEANOP") {
  if (!previsao || !Array.isArray(previsao.dias) || !Array.isArray(diasOceanop) || !diasOceanop.length) return previsao;
  const porData = new Map(diasOceanop.filter((dia) => Number.isFinite(dia?.rajadaMaxKmh)).map((dia) => [dia.data, dia]));
  if (!porData.size) return previsao;
  let utilizou = false;
  const dias = previsao.dias.map((dia) => {
    const fonte = porData.get(dia.data);
    if (!fonte) return dia;
    utilizou = true;
    return { ...dia, rajadaMaxKmh: fonte.rajadaMaxKmh, fonteRajada: fonte.fonte || fontePadrao, rajadaPrevistaEm: fonte.rajadaPrevistaEm || null, rajadaLocal: fonte.local || null };
  });
  const fontes = [...new Set(diasOceanop.map((dia) => dia?.fonte || fontePadrao).filter(Boolean))];
  return utilizou ? { ...previsao, dias, fontesCampo: { ...previsao.fontesCampo, rajada: fontes.join(" / ") } } : previsao;
}

module.exports = {
  montarPrevisaoProximosDiasInmet,
  montarPrevisaoProximosDiasOpenMeteo,
  aplicarRajadasOceanop,
  proximasDatas,
  dataLocalIso,
  formatarDataBr,
  fusoDaCidade,
  DIAS_PREVISAO,
  FUSO_PADRAO,
};
