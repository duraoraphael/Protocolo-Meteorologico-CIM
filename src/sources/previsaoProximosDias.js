// Seção "Previsão para os próximos 3 dias" do informativo diário.
//
// Fonte: Open-Meteo, agregado DIÁRIO. É a única fonte integrada que entrega,
// para os três dias seguintes, todos os campos da tabela (máx./mín., rajada,
// chuva acumulada, UV máximo e código de tempo): o Windy não traz UV e o INMET
// não traz rajada nem volume de chuva.
//
// A Open-Meteo calcula os agregados diários no dia civil (00h–24h) do fuso
// pedido em `timezone`, então pedimos no fuso da própria localidade e não é
// preciso agregar séries horárias aqui. As três datas são calculadas antes da
// consulta e pedidas explicitamente (start_date/end_date); cada linha da
// tabela só recebe o valor cuja data a fonte devolveu — nunca o de outro dia.

const { WMO } = require("./wmoCodes");
const { buscarJsonComRetentativa } = require("./httpJsonClient");

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
    uvMax: null,
    codigoTempo: null,
    condicao: null,
  };
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
      uvMax: valor("uv_index_max", i),
      codigoTempo,
      condicao: descreverCondicaoDiaria(codigoTempo),
    };
  });

  return { dias, camposInvalidos, utcOffsetSegundos: Number.isFinite(json.utc_offset_seconds) ? json.utc_offset_seconds : null };
}

function campoPreenchido(dia) {
  return ["tempMaxC", "tempMinC", "rajadaMaxKmh", "chuvaMm", "uvMax", "condicao"].some((c) => dia[c] !== null);
}

function diaCompleto(dia) {
  return ["tempMaxC", "tempMinC", "rajadaMaxKmh", "chuvaMm", "uvMax", "condicao"].every((c) => dia[c] !== null);
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
  const url = `https://api.open-meteo.com/v1/forecast?${params.toString()}`;

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
  interpretarResposta,
  proximasDatas,
  dataLocalIso,
  formatarDataBr,
  descreverCondicaoDiaria,
  fusoDaCidade,
  DIAS_PREVISAO,
  FUSO_PADRAO,
};
