// Fonte: Open-Meteo (https://open-meteo.com) — API pública, gratuita, sem
// necessidade de chave/cadastro. Usada como base numérica (temperatura,
// umidade, vento, probabilidade e volume de chuva) por período do dia.

const WMO_DESCRICOES = {
  0: "Céu limpo",
  1: "Predomínio de sol, poucas nuvens",
  2: "Parcialmente nublado",
  3: "Nublado a encoberto",
  45: "Névoa",
  48: "Névoa com formação de geada",
  51: "Garoa fraca",
  53: "Garoa moderada",
  55: "Garoa intensa",
  56: "Garoa congelante fraca",
  57: "Garoa congelante intensa",
  61: "Chuva fraca",
  63: "Chuva moderada",
  65: "Chuva forte",
  66: "Chuva congelante fraca",
  67: "Chuva congelante forte",
  71: "Neve fraca",
  73: "Neve moderada",
  75: "Neve forte",
  77: "Grãos de neve",
  80: "Pancadas de chuva fracas e isoladas",
  81: "Pancadas de chuva moderadas",
  82: "Pancadas de chuva fortes/violentas",
  85: "Pancadas de neve fracas",
  86: "Pancadas de neve fortes",
  95: "Trovoada",
  96: "Trovoada com granizo fraco",
  99: "Trovoada com granizo forte",
};

const {
  API_TIMEOUT_MS,
  API_TENTATIVAS,
  buscarJsonComRetentativa,
} = require("./httpJsonClient");

const CODIGOS_TEMPESTADE = new Set([95, 96, 99]);
const OPEN_METEO_TIMEOUT_MS = API_TIMEOUT_MS;
const OPEN_METEO_TENTATIVAS = API_TENTATIVAS;

function descreverCodigo(codigo) {
  return WMO_DESCRICOES[codigo] || "Condição indisponível";
}

function direcaoCardinal(graus) {
  if (graus === null || graus === undefined || Number.isNaN(graus)) return "—";
  const pontos = [
    "N", "N-NE", "NE", "E-NE", "E", "E-SE", "SE", "S-SE",
    "S", "S-SW", "SW", "W-SW", "W", "W-NW", "NW", "N-NW",
  ];
  const idx = Math.round(graus / 22.5) % 16;
  return pontos[idx];
}

// Classifica o VENTO (velocidade sustentada a 10 m), nunca a rajada: rajada
// é outra grandeza, exibida na sua própria coluna.
function classificarIntensidadeVento(kmh) {
  if (!Number.isFinite(kmh)) return "Sem dado";
  if (kmh >= 60) return "Muito forte";
  if (kmh >= 40) return "Forte";
  if (kmh >= 20) return "Moderado";
  return "Fraco";
}

// Divide as horas de hoje em três períodos operacionais. São as mesmas
// janelas no painel e nos PDFs das 05h e das 15h (hoje, das 05h até 00h).
const INICIO_JANELA_HOJE = 5;
const PERIODOS = {
  manha: { label: "Manhã", horaInicio: 5, horaFim: 12 },
  tarde: { label: "Tarde", horaInicio: 12, horaFim: 18 },
  noite: { label: "Noite", horaInicio: 18, horaFim: 24 },
};

const hh = (hora) => `${String(hora % 24).padStart(2, "0")}h`;

function resumirPeriodo(horas, chave, { dataReferencia, inicioHora = INICIO_JANELA_HOJE } = {}) {
  const { horaInicio, horaFim } = PERIODOS[chave];
  const inicio = Math.max(horaInicio, inicioHora);
  // Os horários da Open-Meteo vêm no fuso pedido ("AAAA-MM-DDTHH:MM", sem
  // offset): compara-se o texto, sem depender do fuso da máquina.
  const idxs = horas.time
    .map((t, i) => ({ t, i }))
    .filter(({ t }) => {
      const h = Number(t.slice(11, 13));
      return t.slice(0, 10) === dataReferencia && h >= inicio && h < horaFim;
    })
    .map(({ i }) => i);
  const janela = { inicioHora: inicio, fimHora: horaFim, janela: `${hh(inicio)}–${hh(horaFim)}` };

  if (idxs.length === 0) {
    return {
      periodo: PERIODOS[chave].label,
      ...janela,
      direcao: "—",
      intensidadeVento: "Sem dado",
      velocidadeMediaKmh: null,
      velocidadeMaxKmh: null,
      rajadaMaxKmh: null,
      probabilidadeChuva: null,
      precipitacaoMm: 0,
      precipitacaoHorariaMaxMm: null,
      tempestade: false,
    };
  }

  const velocidades = idxs.map((i) => horas.wind_speed_10m[i]);
  const rajadas = idxs.map((i) => horas.wind_gusts_10m[i]);
  const direcoes = idxs.map((i) => horas.wind_direction_10m[i]);
  const probs = idxs.map((i) => horas.precipitation_probability[i]);
  const precs = idxs.map((i) => horas.precipitation[i]);
  const codigos = idxs.map((i) => horas.weather_code[i]);

  const velocidadeMediaKmh =
    velocidades.reduce((a, b) => a + b, 0) / velocidades.length;
  const velocidadeMaxKmh = Math.max(...velocidades);
  const rajadaMaxKmh = Math.max(...rajadas);
  // Média vetorial: a aritmética dos graus erra perto do norte (350° e 10°
  // dariam 180°).
  const direcaoMedia = (Math.atan2(
    direcoes.reduce((a, d) => a + Math.sin((d * Math.PI) / 180), 0),
    direcoes.reduce((a, d) => a + Math.cos((d * Math.PI) / 180), 0)
  ) * 180 / Math.PI + 360) % 360;
  const probabilidadeChuva = Math.max(...probs);
  const precipitacaoMm = precs.reduce((a, b) => a + b, 0);
  const precipitacoesValidas = precs.filter(Number.isFinite);
  const precipitacaoHorariaMaxMm = precipitacoesValidas.length
    ? Math.max(...precipitacoesValidas)
    : null;
  const tempestade = codigos.some((c) => CODIGOS_TEMPESTADE.has(c));

  return {
    periodo: PERIODOS[chave].label,
    ...janela,
    direcao: direcaoCardinal(direcaoMedia),
    intensidadeVento: `${classificarIntensidadeVento(Math.round(velocidadeMaxKmh))} (até ${Math.round(velocidadeMaxKmh)} km/h)`,
    velocidadeMediaKmh: Math.round(velocidadeMediaKmh),
    velocidadeMaxKmh: Math.round(velocidadeMaxKmh),
    rajadaMaxKmh: Math.round(rajadaMaxKmh),
    probabilidadeChuva: Math.round(probabilidadeChuva),
    precipitacaoMm: Math.round(precipitacaoMm * 10) / 10,
    precipitacaoHorariaMaxMm:
      precipitacaoHorariaMaxMm == null
        ? null
        : Math.round(precipitacaoHorariaMaxMm * 10) / 10,
    tempestade,
  };
}

/**
 * @param {object} [opcoes]
 * @param {number} [opcoes.inicioHora=5] início da janela de hoje (hora local).
 * @param {number} [opcoes.diasPrevisao=1] hoje + dias seguintes.
 * @param {boolean} [opcoes.agregarJanela=false] temperatura, umidade e
 *   condição de hoje calculadas só na janela (relatórios agendados); sem
 *   isso, usam o agregado diário da fonte.
 * @param {string} [opcoes.fuso] fuso da localidade: horários e agregados
 *   diários seguem o dia civil desse fuso.
 */
async function buscarOpenMeteo(latitude, longitude, {
  inicioHora = INICIO_JANELA_HOJE,
  diasPrevisao = 1,
  agregarJanela = false,
  fuso = "America/Sao_Paulo",
  fetchImpl = fetch,
  timeoutMs = OPEN_METEO_TIMEOUT_MS,
  esperarFn,
} = {}) {
  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    current: "temperature_2m,weather_code,is_day",
    hourly:
      "temperature_2m,relative_humidity_2m,precipitation_probability,precipitation,wind_speed_10m,wind_gusts_10m,wind_direction_10m,weather_code",
    daily:
      "temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max,weather_code",
    timezone: fuso,
    forecast_days: String(diasPrevisao),
  });

  const url = `https://api.open-meteo.com/v1/forecast?${params.toString()}`;

  const json = await buscarJsonComRetentativa(url, {
    nomeFonte: "Open-Meteo",
    fetchImpl,
    timeoutMs,
    tentativas: OPEN_METEO_TENTATIVAS,
    esperarFn,
  });
  const horas = json.hourly;
  const dia = json.daily;
  const dataReferencia = dia.time[0];
  const indicesJanela = horas.time.map((instante, i) => ({ instante, i }))
    .filter(({ instante }) => instante.slice(0, 10) === dataReferencia && Number(instante.slice(11, 13)) >= inicioHora)
    .map(({ i }) => i);
  if (agregarJanela && !indicesJanela.length) throw new Error("Open-Meteo não retornou horas para a janela solicitada.");
  const valoresJanela = (campo) => indicesJanela.map((i) => horas[campo]?.[i]).filter(Number.isFinite);
  const minimoJanela = (campo) => valoresJanela(campo).length ? Math.min(...valoresJanela(campo)) : null;
  const maximoJanela = (campo) => valoresJanela(campo).length ? Math.max(...valoresJanela(campo)) : null;

  const periodos = {
    manha: resumirPeriodo(horas, "manha", { dataReferencia, inicioHora }),
    tarde: resumirPeriodo(horas, "tarde", { dataReferencia, inicioHora }),
    noite: resumirPeriodo(horas, "noite", { dataReferencia, inicioHora }),
  };

  const umidades = horas.relative_humidity_2m;
  const listaPeriodos = Object.values(periodos);
  const temTempestadeHoje = listaPeriodos.some((p) => p.tempestade);

  // Importante: os totais/máximos abaixo são derivados dos MESMOS períodos
  // (Manhã/Tarde/Noite, 05h-24h) exibidos nas tabelas — nunca do agregado
  // "dia inteiro" bruto da Open-Meteo (que inclui a madrugada 00h-05h já
  // encerrada). Misturar as duas janelas gerava alarmes de "chuva intensa"
  // baseados em picos de madrugada que já haviam passado na hora da consulta.
  const precipitacaoTotalMm =
    Math.round(listaPeriodos.reduce((soma, p) => soma + (p.precipitacaoMm || 0), 0) * 10) / 10;
  const precipitacaoHorariaMaxMm = Math.max(
    ...listaPeriodos.map((p) => p.precipitacaoHorariaMaxMm ?? 0)
  );
  const probabilidadeChuvaMax = Math.max(...listaPeriodos.map((p) => p.probabilidadeChuva ?? 0));
  const rajadaMaxKmh = Math.max(...listaPeriodos.map((p) => p.rajadaMaxKmh ?? 0));
  const velocidadeMaxKmh = Math.max(...listaPeriodos.map((p) => p.velocidadeMaxKmh ?? 0));

  return {
    fonte: "Open-Meteo",
    url,
    dataReferencia: dia.time[0],
    fuso,
    janelaHoje: { inicioHora, fimHora: 24, rotulo: `${hh(inicioHora)}–00h` },
    condicaoGeral: !agregarJanela
      ? descreverCodigo(dia.weather_code[0])
      : descreverCodigo(horas.weather_code[indicesJanela[0]]),
    atual: json.current ? {
      temperaturaC: json.current.temperature_2m ?? null,
      codigo: json.current.weather_code ?? null,
      condicao: descreverCodigo(json.current.weather_code),
      dia: json.current.is_day === 1,
      horario: json.current.time,
    } : null,
    tempMin: !agregarJanela ? Math.round(dia.temperature_2m_min[0]) : minimoJanela("temperature_2m"),
    tempMax: !agregarJanela ? Math.round(dia.temperature_2m_max[0]) : maximoJanela("temperature_2m"),
    umidadeMin: !agregarJanela ? Math.round(Math.min(...umidades)) : minimoJanela("relative_humidity_2m"),
    umidadeMax: !agregarJanela ? Math.round(Math.max(...umidades)) : maximoJanela("relative_humidity_2m"),
    precipitacaoTotalMm,
    precipitacaoHorariaMaxMm,
    probabilidadeChuvaMax,
    rajadaMaxKmh,
    velocidadeMaxKmh,
    temTempestadeHoje,
    periodos,
    previsaoDias: dia.time.map((data, i) => ({
      data,
      condicao: descreverCodigo(dia.weather_code[i]),
      tempMin: dia.temperature_2m_min[i],
      tempMax: dia.temperature_2m_max[i],
      // Agregado diário da fonte no dia civil local (00h–24h).
      janela: "00h–24h",
      chuvaMm: Number.isFinite(dia.precipitation_sum[i]) ? Math.round(dia.precipitation_sum[i] * 10) / 10 : null,
      rajadaKmh: Number.isFinite(dia.wind_gusts_10m_max[i]) ? Math.round(dia.wind_gusts_10m_max[i]) : null,
    })),
  };
}

module.exports = {
  buscarOpenMeteo,
  direcaoCardinal,
  classificarIntensidadeVento,
  INICIO_JANELA_HOJE,
  PERIODOS,
  OPEN_METEO_TIMEOUT_MS,
  OPEN_METEO_TENTATIVAS,
};
