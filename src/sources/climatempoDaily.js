const fs = require("node:fs");
const path = require("node:path");
const { buscarJsonComRetentativa, API_TIMEOUT_MS, API_TENTATIVAS } = require("./httpJsonClient");

const FONTE_CLIMATEMPO = "Climatempo Advisor";
const FUSO_PADRAO = "America/Sao_Paulo";
const CACHE_PADRAO_MS = 20 * 60 * 1000;
const PASTA_EVIDENCIAS = path.join(__dirname, "..", "..", "data", "evidencias-climatempo");
const cache = new Map();

function textoNormalizado(valor) {
  return String(valor || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function dataLocalIso(instante, fuso = FUSO_PADRAO) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: fuso, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(instante));
}

function numeroValido(valor, minimo, maximo = Infinity) {
  if (valor === null || valor === undefined || valor === "") return null;
  const numero = typeof valor === "number" ? valor : Number(String(valor).replace(",", "."));
  return Number.isFinite(numero) && numero >= minimo && numero <= maximo ? numero : null;
}

function configuracao(cidade, env = process.env) {
  const token = String(env.CLIMATEMPO_API_TOKEN || "").trim();
  const nomeEnv = cidade?.climatempo?.localeIdEnv;
  const localeId = nomeEnv ? String(env[nomeEnv] || "").trim() : "";
  const pontoValidado = true;
  return {
    habilitada: Boolean(token && localeId && pontoValidado),
    token,
    localeId,
    nomeEnv,
    pontoValidado,
    baseUrl: String(env.CLIMATEMPO_API_BASE_URL || "https://apiadvisor.climatempo.com.br/api/v1").replace(/\/$/, ""),
    cacheMs: numeroValido(env.CLIMATEMPO_CACHE_MINUTOS, 1, 180) * 60_000 || CACHE_PADRAO_MS,
  };
}

function urlPrevisao(config) {
  const id = encodeURIComponent(config.localeId);
  const url = new URL(`${config.baseUrl}/forecast/locale/${id}/days/15`);
  url.searchParams.set("token", config.token);
  return url.toString();
}

function urlSemToken(valor) {
  const url = new URL(valor);
  if (url.searchParams.has("token")) url.searchParams.set("token", "[redacted]");
  return url.toString();
}

function validarLocalidade(cidade, json, localeId) {
  const idResposta = json?.id ?? json?.locale?.id ?? json?.locality?.id;
  if (idResposta !== undefined && String(idResposta) !== String(localeId)) {
    throw Object.assign(new Error(`${FONTE_CLIMATEMPO}: identificador da resposta não corresponde à base.`), { code: "CLIMATEMPO_LOCALE_MISMATCH" });
  }
  const nomeResposta = json?.name ?? json?.locale?.name ?? json?.locality?.name;
  const ufResposta = json?.state ?? json?.state_acronym ?? json?.locale?.state ?? json?.locality?.state;
  const nomeEsperado = cidade.climatempo?.municipio || cidade.nome.replace(/\s*\([^)]*\)\s*/g, "");
  if (nomeResposta && textoNormalizado(nomeResposta) !== textoNormalizado(nomeEsperado)) {
    throw Object.assign(new Error(`${FONTE_CLIMATEMPO}: localidade recebida (${nomeResposta}) não corresponde a ${nomeEsperado}.`), { code: "CLIMATEMPO_CITY_MISMATCH" });
  }
  if (ufResposta && textoNormalizado(ufResposta) !== textoNormalizado(cidade.uf)) {
    throw Object.assign(new Error(`${FONTE_CLIMATEMPO}: UF recebida não corresponde a ${cidade.uf}.`), { code: "CLIMATEMPO_STATE_MISMATCH" });
  }
  return { nome: nomeResposta || nomeEsperado, uf: ufResposta || cidade.uf, localeId: String(localeId) };
}

function normalizarDia(item) {
  const data = String(item?.date || item?.data || item?.day || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data) || Number.isNaN(Date.parse(`${data}T12:00:00Z`))) return null;
  const chuva = item?.rain || item?.climate?.rain || item?.precipitation || {};
  const chuvaMm = numeroValido(chuva.precipitation ?? chuva.accumulation ?? chuva.value ?? item?.precipitation, 0);
  const probabilidadeChuvaPct = numeroValido(chuva.probability ?? chuva.probability_percentage ?? item?.precipitation_probability, 0, 100);
  return {
    data,
    chuvaAcumuladaPrevistaMm: chuvaMm,
    probabilidadeChuvaPercentual: probabilidadeChuvaPct,
    chuvaMm,
    probabilidadeChuvaPct,
    fonte: FONTE_CLIMATEMPO,
    tipo: "previsao_diaria",
  };
}

function normalizarResposta(cidade, json, { localeId, consultadoEm, endpoint }) {
  const localidade = validarLocalidade(cidade, json, localeId);
  const itens = Array.isArray(json?.data) ? json.data : Array.isArray(json?.forecast) ? json.forecast : [];
  const porData = new Map();
  for (const item of itens) {
    const dia = normalizarDia(item);
    if (dia && !porData.has(dia.data)) porData.set(dia.data, dia);
  }
  if (!porData.size) throw Object.assign(new Error(`${FONTE_CLIMATEMPO}: resposta sem previsão diária reconhecível.`), { code: "CLIMATEMPO_INVALID_PAYLOAD" });
  return {
    status: "operacional",
    fonte: FONTE_CLIMATEMPO,
    localidade,
    coordenadasBase: { latitude: cidade.latitude, longitude: cidade.longitude },
    fuso: cidade.fusoHorario || FUSO_PADRAO,
    consultadoEm,
    endpoint,
    dias: [...porData.values()].sort((a, b) => a.data.localeCompare(b.data)),
    evidencia: null,
  };
}

function registrarEvidenciaTecnica(cidade, resultado, { pasta = PASTA_EVIDENCIAS } = {}) {
  const data = dataLocalIso(resultado.consultadoEm, cidade.fusoHorario || FUSO_PADRAO);
  const diretorio = path.join(pasta, data);
  fs.mkdirSync(diretorio, { recursive: true });
  const arquivo = path.join(diretorio, `${cidade.chave}.json`);
  const temporario = `${arquivo}.${process.pid}.tmp`;
  const evidencia = {
    tipo: "consulta_api_autorizada",
    cidade: cidade.nome,
    estado: cidade.uf,
    dataConsulta: data,
    consultadoEm: resultado.consultadoEm,
    fonte: resultado.fonte,
    localidade: resultado.localidade,
    coordenadasBase: resultado.coordenadasBase,
    endpoint: resultado.endpoint,
    dias: resultado.dias,
    observacao: "Evidência técnica da API; nenhuma página, sessão ou credencial foi armazenada.",
  };
  fs.writeFileSync(temporario, JSON.stringify(evidencia, null, 2), "utf8");
  fs.renameSync(temporario, arquivo);
  return arquivo;
}

async function obterChuvaDiariaClimatempo(cidade, {
  env = process.env,
  fetchImpl = fetch,
  agora = () => new Date(),
  esperarFn,
  logger,
  salvarEvidencia = fetchImpl === globalThis.fetch,
  pastaEvidencias,
} = {}) {
  const config = configuracao(cidade, env);
  if (!config.habilitada) {
    return {
      status: "nao_configurada", fonte: FONTE_CLIMATEMPO, dias: [], evidencia: null,
      motivo: !config.token
        ? "CLIMATEMPO_API_TOKEN não configurado."
        : !config.localeId
          ? `${config.nomeEnv} não configurado para a base.`
          : "Configuração da localidade incompleta.",
    };
  }
  const chaveCache = `${cidade.chave}|${config.localeId}`;
  const instante = agora();
  const armazenado = cache.get(chaveCache);
  if (armazenado && instante.getTime() - armazenado.obtidoEm < config.cacheMs) return armazenado.resultado;

  const url = urlPrevisao(config);
  const json = await buscarJsonComRetentativa(url, {
    nomeFonte: FONTE_CLIMATEMPO,
    fetchImpl,
    timeoutMs: API_TIMEOUT_MS,
    tentativas: API_TENTATIVAS,
    esperarFn,
    logger: logger === undefined && fetchImpl === globalThis.fetch ? console : logger,
    prefixoLog: "CLIMATEMPO-ADVISOR",
  });
  const resultado = normalizarResposta(cidade, json, {
    localeId: config.localeId,
    consultadoEm: instante.toISOString(),
    endpoint: urlSemToken(url),
  });
  if (salvarEvidencia && env.CLIMATEMPO_EVIDENCIA_API !== "false") {
    resultado.evidencia = registrarEvidenciaTecnica(cidade, resultado, { pasta: pastaEvidencias });
  }
  cache.set(chaveCache, { obtidoEm: instante.getTime(), resultado });
  return resultado;
}

function diaClimatempo(resultado, data) {
  return resultado?.status === "operacional"
    ? resultado.dias.find((dia) => dia.data === data) || null
    : null;
}

module.exports = {
  FONTE_CLIMATEMPO,
  PASTA_EVIDENCIAS,
  configuracao,
  normalizarDia,
  normalizarResposta,
  obterChuvaDiariaClimatempo,
  registrarEvidenciaTecnica,
  diaClimatempo,
  dataLocalIso,
  _cache: cache,
};
