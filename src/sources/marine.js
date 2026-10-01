// Fonte: Open-Meteo Marine (https://open-meteo.com/en/docs/marine-weather-api)
// API pública, gratuita, sem chave. Fornece altura/período/direção de ondas,
// marulho (swell) e temperatura da superfície do mar.
//
// Atende ao item do protocolo original que pedia dados de mar (OCEANOP) para
// instalações costeiras/offshore — relevante para operação portuária,
// embarque/desembarque, transferência de pessoal e uso de heliponto.

const fs = require("node:fs");
const path = require("node:path");

const {
  API_TENTATIVAS,
  buscarJsonComRetentativa,
} = require("./httpJsonClient");
const {
  operacional,
  degradado,
  indisponivel,
  registrarFalha,
} = require("./sourceHealth");

const PERIODOS = {
  manha: { label: "Manhã", horaInicio: 6, horaFim: 12 },
  tarde: { label: "Tarde", horaInicio: 12, horaFim: 18 },
  noite: { label: "Noite", horaInicio: 18, horaFim: 24 },
};

const OPEN_METEO_MARINE_TIMEOUT_MS = 15000;
const OPEN_METEO_MARINE_TENTATIVAS = API_TENTATIVAS;
const ARQUIVO_CACHE_MARINE = path.join(__dirname, "..", "..", "data", "marine-cache.json");

// Escala Douglas simplificada (estado do mar), usada na marinha mercante.
function classificarEstadoMar(alturaM) {
  if (alturaM === null || alturaM === undefined) return "Sem dado";
  if (alturaM < 0.1) return "Calmo (espelhado)";
  if (alturaM < 0.5) return "Calmo (ondulado)";
  if (alturaM < 1.25) return "Leve";
  if (alturaM < 2.5) return "Moderado";
  if (alturaM < 4.0) return "Grosso";
  if (alturaM < 6.0) return "Muito grosso";
  return "Alto a tempestuoso";
}

function direcaoCardinal(graus) {
  if (graus === null || graus === undefined || Number.isNaN(graus)) return "—";
  const pontos = [
    "N", "N-NE", "NE", "E-NE", "E", "E-SE", "SE", "S-SE",
    "S", "S-SW", "SW", "W-SW", "W", "W-NW", "NW", "N-NW",
  ];
  return pontos[Math.round(graus / 22.5) % 16];
}

function media(valores) {
  const validos = valores.filter((v) => v !== null && v !== undefined);
  if (validos.length === 0) return null;
  return validos.reduce((a, b) => a + b, 0) / validos.length;
}

function maximo(valores) {
  const validos = valores.filter((v) => v !== null && v !== undefined);
  return validos.length ? Math.max(...validos) : null;
}

function arredondar(valor, casas = 1) {
  if (valor === null) return null;
  const f = Math.pow(10, casas);
  return Math.round(valor * f) / f;
}

function resumirPeriodo(horas, chave) {
  const { horaInicio, horaFim } = PERIODOS[chave];
  const idxs = horas.time
    .map((t, i) => ({ t, i }))
    .filter(({ t }) => {
      const h = new Date(t).getHours();
      return h >= horaInicio && h < horaFim;
    })
    .map(({ i }) => i);

  const pegar = (campo) => idxs.map((i) => horas[campo]?.[i]);

  const alturaMax = maximo(pegar("wave_height"));

  return {
    periodo: PERIODOS[chave].label,
    alturaMaxM: arredondar(alturaMax),
    alturaMediaM: arredondar(media(pegar("wave_height"))),
    periodoOndaS: arredondar(media(pegar("wave_period"))),
    direcaoOnda: direcaoCardinal(media(pegar("wave_direction"))),
    marulhoMaxM: arredondar(maximo(pegar("swell_wave_height"))),
    estadoMar: classificarEstadoMar(alturaMax),
  };
}

/**
 * Busca condições de mar para um ponto costeiro/oceânico.
 * Lança se o ponto estiver em terra (a API responde só com nulos).
 */
async function buscarMar(latitude, longitude, {
  fetchImpl = fetch,
  timeoutMs = OPEN_METEO_MARINE_TIMEOUT_MS,
  esperarFn,
  logger,
} = {}) {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
    const erro = new Error("Open-Meteo Marine: coordenadas ausentes ou inválidas.");
    erro.tipo = "configuration";
    erro.code = "INVALID_COORDINATES";
    erro.transitorio = false;
    throw erro;
  }
  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    hourly:
      "wave_height,wave_period,wave_direction,swell_wave_height,swell_wave_period,sea_surface_temperature",
    timezone: "America/Sao_Paulo",
    forecast_days: "1",
  });

  const url = `https://marine-api.open-meteo.com/v1/marine?${params.toString()}`;

  const json = await buscarJsonComRetentativa(url, {
    nomeFonte: "Open-Meteo Marine",
    fetchImpl,
    timeoutMs,
    tentativas: OPEN_METEO_MARINE_TENTATIVAS,
    atrasoBaseMs: 1000,
    esperarFn,
    logger: logger === undefined && fetchImpl === globalThis.fetch ? console : logger,
    prefixoLog: "OPEN-METEO-MARINE",
  });
  const horas = json.hourly;

  if (!horas || !Array.isArray(horas.time)) {
    const erro = new Error("Open-Meteo Marine retornou payload sem série horária.");
    erro.name = "ParserError";
    erro.tipo = "parser";
    erro.code = "MARINE_INVALID_PAYLOAD";
    erro.transitorio = false;
    throw erro;
  }

  const temAlgumDado = (horas?.wave_height || []).some((v) => v !== null);
  if (!temAlgumDado) {
    const erro = new Error(
      "Ponto sem cobertura do modelo de ondas (coordenada em terra). Cadastre 'pontoMar' na base se ela tiver litoral."
    );
    erro.tipo = "no_data";
    erro.code = "MARINE_NO_COVERAGE";
    erro.transitorio = false;
    throw erro;
  }

  const periodos = {
    manha: resumirPeriodo(horas, "manha"),
    tarde: resumirPeriodo(horas, "tarde"),
    noite: resumirPeriodo(horas, "noite"),
  };

  const lista = Object.values(periodos);
  const alturaMaxDiaM = maximo(lista.map((p) => p.alturaMaxM));

  return {
    fonte: "Open-Meteo Marine",
    url,
    alturaMaxDiaM,
    estadoMarDia: classificarEstadoMar(alturaMaxDiaM),
    temperaturaMarC: arredondar(media(horas.sea_surface_temperature || [])),
    periodos: lista,
  };
}

function lerCacheMarine() {
  try {
    return JSON.parse(fs.readFileSync(ARQUIVO_CACHE_MARINE, "utf8"));
  } catch (erro) {
    if (erro.code === "ENOENT") return {};
    throw erro;
  }
}

function salvarCacheMarine(estado) {
  fs.mkdirSync(path.dirname(ARQUIVO_CACHE_MARINE), { recursive: true });
  const temporario = `${ARQUIVO_CACHE_MARINE}.${process.pid}.tmp`;
  fs.writeFileSync(temporario, JSON.stringify(estado, null, 2), "utf8");
  fs.renameSync(temporario, ARQUIVO_CACHE_MARINE);
}

async function buscarMarComFallback(cidade, {
  consultar = buscarMar,
  carregarCache = lerCacheMarine,
  salvarCache = salvarCacheMarine,
  agora = () => new Date(),
} = {}) {
  const ponto = cidade.pontoMar || { latitude: cidade.latitude, longitude: cidade.longitude };
  const checkedAt = agora().toISOString();
  try {
    const resultado = await consultar(ponto.latitude, ponto.longitude);
    const dados = {
      ...resultado,
      consultadoEm: checkedAt,
      ultimaAtualizacao: checkedAt,
      desatualizado: false,
      ...(cidade.pontoMar?.referencia ? { referenciaPonto: cidade.pontoMar.referencia } : {}),
    };
    const cache = carregarCache();
    cache[cidade.chave] = { consultadoEm: checkedAt, dados };
    salvarCache(cache);
    return {
      dados,
      erro: null,
      health: operacional("Open-Meteo Marine", "Condições marítimas recebidas", {
        checkedAt,
        lastSuccessAt: checkedAt,
      }),
    };
  } catch (erro) {
    registrarFalha("OPEN-METEO-MARINE", erro);
    let armazenado = null;
    try { armazenado = carregarCache()[cidade.chave] || null; }
    catch (erroCache) { registrarFalha("OPEN-METEO-MARINE-CACHE", erroCache); }
    const lastSuccessAt = armazenado?.consultadoEm || armazenado?.dados?.consultadoEm || null;
    if (armazenado?.dados && lastSuccessAt) {
      return {
        dados: {
          ...armazenado.dados,
          consultadoEm: lastSuccessAt,
          ultimaAtualizacao: lastSuccessAt,
          desatualizado: true,
        },
        erro,
        health: degradado("Open-Meteo Marine", erro, lastSuccessAt, { checkedAt }),
      };
    }
    return {
      dados: null,
      erro,
      health: indisponivel("Open-Meteo Marine", erro, "Não foi possível atualizar esta fonte.", { checkedAt }),
    };
  }
}

module.exports = {
  buscarMar,
  buscarMarComFallback,
  classificarEstadoMar,
  OPEN_METEO_MARINE_TIMEOUT_MS,
  OPEN_METEO_MARINE_TENTATIVAS,
  ARQUIVO_CACHE_MARINE,
  lerCacheMarine,
  salvarCacheMarine,
};
