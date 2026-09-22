// Fonte: Open-Meteo — recorte SEMANAL (7 dias) usado no relatório de segunda.
//
// Diferente de openMeteo.js, que detalha o dia corrente por período
// (manhã/tarde/noite) para o informativo diário, aqui interessa a evolução
// dia a dia: qual dia da semana concentra risco, quando a chuva chega, em que
// dia o vento vira. O agregado diário da Open-Meteo já entrega isso pronto.

const { descreverCodigoSemanal, CODIGOS_TEMPESTADE } = require("./wmoCodes");

// A consulta semanal pede 12 parâmetros diários por 7 dias — bem mais pesada
// que a diária, e a Open-Meteo às vezes estoura o tempo de resposta.
//
// Importante: a retentativa cobre TANTO o HTTP 429 (limite por IP) QUANTO os
// erros lançados pelo fetch (timeout, queda de rede). Tratar só o 429 deixava
// o timeout escapar sem nenhuma nova tentativa, e uma lentidão momentânea da
// API derrubava a base inteira do relatório.
const TENTATIVAS = 4;
const TIMEOUT_MS = 30000;

async function buscarComRetentativa(url, nomeFonte) {
  let ultimoErro;

  for (let tentativa = 0; tentativa < TENTATIVAS; tentativa++) {
    if (tentativa > 0) {
      await new Promise((r) => setTimeout(r, 1500 * tentativa));
    }

    try {
      const resposta = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });

      if (resposta.ok) {
        // A Open-Meteo pode responder HTTP 200 e mesmo assim abortar a
        // geração no meio ("Unexpected error while streaming data:
        // timeoutReached"), devolvendo texto que não é JSON. Sem este
        // tratamento o JSON.parse estoura com uma mensagem incompreensível.
        const texto = await resposta.text();
        try {
          return JSON.parse(texto);
        } catch {
          ultimoErro = new Error(
            `${nomeFonte}: resposta incompleta da API (${texto.slice(0, 80).trim()})`
          );
          continue;
        }
      }

      if (resposta.status === 429) {
        ultimoErro = new Error(`${nomeFonte}: limite de requisições por IP (HTTP 429)`);
        continue;
      }
      // Erros 5xx também são transitórios; 4xx (fora 429) não adianta repetir.
      if (resposta.status >= 500) {
        ultimoErro = new Error(`${nomeFonte} respondeu HTTP ${resposta.status}`);
        continue;
      }
      throw new Error(`${nomeFonte} respondeu HTTP ${resposta.status}`);
    } catch (erro) {
      // TimeoutError/AbortError e falhas de rede entram aqui.
      if (erro.name === "TimeoutError" || erro.name === "AbortError" || erro.name === "TypeError") {
        ultimoErro = new Error(`${nomeFonte}: tempo de resposta esgotado (${TIMEOUT_MS / 1000}s)`);
        continue;
      }
      throw erro;
    }
  }

  throw new Error(`${ultimoErro?.message || nomeFonte + " indisponível"} após ${TENTATIVAS} tentativas`);
}

const arred = (v, casas = 0) => {
  if (v === null || v === undefined || Number.isNaN(v)) return null;
  const f = Math.pow(10, casas);
  return Math.round(v * f) / f;
};

// Só os campos que o relatório realmente exibe. Cada parâmetro extra aumenta
// o tempo de geração do lado da API, e é isso que estoura o limite quando se
// pede várias bases de uma vez.
const CAMPOS_DIARIOS = [
  "weather_code",
  "temperature_2m_max",
  "temperature_2m_min",
  "precipitation_sum",
  "precipitation_probability_max",
  "wind_speed_10m_max",
  "wind_gusts_10m_max",
  "uv_index_max",
].join(",");

// A Open-Meteo aceita várias coordenadas na mesma requisição, o que evita a
// rajada de 12 chamadas seguidas (que provocava HTTP 429/500 e timeouts).
// Mas 12 locais de uma vez faz a API abortar a geração no meio, então o
// meio-termo é pedir em lotes pequenos.
const TAMANHO_LOTE = 4;

function converterDias(d) {
  return d.time.map((data, i) => ({
    data,
    codigoTempo: d.weather_code[i],
    condicao: descreverCodigoSemanal(d.weather_code[i]),
    temMuitaChuva: CODIGOS_TEMPESTADE.has(d.weather_code[i]),
    tempMin: arred(d.temperature_2m_min[i]),
    tempMax: arred(d.temperature_2m_max[i]),
    precipitacaoMm: arred(d.precipitation_sum[i], 1),
    probabilidadeChuva: arred(d.precipitation_probability_max[i]),
    ventoMaxKmh: arred(d.wind_speed_10m_max[i]),
    rajadaMaxKmh: arred(d.wind_gusts_10m_max[i]),
    uvMax: arred(d.uv_index_max[i], 1),
  }));
}

/**
 * Previsão diária de vários pontos de uma vez.
 * @param {{latitude:number,longitude:number}[]} pontos
 * @returns {Promise<Array<{dias:Array}|{erro:string}>>} um item por ponto, na mesma ordem
 */
async function buscarSemanaEmLote(pontos, diasPrevisao = 7) {
  const resultados = new Array(pontos.length);

  for (let inicio = 0; inicio < pontos.length; inicio += TAMANHO_LOTE) {
    const lote = pontos.slice(inicio, inicio + TAMANHO_LOTE);

    const params = new URLSearchParams({
      latitude: lote.map((p) => p.latitude).join(","),
      longitude: lote.map((p) => p.longitude).join(","),
      daily: CAMPOS_DIARIOS,
      timezone: "America/Sao_Paulo",
      forecast_days: String(diasPrevisao),
    });
    const url = `https://api.open-meteo.com/v1/forecast?${params.toString()}`;

    try {
      const json = await buscarComRetentativa(url, "Open-Meteo (semanal)");
      // Com um único ponto a API devolve objeto; com vários, um array.
      const locais = Array.isArray(json) ? json : [json];
      lote.forEach((_, i) => {
        const local = locais[i];
        resultados[inicio + i] = local?.daily
          ? { fonte: "Open-Meteo", url, dias: converterDias(local.daily) }
          : { erro: "Open-Meteo não retornou dados para este ponto." };
      });
    } catch (erro) {
      lote.forEach((_, i) => {
        resultados[inicio + i] = { erro: erro.message };
      });
    }

    if (inicio + TAMANHO_LOTE < pontos.length) {
      await new Promise((r) => setTimeout(r, 800));
    }
  }

  return resultados;
}

/** Previsão semanal de um único ponto (mantida para uso avulso/testes). */
async function buscarSemanaOpenMeteo(latitude, longitude, diasPrevisao = 7) {
  const [r] = await buscarSemanaEmLote([{ latitude, longitude }], diasPrevisao);
  if (r.erro) throw new Error(r.erro);
  return r;
}

/**
 * Altura de onda diária de vários pontos costeiros de uma vez.
 * @returns {Promise<Array<{dias:Array}|{erro:string}>>} um item por ponto
 */
async function buscarSemanaMarEmLote(pontos, diasPrevisao = 7) {
  const resultados = new Array(pontos.length);

  for (let inicio = 0; inicio < pontos.length; inicio += TAMANHO_LOTE) {
    const lote = pontos.slice(inicio, inicio + TAMANHO_LOTE);

    const params = new URLSearchParams({
      latitude: lote.map((p) => p.latitude).join(","),
      longitude: lote.map((p) => p.longitude).join(","),
      daily: "wave_height_max,wave_period_max",
      timezone: "America/Sao_Paulo",
      forecast_days: String(diasPrevisao),
    });
    const url = `https://marine-api.open-meteo.com/v1/marine?${params.toString()}`;

    try {
      const json = await buscarComRetentativa(url, "Open-Meteo Marine (semanal)");
      const locais = Array.isArray(json) ? json : [json];
      lote.forEach((_, i) => {
        const d = locais[i]?.daily;
        const temDado = (d?.wave_height_max || []).some((v) => v !== null);
        resultados[inicio + i] = temDado
          ? {
              fonte: "Open-Meteo Marine",
              url,
              dias: d.time.map((data, k) => ({
                data,
                alturaMaxM: arred(d.wave_height_max[k], 1),
                periodoOndaS: arred(d.wave_period_max[k], 1),
              })),
            }
          : { erro: "Ponto sem cobertura do modelo de ondas." };
      });
    } catch (erro) {
      lote.forEach((_, i) => {
        resultados[inicio + i] = { erro: erro.message };
      });
    }

    if (inicio + TAMANHO_LOTE < pontos.length) {
      await new Promise((r) => setTimeout(r, 800));
    }
  }

  return resultados;
}

async function buscarSemanaMar(latitude, longitude, diasPrevisao = 7) {
  const [r] = await buscarSemanaMarEmLote([{ latitude, longitude }], diasPrevisao);
  if (r.erro) throw new Error(r.erro);
  return r;
}

module.exports = {
  buscarSemanaOpenMeteo,
  buscarSemanaMar,
  buscarSemanaEmLote,
  buscarSemanaMarEmLote,
};
