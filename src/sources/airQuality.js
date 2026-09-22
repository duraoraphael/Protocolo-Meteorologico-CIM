// Fonte: Open-Meteo Air Quality (https://open-meteo.com/en/docs/air-quality-api)
// API pública, gratuita, sem chave. Fornece material particulado (PM2.5/PM10),
// índice UV e poeira.
//
// Relevante para o protocolo do CIM por dois motivos operacionais:
// - Índice UV: exposição de equipes em trabalho externo (queimadura solar em
//   poucos minutos com UV extremo — item de segurança do colaborador).
// - PM2.5/PM10: qualidade do ar respirável, especialmente em bases próximas a
//   polos industriais/refinarias e em períodos de queimadas.

// Faixas do índice UV conforme a Organização Mundial da Saúde (OMS).
function classificarUv(uv) {
  if (uv === null || uv === undefined) return { nivel: "Sem dado", categoria: null };
  if (uv < 3) return { nivel: "Baixo", categoria: "baixo" };
  if (uv < 6) return { nivel: "Moderado", categoria: "moderado" };
  if (uv < 8) return { nivel: "Alto", categoria: "alto" };
  if (uv < 11) return { nivel: "Muito alto", categoria: "muito_alto" };
  return { nivel: "Extremo", categoria: "extremo" };
}

// Faixas de PM2.5 conforme diretriz da OMS (2021) para média de 24h:
// 15 µg/m³ é o limite recomendado; acima disso o risco à saúde cresce.
function classificarPm25(pm) {
  if (pm === null || pm === undefined) return { nivel: "Sem dado", categoria: null };
  if (pm <= 15) return { nivel: "Boa", categoria: "boa" };
  if (pm <= 25) return { nivel: "Moderada", categoria: "moderada" };
  if (pm <= 50) return { nivel: "Ruim", categoria: "ruim" };
  if (pm <= 75) return { nivel: "Muito ruim", categoria: "muito_ruim" };
  return { nivel: "Péssima", categoria: "pessima" };
}

function maximo(valores) {
  const validos = (valores || []).filter((v) => v !== null && v !== undefined);
  return validos.length ? Math.max(...validos) : null;
}

function media(valores) {
  const validos = (valores || []).filter((v) => v !== null && v !== undefined);
  if (!validos.length) return null;
  return validos.reduce((a, b) => a + b, 0) / validos.length;
}

function arredondar(valor, casas = 1) {
  if (valor === null) return null;
  const f = Math.pow(10, casas);
  return Math.round(valor * f) / f;
}

async function buscarQualidadeAr(latitude, longitude) {
  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    hourly: "pm10,pm2_5,uv_index,dust,carbon_monoxide",
    timezone: "America/Sao_Paulo",
    forecast_days: "1",
  });

  const url = `https://air-quality-api.open-meteo.com/v1/air-quality?${params.toString()}`;

  let resposta;
  for (let tentativa = 0; tentativa < 3; tentativa++) {
    resposta = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (resposta.ok) break;
    if (resposta.status !== 429) {
      throw new Error(`Open-Meteo Air Quality respondeu HTTP ${resposta.status}`);
    }
    if (tentativa < 2) await new Promise((r) => setTimeout(r, 2000 * (tentativa + 1)));
  }
  if (!resposta.ok) {
    throw new Error(
      `Open-Meteo Air Quality respondeu HTTP ${resposta.status} (limite de requisições) após 3 tentativas`
    );
  }

  const json = await resposta.json();
  const horas = json.hourly || {};

  // O pico de UV interessa mais que a média: é o momento de maior risco de
  // exposição para quem está em trabalho externo.
  const uvMax = maximo(horas.uv_index);
  const pm25Medio = media(horas.pm2_5);
  const pm10Medio = media(horas.pm10);
  const poeiraMax = maximo(horas.dust);

  // Hora prevista do pico de UV, para orientar a janela crítica de exposição.
  let horaPicoUv = null;
  if (uvMax !== null && horas.uv_index) {
    const idx = horas.uv_index.indexOf(uvMax);
    if (idx >= 0 && horas.time?.[idx]) {
      horaPicoUv = new Date(horas.time[idx]).toLocaleTimeString("pt-BR", {
        hour: "2-digit",
        minute: "2-digit",
      });
    }
  }

  return {
    fonte: "Open-Meteo Air Quality",
    url,
    uvMax: arredondar(uvMax),
    uvClassificacao: classificarUv(uvMax),
    horaPicoUv,
    pm25Medio: arredondar(pm25Medio),
    pm25Classificacao: classificarPm25(pm25Medio),
    pm10Medio: arredondar(pm10Medio),
    poeiraMax: arredondar(poeiraMax),
  };
}

module.exports = { buscarQualidadeAr, classificarUv, classificarPm25 };
