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

const CODIGOS_TEMPESTADE = new Set([95, 96, 99]);

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

function classificarIntensidadeVento(kmh) {
  if (kmh >= 60) return "Muito forte, com rajadas severas";
  if (kmh >= 40) return "Forte, com rajadas";
  if (kmh >= 20) return "Moderado";
  return "Fraco";
}

// Divide as horas do dia corrente em três períodos operacionais.
const PERIODOS = {
  manha: { label: "Manhã", horaInicio: 6, horaFim: 12 },
  tarde: { label: "Tarde", horaInicio: 12, horaFim: 18 },
  noite: { label: "Noite", horaInicio: 18, horaFim: 24 },
};

function resumirPeriodo(horas, chave) {
  const { horaInicio, horaFim } = PERIODOS[chave];
  const idxs = horas.time
    .map((t, i) => ({ t, i }))
    .filter(({ t }) => {
      const h = new Date(t).getHours();
      return h >= horaInicio && h < horaFim;
    })
    .map(({ i }) => i);

  if (idxs.length === 0) {
    return {
      periodo: PERIODOS[chave].label,
      direcao: "—",
      intensidadeVento: "Sem dado",
      velocidadeMediaKmh: null,
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
  const rajadaMaxKmh = Math.max(...rajadas);
  const direcaoMedia =
    direcoes.reduce((a, b) => a + b, 0) / direcoes.length;
  const probabilidadeChuva = Math.max(...probs);
  const precipitacaoMm = precs.reduce((a, b) => a + b, 0);
  const precipitacoesValidas = precs.filter(Number.isFinite);
  const precipitacaoHorariaMaxMm = precipitacoesValidas.length
    ? Math.max(...precipitacoesValidas)
    : null;
  const tempestade = codigos.some((c) => CODIGOS_TEMPESTADE.has(c));

  return {
    periodo: PERIODOS[chave].label,
    direcao: direcaoCardinal(direcaoMedia),
    intensidadeVento: classificarIntensidadeVento(rajadaMaxKmh),
    velocidadeMediaKmh: Math.round(velocidadeMediaKmh),
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

async function buscarOpenMeteo(latitude, longitude) {
  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    current: "temperature_2m,weather_code,is_day",
    hourly:
      "temperature_2m,relative_humidity_2m,precipitation_probability,precipitation,wind_speed_10m,wind_gusts_10m,wind_direction_10m,weather_code",
    daily:
      "temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max,weather_code",
    timezone: "America/Sao_Paulo",
    forecast_days: "1",
  });

  const url = `https://api.open-meteo.com/v1/forecast?${params.toString()}`;

  // A API gratuita limita requisições por IP. Em hospedagem compartilhada
  // (Render, etc.) o IP de saída é usado por muitos clientes, então HTTP 429
  // acontece com frequência — vale a pena tentar de novo antes de desistir,
  // em vez de cair direto no modo "só INMET" (que não tem rajada de vento).
  let resposta;
  for (let tentativa = 0; tentativa < 3; tentativa++) {
    resposta = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (resposta.ok) break;
    if (resposta.status !== 429) {
      throw new Error(`Open-Meteo respondeu HTTP ${resposta.status}`);
    }
    if (tentativa < 2) {
      await new Promise((r) => setTimeout(r, 2000 * (tentativa + 1)));
    }
  }
  if (!resposta.ok) {
    throw new Error(
      `Open-Meteo respondeu HTTP ${resposta.status} (limite de requisições por IP) após 3 tentativas`
    );
  }

  const json = await resposta.json();
  const horas = json.hourly;
  const dia = json.daily;

  const periodos = {
    manha: resumirPeriodo(horas, "manha"),
    tarde: resumirPeriodo(horas, "tarde"),
    noite: resumirPeriodo(horas, "noite"),
  };

  const umidades = horas.relative_humidity_2m;
  const listaPeriodos = Object.values(periodos);
  const temTempestadeHoje = listaPeriodos.some((p) => p.tempestade);

  // Importante: os totais/máximos abaixo são derivados dos MESMOS períodos
  // (Manhã/Tarde/Noite, 06h-24h) exibidos nas tabelas — nunca do agregado
  // "dia inteiro" bruto da Open-Meteo (que inclui a madrugada 00h-06h já
  // encerrada). Misturar as duas janelas gerava alarmes de "chuva intensa"
  // baseados em picos de madrugada que já haviam passado na hora da consulta.
  const precipitacaoTotalMm =
    Math.round(listaPeriodos.reduce((soma, p) => soma + (p.precipitacaoMm || 0), 0) * 10) / 10;
  const precipitacaoHorariaMaxMm = Math.max(
    ...listaPeriodos.map((p) => p.precipitacaoHorariaMaxMm ?? 0)
  );
  const probabilidadeChuvaMax = Math.max(...listaPeriodos.map((p) => p.probabilidadeChuva ?? 0));
  const rajadaMaxKmh = Math.max(...listaPeriodos.map((p) => p.rajadaMaxKmh ?? 0));
  const velocidadeMaxKmh = Math.max(...listaPeriodos.map((p) => p.velocidadeMediaKmh ?? 0));

  return {
    fonte: "Open-Meteo",
    url,
    dataReferencia: dia.time[0],
    condicaoGeral: descreverCodigo(dia.weather_code[0]),
    atual: json.current ? {
      temperaturaC: json.current.temperature_2m ?? null,
      codigo: json.current.weather_code ?? null,
      condicao: descreverCodigo(json.current.weather_code),
      dia: json.current.is_day === 1,
      horario: json.current.time,
    } : null,
    tempMin: Math.round(dia.temperature_2m_min[0]),
    tempMax: Math.round(dia.temperature_2m_max[0]),
    umidadeMin: Math.round(Math.min(...umidades)),
    umidadeMax: Math.round(Math.max(...umidades)),
    precipitacaoTotalMm,
    precipitacaoHorariaMaxMm,
    probabilidadeChuvaMax,
    rajadaMaxKmh,
    velocidadeMaxKmh,
    temTempestadeHoje,
    periodos,
  };
}

module.exports = { buscarOpenMeteo, direcaoCardinal, classificarIntensidadeVento };
