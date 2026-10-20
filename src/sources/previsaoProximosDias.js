// Seção "Previsão para os próximos 3 dias" do informativo diário.
//
// Fontes: INMET é prioritário para chuva, vento e rajada; Open-Meteo fornece
// complemento identificado quando o produto municipal não publica valores
// numéricos, além do índice UV, da probabilidade diária de chuva e de
// temperatura/condição quando necessário.
//
// A Open-Meteo calcula os agregados diários no dia civil (00h–24h) do fuso
// pedido em `timezone`, então pedimos no fuso da própria localidade e não é
// preciso agregar séries horárias aqui. As três datas são calculadas antes da
// consulta e pedidas explicitamente (start_date/end_date); cada linha da
// tabela só recebe o valor cuja data a fonte devolveu — nunca o de outro dia.

const { WMO } = require("./wmoCodes");
const { buscarJsonComRetentativa } = require("./httpJsonClient");
const { aplicarConfiguracaoOpenMeteo } = require("./openMeteoConfig");

const DIAS_PREVISAO = 3;
const FUSO_PADRAO = "America/Sao_Paulo";
const FONTE = "Open-Meteo";

// Unidade que a fonte deve declarar em `daily_units` para cada campo. Se a
// unidade vier diferente, o campo é tratado como indisponível em vez de
// exibido com rótulo errado. O índice UV é adimensional ("").
const CAMPOS = Object.freeze({
  temperature_2m_max: "°C",
  temperature_2m_min: "°C",
  wind_gusts_10m_max: "km/h",
  precipitation_sum: "mm",
  precipitation_probability_max: "%",
  uv_index_max: "",
  weather_code: "wmo code",
});

// Descrições curtas para a condição do DIA (o código diário da Open-Meteo é o
// mais significativo do dia). Códigos fora desta lista usam a grafia completa
// já adotada no restante do informativo.
const CONDICAO_DIARIA = Object.freeze({
  0: "Ensolarado",
  1: "Predomínio de sol",
  2: "Parcialmente nublado",
  3: "Nublado",
  80: "Pancadas de chuva isoladas",
  81: "Pancadas de chuva",
  82: "Pancadas de chuva fortes",
  95: "Chuva com trovoadas",
  96: "Trovoadas com granizo",
  99: "Trovoadas com granizo",
});

const DIAS_SEMANA = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];

function fusoDaCidade(cidade) {
  return cidade?.fusoHorario || FUSO_PADRAO;
}

/** "AAAA-MM-DD" do instante no fuso informado. */
function dataLocalIso(instante, fuso) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: fuso, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(instante);
}

function somarDias(dataIso, dias) {
  const [ano, mes, dia] = dataIso.split("-").map(Number);
  return new Date(Date.UTC(ano, mes - 1, dia + dias)).toISOString().slice(0, 10);
}

/** Os N dias civis seguintes ao dia local de `instante` (sem incluir hoje). */
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

function descreverCondicaoDiaria(codigo) {
  if (!Number.isInteger(codigo)) return null;
  return CONDICAO_DIARIA[codigo] || WMO[codigo]?.completa || null;
}

function diaSemDados(dataIso) {
  return {
    data: dataIso,
    dataFormatada: formatarDataBr(dataIso),
    diaSemana: diaDaSemana(dataIso),
    tempMaxC: null,
    tempMinC: null,
    rajadaMaxKmh: null,
    chuvaMm: null,
    probabilidadeChuvaPct: null,
    uvMax: null,
    codigoTempo: null,
    condicao: null,
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
    };
  });
  const possuiDados = dias.some((dia) => Number.isFinite(dia.tempMaxC) || Number.isFinite(dia.tempMinC) || dia.condicao);
  return {
    fonte: "INMET — previsão oficial",
    status: possuiDados ? "parcial" : "indisponivel",
    fuso,
    localidade: { nome: cidade.nome, uf: cidade.uf, latitude: cidade.latitude, longitude: cidade.longitude },
    datasSolicitadas: datas,
    consultadoEm: new Date().toISOString(),
    mensagem: possuiDados ? null : "O INMET não retornou previsão para as datas solicitadas.",
    dias,
    fontesCampo: {
      temperatura: "INMET — previsão oficial",
      umidade: "INMET — previsão oficial",
      rajada: dias.some((dia) => Number.isFinite(dia.rajadaMaxKmh))
        ? "INMET — previsão oficial"
        : "Indisponível — o produto municipal do INMET não publicou rajada máxima numérica",
      chuva: dias.some((dia) => Number.isFinite(dia.chuvaMm))
        ? "INMET — previsão oficial"
        : "Indisponível — o produto municipal do INMET não publicou volume previsto numérico",
      probabilidadeChuva: "Indisponível — o produto municipal do INMET não publicou probabilidade diária",
      uv: "Open-Meteo — previsão complementar",
      condicao: "INMET — previsão oficial",
    },
  };
}

function mesclarPrevisaoProximosDias(inmet, complementar) {
  const porDataComplementar = new Map((complementar?.dias || []).map((dia) => [dia.data, dia]));
  const usarNumero = (prioritario, alternativo) => Number.isFinite(prioritario)
    ? prioritario
    : Number.isFinite(alternativo) ? alternativo : null;
  const dias = (inmet?.dias || []).map((oficial) => {
    const alternativo = porDataComplementar.get(oficial.data) || {};
    return {
      ...oficial,
      tempMaxC: usarNumero(oficial.tempMaxC, alternativo.tempMaxC),
      tempMinC: usarNumero(oficial.tempMinC, alternativo.tempMinC),
      rajadaMaxKmh: usarNumero(oficial.rajadaMaxKmh, alternativo.rajadaMaxKmh),
      chuvaMm: usarNumero(oficial.chuvaMm, alternativo.chuvaMm),
      probabilidadeChuvaPct: usarNumero(oficial.probabilidadeChuvaPct, alternativo.probabilidadeChuvaPct),
      uvMax: usarNumero(oficial.uvMax, alternativo.uvMax),
      codigoTempo: Number.isInteger(oficial.codigoTempo) ? oficial.codigoTempo : alternativo.codigoTempo ?? null,
      condicao: oficial.condicao || alternativo.condicao || null,
    };
  });
  const temComplemento = (inmet?.dias || []).some((oficial) => {
    const alternativo = porDataComplementar.get(oficial.data) || {};
    return (!Number.isFinite(oficial.tempMaxC) && Number.isFinite(alternativo.tempMaxC)) ||
      (!Number.isFinite(oficial.tempMinC) && Number.isFinite(alternativo.tempMinC)) ||
      (!Number.isFinite(oficial.rajadaMaxKmh) && Number.isFinite(alternativo.rajadaMaxKmh)) ||
      (!Number.isFinite(oficial.chuvaMm) && Number.isFinite(alternativo.chuvaMm)) ||
      (!Number.isFinite(oficial.probabilidadeChuvaPct) && Number.isFinite(alternativo.probabilidadeChuvaPct)) ||
      Number.isFinite(alternativo.uvMax) ||
      (!oficial.condicao && Boolean(alternativo.condicao));
  });
  const temperaturaInmet = (inmet?.dias || []).some((dia) => Number.isFinite(dia.tempMaxC) || Number.isFinite(dia.tempMinC));
  const temperaturaComplementar = (complementar?.dias || []).some((dia) => Number.isFinite(dia.tempMaxC) || Number.isFinite(dia.tempMinC));
  const condicaoInmet = (inmet?.dias || []).some((dia) => dia.condicao);
  const condicaoComplementar = (complementar?.dias || []).some((dia) => dia.condicao);
  const fonteNumerica = (campo) => {
    let usouInmet = false;
    let usouComplemento = false;
    for (const oficial of inmet?.dias || []) {
      const alternativo = porDataComplementar.get(oficial.data) || {};
      if (Number.isFinite(oficial[campo])) usouInmet = true;
      else if (Number.isFinite(alternativo[campo])) usouComplemento = true;
    }
    return [
      usouInmet ? "INMET — previsão oficial" : null,
      usouComplemento ? "Open-Meteo — previsão complementar" : null,
    ].filter(Boolean).join(" / ") || "Indisponível";
  };
  const temDados = dias.some(campoPreenchido) || dias.some((dia) => Number.isFinite(dia.umidadeMinPct) || Number.isFinite(dia.umidadeMaxPct));
  return {
    ...inmet,
    fonte: temComplemento ? "INMET — previsão oficial / Open-Meteo — previsão complementar" : inmet?.fonte,
    status: temDados ? (dias.every((dia) => campoPreenchido(dia)) ? "ok" : "parcial") : "indisponivel",
    mensagem: temDados ? null : inmet?.mensagem || complementar?.mensagem || "Previsão indisponível.",
    dias,
    fontesCampo: {
      temperatura: temperaturaInmet ? "INMET — previsão oficial" : temperaturaComplementar ? "Open-Meteo — previsão complementar" : "Indisponível",
      umidade: "INMET — previsão oficial",
      rajada: fonteNumerica("rajadaMaxKmh"),
      chuva: fonteNumerica("chuvaMm"),
      probabilidadeChuva: fonteNumerica("probabilidadeChuvaPct"),
      uv: dias.some((dia) => Number.isFinite(dia.uvMax)) ? "Open-Meteo — previsão complementar" : "Indisponível",
      condicao: condicaoInmet ? "INMET — previsão oficial" : condicaoComplementar ? "Open-Meteo — previsão complementar" : "Indisponível",
    },
    complemento: {
      fonte: complementar?.fonte || "Open-Meteo",
      status: complementar?.status || "indisponivel",
      consultadoEm: complementar?.consultadoEm || null,
    },
  };
}

/** Uma fonte prioritária substitui somente a rajada dos dias em que publicou valor válido. */
function aplicarRajadasOceanop(previsao, diasOceanop = [], fontePadrao = "Petrobras — OCEANOP") {
  if (!previsao || !Array.isArray(previsao.dias) || !Array.isArray(diasOceanop) || !diasOceanop.length) return previsao;
  const porData = new Map(diasOceanop.filter((dia) => Number.isFinite(dia?.rajadaMaxKmh)).map((dia) => [dia.data, dia]));
  if (!porData.size) return previsao;
  let utilizou = false;
  const dias = previsao.dias.map((dia) => {
    const oceanop = porData.get(dia.data);
    if (!oceanop) return dia;
    utilizou = true;
    return {
      ...dia,
      rajadaMaxKmh: oceanop.rajadaMaxKmh,
      fonteRajada: oceanop.fonte || fontePadrao,
      rajadaPrevistaEm: oceanop.rajadaPrevistaEm || null,
      rajadaLocal: oceanop.local || null,
    };
  });
  const fontesPrioritarias = [...new Set(diasOceanop.map((dia) => dia?.fonte || fontePadrao).filter(Boolean))];
  const rotuloPrioritario = fontesPrioritarias.join(" / ");
  return utilizou ? {
    ...previsao,
    dias,
    fontesCampo: {
      ...previsao.fontesCampo,
      rajada: dias.every((dia) => !Number.isFinite(dia.rajadaMaxKmh) || fontesPrioritarias.includes(dia.fonteRajada))
        ? rotuloPrioritario
        : `${rotuloPrioritario} / ${previsao.fontesCampo?.rajada || "fonte alternativa"}`,
    },
  } : previsao;
}

/**
 * Converte a resposta diária da Open-Meteo nas linhas da tabela, uma por data
 * esperada. Campos ausentes, não numéricos ou com unidade inesperada ficam
 * `null` (o PDF mostra "Não disponível").
 */
function interpretarResposta(json, datas, fuso) {
  const daily = json?.daily;
  if (!daily || !Array.isArray(daily.time)) throw new Error("Open-Meteo: resposta sem bloco diário.");
  if (json.timezone && json.timezone !== fuso) {
    throw new Error(`Open-Meteo: fuso da resposta (${json.timezone}) difere do solicitado (${fuso}).`);
  }

  const unidades = json.daily_units || {};
  const camposInvalidos = Object.entries(CAMPOS)
    .filter(([campo, unidade]) => unidades[campo] !== unidade)
    .map(([campo]) => campo);

  const valor = (campo, i) => {
    if (camposInvalidos.includes(campo)) return null;
    const v = daily[campo]?.[i];
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  };

  // Probabilidade diária publicada pela fonte (precipitation_probability_max,
  // máxima do dia civil local). Valor fora de 0–100 é tratado como inválido.
  const probabilidade = (i) => {
    const v = valor("precipitation_probability_max", i);
    return v !== null && v >= 0 && v <= 100 ? Math.round(v) : null;
  };

  const indicePorData = new Map(daily.time.map((data, i) => [data, i]));
  const dias = datas.map((data) => {
    const i = indicePorData.get(data);
    if (i === undefined) return diaSemDados(data);
    const codigoTempo = valor("weather_code", i);
    return {
      ...diaSemDados(data),
      tempMaxC: valor("temperature_2m_max", i),
      tempMinC: valor("temperature_2m_min", i),
      rajadaMaxKmh: valor("wind_gusts_10m_max", i),
      chuvaMm: valor("precipitation_sum", i),
      probabilidadeChuvaPct: probabilidade(i),
      uvMax: valor("uv_index_max", i),
      codigoTempo,
      condicao: descreverCondicaoDiaria(codigoTempo),
    };
  });

  return { dias, camposInvalidos, utcOffsetSegundos: Number.isFinite(json.utc_offset_seconds) ? json.utc_offset_seconds : null };
}

function campoPreenchido(dia) {
  return ["tempMaxC", "tempMinC", "rajadaMaxKmh", "chuvaMm", "probabilidadeChuvaPct", "uvMax", "condicao"].some((c) => dia[c] !== null);
}

function diaCompleto(dia) {
  return ["tempMaxC", "tempMinC", "rajadaMaxKmh", "chuvaMm", "probabilidadeChuvaPct", "uvMax", "condicao"].every((c) => dia[c] !== null);
}

/**
 * Previsão dos três dias seguintes ao dia local de `agora`, para a localidade
 * do informativo. Nunca lança: em falha devolve `status: "indisponivel"` com
 * as três datas e todos os campos `null`, para o PDF seguir sendo gerado.
 */
async function obterPrevisaoProximosDias(cidade, { agora = new Date(), fetchImpl = fetch, esperarFn } = {}) {
  const fuso = fusoDaCidade(cidade);
  const datas = proximasDatas(agora, fuso);
  const base = {
    fonte: FONTE,
    fuso,
    localidade: { nome: cidade.nome, uf: cidade.uf, latitude: cidade.latitude, longitude: cidade.longitude },
    datasSolicitadas: datas,
  };

  const params = new URLSearchParams({
    latitude: String(cidade.latitude),
    longitude: String(cidade.longitude),
    daily: Object.keys(CAMPOS).join(","),
    timezone: fuso,
    start_date: datas[0],
    end_date: datas.at(-1),
  });
  const url = aplicarConfiguracaoOpenMeteo(`https://api.open-meteo.com/v1/forecast?${params.toString()}`);

  try {
    const json = await buscarJsonComRetentativa(url, {
      nomeFonte: "Open-Meteo (próximos 3 dias)",
      fetchImpl,
      esperarFn,
    });
    const consultadoEm = new Date().toISOString();
    const { dias, camposInvalidos, utcOffsetSegundos } = interpretarResposta(json, datas, fuso);
    if (!dias.some(campoPreenchido)) throw new Error("Open-Meteo não retornou valores para as datas solicitadas.");
    const status = dias.every(diaCompleto) ? "ok" : "parcial";
    if (camposInvalidos.length) {
      console.warn(`[PREVISAO-3-DIAS] Unidade inesperada em: ${camposInvalidos.join(", ")} — campo(s) exibido(s) como não disponível.`);
    }
    return {
      ...base,
      status,
      url,
      consultadoEm,
      utcOffsetSegundos,
      pontoGrade: Number.isFinite(json.latitude) && Number.isFinite(json.longitude)
        ? { latitude: json.latitude, longitude: json.longitude }
        : null,
      dias,
    };
  } catch (erro) {
    console.error(`[PREVISAO-3-DIAS][ERRO] ${cidade.nome}: ${erro.message}`);
    return {
      ...base,
      status: "indisponivel",
      url,
      consultadoEm: new Date().toISOString(),
      mensagem: "A consulta à previsão diária não retornou dados válidos.",
      dias: datas.map(diaSemDados),
    };
  }
}

module.exports = {
  obterPrevisaoProximosDias,
  montarPrevisaoProximosDiasInmet,
  mesclarPrevisaoProximosDias,
  aplicarRajadasOceanop,
  interpretarResposta,
  proximasDatas,
  dataLocalIso,
  formatarDataBr,
  descreverCondicaoDiaria,
  fusoDaCidade,
  DIAS_PREVISAO,
  FUSO_PADRAO,
};
