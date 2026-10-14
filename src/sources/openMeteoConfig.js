const HOSTS_PUBLICOS = new Set([
  "api.open-meteo.com",
  "air-quality-api.open-meteo.com",
  "marine-api.open-meteo.com",
]);

function aplicarConfiguracaoOpenMeteo(urlOriginal, env = process.env) {
  const url = new URL(urlOriginal);
  const apiKey = String(env.OPEN_METEO_API_KEY || "").trim();
  const producao = String(env.NODE_ENV || "").toLowerCase() === "production";

  if (!HOSTS_PUBLICOS.has(url.hostname)) {
    throw new Error(`Host Open-Meteo não reconhecido: ${url.hostname}`);
  }

  if (producao && !apiKey) {
    const erro = new Error(
      "OPEN_METEO_API_KEY é obrigatória em produção: a API gratuita da Open-Meteo não autoriza uso comercial.",
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

module.exports = { aplicarConfiguracaoOpenMeteo, removerCredenciaisOpenMeteo };
