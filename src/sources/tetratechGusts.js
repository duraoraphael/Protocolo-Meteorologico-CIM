const fs = require("node:fs");
const path = require("node:path");
const { buscarJsonComRetentativa, API_TENTATIVAS } = require("./httpJsonClient");

const API_BASE = "https://petrobras.ttforecast.com.br/api/v1";
const FONTE = "Tetra Tech/OCEANOP";
const CAMPO_RAJADA = "10_metre_wind_gust_since_previous_post_processing";
const METROS_POR_SEGUNDO_POR_NO = 0.514444444444;
const KMH_POR_NO = 1.852;
const TIMEOUT_MS = 15000;
const CACHE_TTL_MS = 10 * 60 * 1000;
const ARQUIVO_CACHE = path.join(__dirname, "..", "..", "data", "tetratech-gust-cache.json");

const cache = new Map();
const pendentes = new Map();
let tokenCache = null;

function lerCachePersistente() {
  try { return JSON.parse(fs.readFileSync(ARQUIVO_CACHE, "utf8")); }
  catch (erro) {
    if (erro.code === "ENOENT") return {};
    throw erro;
  }
}

function salvarCachePersistente(estado) {
  fs.mkdirSync(path.dirname(ARQUIVO_CACHE), { recursive: true });
  const temporario = `${ARQUIVO_CACHE}.${process.pid}.tmp`;
  fs.writeFileSync(temporario, JSON.stringify(estado, null, 2), "utf8");
  fs.renameSync(temporario, ARQUIVO_CACHE);
}

function erroConfiguracao(mensagem, code) {
  return Object.assign(new Error(mensagem), { name: "ConfigurationError", code, transitorio: false });
}

function numero(valor) {
  if (typeof valor === "string") {
    const limpo = valor.trim();
    if (!limpo || !/^-?\d+(?:[.,]\d+)?$/.test(limpo)) return null;
    valor = Number(limpo.replace(",", "."));
  }
  return Number.isFinite(valor) && valor >= 0 ? valor : null;
}

function converterParaKmH(valor, unidade) {
  const n = numero(valor);
  if (n === null) return null;
  const u = String(unidade || "").trim().toLowerCase();
  if (["kt", "kts", "knots", "nó", "nós"].includes(u)) return n * KMH_POR_NO;
  if (["km/h", "kmh"].includes(u)) return n;
  return null;
}

function arredondar(valor, casas = 2) {
  if (!Number.isFinite(valor)) return null;
  const fator = 10 ** casas;
  return Math.round((valor + Number.EPSILON) * fator) / fator;
}

function jwtExpiraEm(token) {
  try {
    const parte = String(token).split(".")[1];
    if (!parte) return null;
    const json = JSON.parse(Buffer.from(parte, "base64url").toString("utf8"));
    return Number.isFinite(json.exp) ? json.exp * 1000 : null;
  } catch { return null; }
}

function credencialDireta(env) {
  const apiKey = String(env.TETRATECH_API_KEY || "").trim();
  if (apiKey) return { "X-API-Key": apiKey };
  const accessToken = String(env.TETRATECH_ACCESS_TOKEN || "").trim();
  if (accessToken) return { Authorization: `Bearer ${accessToken}` };
  return null;
}

async function autenticar({ env, fetchImpl, timeoutMs, tentativas, esperarFn, logger }) {
  const direta = credencialDireta(env);
  if (direta) return direta;
  const agora = Date.now();
  if (tokenCache?.token && (!tokenCache.expiraEm || tokenCache.expiraEm - agora > 60_000)) {
    return { Authorization: `Bearer ${tokenCache.token}` };
  }
  const username = String(env.TETRATECH_USERNAME || "").trim();
  const password = String(env.TETRATECH_PASSWORD || "");
  if (!username || !password) {
    throw erroConfiguracao(
      "Tetra Tech/OCEANOP: configure uma X-API-Key ou credencial OAuth oficialmente autorizada.",
      "TETRATECH_CREDENTIALS_MISSING"
    );
  }
  const form = new URLSearchParams({ username, password });
  const json = await buscarJsonComRetentativa(`${API_BASE}/login/oauth`, {
    nomeFonte: FONTE,
    fetchImpl,
    timeoutMs,
    tentativas,
    esperarFn,
    logger,
    prefixoLog: "TETRATECH-AUTH",
    requestInit: {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
      body: form,
      redirect: "error",
    },
  });
  const token = typeof json?.access_token === "string" ? json.access_token.trim() : "";
  if (!token) throw Object.assign(new Error("Tetra Tech/OCEANOP: autenticação sem access_token."), {
    name: "ParserError", code: "TETRATECH_INVALID_TOKEN_RESPONSE", transitorio: false,
  });
  tokenCache = { token, expiraEm: jwtExpiraEm(token) };
  return { Authorization: `Bearer ${token}` };
}

function partesLocais(instante, fusoHorario) {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: fusoHorario,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(instante).reduce((acc, parte) => {
    if (parte.type !== "literal") acc[parte.type] = parte.value;
    return acc;
  }, {});
  return {
    data: `${partes.year}-${partes.month}-${partes.day}`,
    horario: `${partes.hour}:${partes.minute}`,
  };
}

function instanteDoTimestamp(valor) {
  const n = Number(valor);
  if (!Number.isFinite(n)) return null;
  const ms = n < 10_000_000_000 ? n * 1000 : n;
  const data = new Date(ms);
  return Number.isFinite(data.getTime()) ? data : null;
}

function dataAtualizacao(payload) {
  const candidatos = [
    payload?.info?.updated_at,
    payload?.info?.created_at,
    payload?.info?.reference_time,
    payload?.info?.forecast_reference_time,
  ];
  return candidatos.find((valor) => valor && Number.isFinite(Date.parse(valor))) || null;
}

function calcularPicosDiarios(payload, { cidade, areaName, fusoHorario, consultadoEm }) {
  const timestamps = payload?.timestamps;
  const rajadasMs = payload?.[CAMPO_RAJADA];
  if (!Array.isArray(timestamps) || !Array.isArray(rajadasMs) || timestamps.length !== rajadasMs.length) {
    throw Object.assign(new Error("Tetra Tech/OCEANOP: séries de horário e rajada ausentes ou incompatíveis."), {
      name: "ParserError", code: "TETRATECH_INVALID_GUST_SERIES", transitorio: false,
    });
  }
  const porDia = new Map();
  for (let indice = 0; indice < timestamps.length; indice++) {
    const instante = instanteDoTimestamp(timestamps[indice]);
    const valorBrutoMs = numero(rajadasMs[indice]);
    if (!instante || valorBrutoMs === null) continue;
    // O endpoint entrega a série base em m/s. O próprio gráfico converte essa
    // série para nós e declara a unidade "nós"; reproduzimos esse contrato.
    const rajadaNos = valorBrutoMs / METROS_POR_SEGUNDO_POR_NO;
    const rajadaKmH = converterParaKmH(rajadaNos, "kt");
    const local = partesLocais(instante, fusoHorario);
    const registro = {
      instante,
      data: local.data,
      horario: local.horario,
      rajadaNos,
      rajadaKmH,
      valorBrutoMs,
      indice,
    };
    const atual = porDia.get(local.data);
    if (!atual || registro.rajadaKmH > atual.rajadaKmH ||
        (registro.rajadaKmH === atual.rajadaKmH && registro.instante < atual.instante)) {
      porDia.set(local.data, registro);
    }
  }
  if (!porDia.size) throw Object.assign(new Error("Tetra Tech/OCEANOP: nenhum valor válido de rajada."), {
    name: "ParserError", code: "TETRATECH_NO_VALID_GUSTS", transitorio: false,
  });
  const atualizadoEm = dataAtualizacao(payload);
  return [...porDia.values()].sort((a, b) => a.data.localeCompare(b.data)).map((pico) => ({
    cidade,
    fonte: FONTE,
    area: areaName,
    data: pico.data,
    // Limita a precisão operacional: evita expor a cauda binária produzida
    // pela conversão de nós para km/h em site, e-mail, PDF e alertas.
    rajadaPrevistaKmH: arredondar(pico.rajadaKmH, 2),
    rajadaOriginal: arredondar(pico.rajadaNos, 2),
    unidadeOriginal: "kt",
    horarioPico: pico.horario,
    picoEm: pico.instante.toISOString(),
    tipo: "pico_diario",
    consultadoEm,
    atualizadoEm,
    registroOrigem: {
      campo: CAMPO_RAJADA,
      indice: pico.indice,
      timestamp: pico.instante.toISOString(),
      valorBruto: pico.valorBrutoMs,
      unidadeBruta: "m/s",
    },
  }));
}

function validarAreaConfig(area) {
  if (!area?.habilitado || area.fonte !== "tetratech") {
    throw erroConfiguracao(area?.motivo || "Tetra Tech/OCEANOP: área não habilitada.", "TETRATECH_AREA_DISABLED");
  }
  if (!area.areaName || !area.tipo || !area.fusoHorario) {
    throw erroConfiguracao("Tetra Tech/OCEANOP: cadastro de área incompleto.", "TETRATECH_AREA_INVALID");
  }
}

function resultadoPersistidoValido(armazenado, area, instanteConsulta) {
  if (!armazenado || armazenado?.area?.nome !== area.areaName || armazenado?.area?.tipo !== area.tipo) return null;
  const hoje = partesLocais(instanteConsulta, area.fusoHorario).data;
  const picosDiarios = (Array.isArray(armazenado.picosDiarios) ? armazenado.picosDiarios : [])
    .filter((pico) => /^\d{4}-\d{2}-\d{2}$/.test(pico?.data || "") &&
      pico.data >= hoje && Number.isFinite(pico?.rajadaPrevistaKmH))
    .map((pico) => ({
      ...pico,
      rajadaPrevistaKmH: arredondar(pico.rajadaPrevistaKmH, 2),
      rajadaOriginal: arredondar(pico.rajadaOriginal, 2),
    }));
  if (!picosDiarios.length || !armazenado.consultadoEm || !Number.isFinite(Date.parse(armazenado.consultadoEm))) return null;
  return { ...armazenado, picosDiarios };
}

async function buscarRajadasTetraTech(cidade, area, {
  env = process.env,
  fetchImpl = fetch,
  timeoutMs = TIMEOUT_MS,
  tentativas = API_TENTATIVAS,
  esperarFn,
  logger = fetchImpl === globalThis.fetch ? console : null,
  agora = () => new Date(),
  usarCache = true,
  cacheTtlMs = CACHE_TTL_MS,
  usarCachePersistente = true,
  carregarCachePersistente = lerCachePersistente,
  gravarCachePersistente = salvarCachePersistente,
} = {}) {
  validarAreaConfig(area);
  const chave = `${area.tipo}:${area.areaName}`;
  const instanteConsulta = agora();
  const armazenado = cache.get(chave);
  if (usarCache && armazenado && instanteConsulta.getTime() - Date.parse(armazenado.consultadoEm) < cacheTtlMs) {
    return { ...armazenado, cache: true };
  }
  if (usarCache && pendentes.has(chave)) return pendentes.get(chave);
  const tarefa = (async () => {
    try {
      const autenticacao = await autenticar({ env, fetchImpl, timeoutMs, tentativas, esperarFn, logger });
      const requestInit = { method: "GET", headers: { Accept: "application/json", ...autenticacao }, redirect: "error" };
      const areas = await buscarJsonComRetentativa(`${API_BASE}/areas/json`, {
        nomeFonte: FONTE, fetchImpl, timeoutMs, tentativas, esperarFn, logger,
        prefixoLog: "TETRATECH-AREAS", requestInit,
      });
      if (!Array.isArray(areas)) throw Object.assign(new Error("Tetra Tech/OCEANOP: lista de áreas inválida."), {
        name: "ParserError", code: "TETRATECH_INVALID_AREAS", transitorio: false,
      });
      const correspondencias = areas.filter((item) => item?.name === area.areaName && item?.type === area.tipo);
      if (correspondencias.length !== 1 || !/^[0-9a-f-]{36}$/i.test(String(correspondencias[0]?.id || ""))) {
        throw Object.assign(new Error(`Tetra Tech/OCEANOP: área ${area.tipo}/${area.areaName} não encontrada de forma inequívoca.`), {
          name: "ParserError", code: "TETRATECH_AREA_NOT_FOUND", transitorio: false,
        });
      }
      const areaApi = correspondencias[0];
      const payload = await buscarJsonComRetentativa(`${API_BASE}/bulletins/${encodeURIComponent(areaApi.id)}`, {
        nomeFonte: FONTE, fetchImpl, timeoutMs, tentativas, esperarFn, logger,
        prefixoLog: "TETRATECH-BULLETIN", requestInit,
      });
      const consultadoEm = instanteConsulta.toISOString();
      const resultado = {
        fonte: FONTE,
        cidade,
        area: { id: areaApi.id, nome: areaApi.name, tipo: areaApi.type },
        pagina: area.pagina,
        fusoHorario: area.fusoHorario,
        consultadoEm,
        picosDiarios: calcularPicosDiarios(payload, {
          cidade, areaName: areaApi.name, fusoHorario: area.fusoHorario, consultadoEm,
        }),
        cache: false,
        desatualizado: false,
      };
      if (usarCache) cache.set(chave, resultado);
      if (usarCachePersistente) {
        try {
          const estado = carregarCachePersistente();
          estado[chave] = resultado;
          gravarCachePersistente(estado);
        } catch (erroCache) {
          logger?.warn?.(`[TETRATECH-CACHE] Não foi possível armazenar o boletim: ${erroCache.message}`);
        }
      }
      return resultado;
    } catch (erro) {
      if (usarCachePersistente) {
        try {
          const armazenado = resultadoPersistidoValido(carregarCachePersistente()[chave], area, instanteConsulta);
          if (armazenado) return {
            ...armazenado,
            cache: true,
            desatualizado: true,
            erroAtual: erro,
          };
        } catch (erroCache) {
          logger?.warn?.(`[TETRATECH-CACHE] Não foi possível ler o boletim armazenado: ${erroCache.message}`);
        }
      }
      throw erro;
    }
  })();
  if (usarCache) pendentes.set(chave, tarefa);
  try { return await tarefa; }
  finally { if (pendentes.get(chave) === tarefa) pendentes.delete(chave); }
}

function limparCacheTetraTech() {
  cache.clear();
  pendentes.clear();
  tokenCache = null;
}

module.exports = {
  API_BASE,
  FONTE,
  CAMPO_RAJADA,
  METROS_POR_SEGUNDO_POR_NO,
  KMH_POR_NO,
  TIMEOUT_MS,
  CACHE_TTL_MS,
  ARQUIVO_CACHE,
  numero,
  arredondar,
  converterParaKmH,
  calcularPicosDiarios,
  lerCachePersistente,
  salvarCachePersistente,
  resultadoPersistidoValido,
  buscarRajadasTetraTech,
  limparCacheTetraTech,
};
