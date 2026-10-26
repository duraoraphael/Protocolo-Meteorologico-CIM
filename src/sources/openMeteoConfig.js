const HOSTS_PUBLICOS = new Set([
  "api.open-meteo.com",
  "air-quality-api.open-meteo.com",
  "marine-api.open-meteo.com",
]);

// Uso dos endpoints públicos (gratuitos) da Open-Meteo, sem chave. Desligado por
// padrão: os termos da Open-Meteo limitam a API gratuita a uso não comercial, então
// a liberação é uma decisão explícita (OPEN_METEO_USAR_API_PUBLICA=true).
function apiPublicaPermitida(env = process.env) {
  return String(env.OPEN_METEO_USAR_API_PUBLICA || "").trim().toLowerCase() === "true";
}

function aplicarConfiguracaoOpenMeteo(urlOriginal, env = process.env) {
  const url = new URL(urlOriginal);
  const apiKey = String(env.OPEN_METEO_API_KEY || "").trim();

  if (!HOSTS_PUBLICOS.has(url.hostname)) {
    throw new Error(`Host Open-Meteo não reconhecido: ${url.hostname}`);
  }

  if (!apiKey && apiPublicaPermitida(env)) return url.toString();

  if (!apiKey) {
    const erro = new Error(
      "OPEN_METEO_API_KEY ausente: este protocolo é usado comercialmente e não pode consultar a API gratuita da Open-Meteo (ou defina OPEN_METEO_USAR_API_PUBLICA=true).",
    );
    erro.code = "OPEN_METEO_COMMERCIAL_LICENSE_REQUIRED";
    throw erro;
  }

  if (apiKey) {
    url.hostname = `customer-${url.hostname}`;
    url.searchParams.set("apikey", apiKey);
  }

  return url.toString();
}

function removerCredenciaisOpenMeteo(urlOriginal) {
  const url = new URL(urlOriginal);
  url.searchParams.delete("apikey");
  url.username = "";
  url.password = "";
  return url.toString();
}

module.exports = { apiPublicaPermitida, aplicarConfiguracaoOpenMeteo, removerCredenciaisOpenMeteo };
