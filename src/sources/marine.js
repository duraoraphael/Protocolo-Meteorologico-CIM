// Fonte: Open-Meteo Marine (https://open-meteo.com/en/docs/marine-weather-api)
// API pública, gratuita, sem chave. Fornece altura/período/direção de ondas,
// marulho (swell) e temperatura da superfície do mar.
//
// Atende ao item do protocolo original que pedia dados de mar (OCEANOP) para
// instalações costeiras/offshore — relevante para operação portuária,
// embarque/desembarque, transferência de pessoal e uso de heliponto.

const PERIODOS = {
  manha: { label: "Manhã", horaInicio: 6, horaFim: 12 },
  tarde: { label: "Tarde", horaInicio: 12, horaFim: 18 },
  noite: { label: "Noite", horaInicio: 18, horaFim: 24 },
};

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
async function buscarMar(latitude, longitude) {
  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    hourly:
      "wave_height,wave_period,wave_direction,swell_wave_height,swell_wave_period,sea_surface_temperature",
    timezone: "America/Sao_Paulo",
    forecast_days: "1",
  });

  const url = `https://marine-api.open-meteo.com/v1/marine?${params.toString()}`;

  // Mesma proteção contra HTTP 429 usada em openMeteo.js: em hospedagem
  // compartilhada o IP de saída é usado por muitos clientes.
  let resposta;
  for (let tentativa = 0; tentativa < 3; tentativa++) {
    resposta = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (resposta.ok) break;
    if (resposta.status !== 429) {
      throw new Error(`Open-Meteo Marine respondeu HTTP ${resposta.status}`);
    }
    if (tentativa < 2) await new Promise((r) => setTimeout(r, 2000 * (tentativa + 1)));
  }
  if (!resposta.ok) {
    throw new Error(
      `Open-Meteo Marine respondeu HTTP ${resposta.status} (limite de requisições) após 3 tentativas`
    );
  }

  const json = await resposta.json();
  const horas = json.hourly;

  const temAlgumDado = (horas?.wave_height || []).some((v) => v !== null);
  if (!temAlgumDado) {
    throw new Error(
      "Ponto sem cobertura do modelo de ondas (coordenada em terra). Cadastre 'pontoMar' na base se ela tiver litoral."
    );
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

module.exports = { buscarMar, classificarEstadoMar };
