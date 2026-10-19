// API oficial Petrobras OCEANOP. A fonte aceita uma lista de pontos e devolve
// previsões por intervalo. Unidades e fuso não são inferidos: só entram no
// informativo quando o cadastro do ponto os declara como homologados.

const { buscarJsonComRetentativa, API_TENTATIVAS } = require("./httpJsonClient");
const { classificarEstadoMar, direcaoCardinal } = require("./marine");
const { partesNoFuso, instanteNoFuso } = require("../logic/informativoValidity");

const ENDPOINT = "https://oceanop-api-disp.petrobras.com.br/api/v1/previsao/JsonPrevisaoPorListaDePontosLatLonAsync";
const FONTE = "Petrobras — OCEANOP";
const OCEANOP_TIMEOUT_MS = 15000;
const OCEANOP_TENTATIVAS = API_TENTATIVAS;
const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_PONTOS = 50;

const CAMPOS = Object.freeze([
  ["Temperatura", "Temperatura"], ["Condicao_Clima", "Condição do clima"],
  ["DirecaoVento", "Direção do vento"], ["VelocidadeVento", "Vento"],
  ["VelocidadeVento_10M_Rajada", "Rajada a 10 m"], ["VelocidadeVento_50M_Rajada", "Rajada a 50 m"],
  ...[20, 30, 40, 50, 80, 100].map((altura) => [`VelocidadeVento_${altura}M`, `Vento a ${altura} m`]),
  ["Precipitacao", "Precipitação"], ["Visibilidade", "Visibilidade"],
  ["PressaoNivelMar", "Pressão ao nível do mar"],
  ["Cobertura_Nuvem_Baixa", "Cobertura de nuvens baixas"],
  ["Cobertura_Nuvem_Media", "Cobertura de nuvens médias"],
  ["Cobertura_Nuvem_Alta", "Cobertura de nuvens altas"],
  ["AlturaOnda", "Altura de onda"], ["AlturaMaximaOnda", "Altura máxima de onda"],
  ["DirecaoOnda", "Direção de onda"], ["PeriodoOnda", "Período de onda"],
  ["PeriodoPicoOnda", "Período de pico de onda"],
  ["Direcao_VentoOnda", "Direção de vento/onda"],
  ["Direcao_AlturaVentoOnda", "Direcao_AlturaVentoOnda (campo da fonte)"],
  ["Periodo_VentoOnda", "Período de vento/onda"],
  ["DirecaoOndulacao", "Direção da ondulação"], ["AlturaOndulacao", "Altura da ondulação"],
  ["PeriodoOndulacao", "Período da ondulação"],
  ["Latitude", "Latitude informada"], ["Longitude", "Longitude informada"],
  ["Confiabilidaae", "Confiabilidade"],
  ["IndiceProbabilidadeTrovao", "Índice de probabilidade de trovão"],
]);

const TEXTUAIS = new Set(["Confiabilidaae", "Condicao_Clima"]);
const LIMITES = Object.freeze({
  Temperatura: [-100, 100],
  DirecaoVento: [0, 360], DirecaoOnda: [0, 360], Direcao_VentoOnda: [0, 360],
  Direcao_AlturaVentoOnda: [0, 360], DirecaoOndulacao: [0, 360],
  VelocidadeVento: [0, 1000], VelocidadeVento_10M_Rajada: [0, 1000],
  VelocidadeVento_20M: [0, 1000], VelocidadeVento_30M: [0, 1000],
  VelocidadeVento_40M: [0, 1000], VelocidadeVento_50M: [0, 1000],
  VelocidadeVento_50M_Rajada: [0, 1000], VelocidadeVento_80M: [0, 1000],
  VelocidadeVento_100M: [0, 1000],
  AlturaOnda: [0, 100], AlturaMaximaOnda: [0, 100], AlturaOndulacao: [0, 100],
  PeriodoOnda: [0, 1000], PeriodoPicoOnda: [0, 1000], Periodo_VentoOnda: [0, 1000],
  PeriodoOndulacao: [0, 1000], Precipitacao: [0, 1e6], Visibilidade: [0, 1e9],
  PressaoNivelMar: [0, 2e6], Cobertura_Nuvem_Baixa: [0, 100],
  Cobertura_Nuvem_Media: [0, 100], Cobertura_Nuvem_Alta: [0, 100],
  IndiceProbabilidadeTrovao: [0, 100], Latitude: [-90, 90], Longitude: [-180, 180],
});

const CONDICOES_CLIMA = Object.freeze({ partly_cloudy: "Parcialmente nublado" });
const cache = new Map();
const pendentes = new Map();

function texto(valor, limite = 500) {
  return typeof valor === "string" ? valor.trim().slice(0, limite) : "";
}

function numero(valor) {
  if (typeof valor === "number") return Number.isFinite(valor) ? valor : null;
  if (typeof valor !== "string" || !/^[+-]?\d+(?:[.,]\d+)?$/.test(valor.trim())) return null;
  const convertido = Number(valor.trim().replace(",", "."));
  return Number.isFinite(convertido) ? convertido : null;
}

function numeroNoIntervalo(valor, campo) {
  const convertido = numero(valor);
  if (convertido === null) return null;
  const limite = LIMITES[campo];
  return !limite || (convertido >= limite[0] && convertido <= limite[1]) ? convertido : null;
}

function erroConfiguracao(mensagem, code = "OCEANOP_INVALID_CONFIGURATION") {
  const erro = new Error(mensagem);
  erro.code = code;
  erro.tipo = "configuration";
  erro.transitorio = false;
  erro.status = 400;
  return erro;
}

function validarPonto(ponto) {
  if (!ponto || typeof ponto !== "object" || Array.isArray(ponto)) {
    throw erroConfiguracao("OCEANOP: ponto ausente ou inválido.");
  }
  const ID = texto(ponto.ID ?? ponto.id ?? ponto.pointId, 100);
  const Lat = numero(ponto.Lat ?? ponto.latitude);
  const Lon = numero(ponto.Lon ?? ponto.longitude);
  if (!ID || /[\x00-\x1f\x7f]/.test(ID)) throw erroConfiguracao("OCEANOP: informe o ID autorizado do ponto.");
  if (Lat === null || Math.abs(Lat) > 90) throw erroConfiguracao(`OCEANOP: latitude inválida para o ponto ${ID}.`);
  if (Lon === null || Math.abs(Lon) > 180) throw erroConfiguracao(`OCEANOP: longitude inválida para o ponto ${ID}.`);
  return { ID, Lat, Lon };
}

function validarPontos(pontos) {
  if (!Array.isArray(pontos) || pontos.length === 0 || pontos.length > MAX_PONTOS) {
    throw erroConfiguracao(`OCEANOP: informe de 1 a ${MAX_PONTOS} pontos autorizados.`);
  }
  const normalizados = pontos.map(validarPonto);
  const ids = new Set();
  for (const ponto of normalizados) {
    if (ids.has(ponto.ID)) throw erroConfiguracao(`OCEANOP: PointID duplicado (${ponto.ID}).`);
    ids.add(ponto.ID);
  }
  return normalizados;
}

function partesDataFonte(valor) {
  const data = texto(valor, 40);
  let match = data.match(/^(\d{2})\/(\d{2})\/(\d{4})[ T](\d{2}):(\d{2}):(\d{2})$/);
  if (match) return { year: +match[3], month: +match[2], day: +match[1], hour: +match[4], minute: +match[5], second: +match[6] };
  match = data.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (match) return { year: +match[1], month: +match[2], day: +match[3], hour: +match[4], minute: +match[5], second: +(match[6] || 0) };
  return null;
}

function validarPartesData(partes) {
  if (!partes) return false;
  const data = new Date(Date.UTC(partes.year, partes.month - 1, partes.day, partes.hour, partes.minute, partes.second));
  return data.getUTCFullYear() === partes.year && data.getUTCMonth() === partes.month - 1 &&
    data.getUTCDate() === partes.day && data.getUTCHours() === partes.hour &&
    data.getUTCMinutes() === partes.minute && data.getUTCSeconds() === partes.second;
}

function instanteDaFonte(valor, fuso) {
  const partes = partesDataFonte(valor);
  if (!validarPartesData(partes) || !texto(fuso, 100)) return null;
  try { return instanteNoFuso(partes, fuso).toISOString(); }
  catch { return null; }
}

function chaveOrdenacaoData(valor) {
  const partes = partesDataFonte(valor);
  if (!validarPartesData(partes)) return "99999999999999";
  return [partes.year, partes.month, partes.day, partes.hour, partes.minute, partes.second]
    .map((parte, indice) => String(parte).padStart(indice === 0 ? 4 : 2, "0")).join("");
}

function normalizarResposta(json, { pontos = [], fusoPorPonto = {} } = {}) {
  if (!json || json.success !== true || !Array.isArray(json.data) || json.data.length > 10000) {
    const erro = new Error("OCEANOP retornou uma resposta fora do formato esperado.");
    erro.name = "ParserError";
    erro.code = "OCEANOP_INVALID_PAYLOAD";
    erro.transitorio = false;
    throw erro;
  }
  const idsEsperados = new Set(pontos.map((ponto) => ponto.ID));
  const previsoes = json.data.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      const erro = new Error("OCEANOP retornou um registro inválido.");
      erro.name = "ParserError";
      erro.code = "OCEANOP_INVALID_RECORD";
      erro.transitorio = false;
      throw erro;
    }
    const pointId = texto(item.PointID, 100);
    if (!pointId || (idsEsperados.size && !idsEsperados.has(pointId))) {
      const erro = new Error(`OCEANOP retornou PointID ausente ou não solicitado${pointId ? ` (${pointId})` : ""}.`);
      erro.name = "ParserError";
      erro.code = "OCEANOP_POINT_MISMATCH";
      erro.transitorio = false;
      throw erro;
    }
    const valores = {};
    const camposInvalidos = [];
    for (const [chave] of CAMPOS) {
      if (TEXTUAIS.has(chave)) valores[chave] = texto(item[chave]) || null;
      else {
        valores[chave] = numeroNoIntervalo(item[chave], chave);
        if (item[chave] !== undefined && item[chave] !== null && texto(String(item[chave])) && valores[chave] === null) {
          camposInvalidos.push(chave);
        }
      }
    }
    const inicio = texto(item.DataInicial, 40);
    const fim = texto(item.DataFinal, 40);
    const escritoEm = texto(item.DataEscrita, 40);
    const fuso = fusoPorPonto[pointId] || null;
    return {
      pointId,
      local: texto(item.Local, 200),
      inicio,
      fim,
      escritoEm,
      inicioEm: instanteDaFonte(inicio, fuso),
      fimEm: instanteDaFonte(fim, fuso),
      escritoEmIso: instanteDaFonte(escritoEm, fuso),
      fuso,
      condicaoClimaPt: CONDICOES_CLIMA[valores.Condicao_Clima] || null,
      camposInvalidos,
      valores,
    };
  });
  return previsoes.sort((a, b) => a.pointId.localeCompare(b.pointId) ||
    chaveOrdenacaoData(a.inicio).localeCompare(chaveOrdenacaoData(b.inicio)));
}

function cabecalhosOceanop(env = process.env, adicionais = {}) {
  const headers = { Accept: "application/json", "Content-Type": "application/json", ...adicionais };
  const autorizacao = texto(env.OCEANOP_AUTHORIZATION, 4096);
  if (autorizacao) headers.Authorization = autorizacao;
  return headers;
}

function chaveCache(pontos) {
  return JSON.stringify(pontos.map(({ ID, Lat, Lon }) => ({ ID, Lat, Lon })));
}

async function buscarOceanop(pontos, {
  fetchImpl = fetch, timeoutMs = OCEANOP_TIMEOUT_MS, tentativas = OCEANOP_TENTATIVAS,
  esperarFn, logger, headers = {}, env = process.env, agora = () => new Date(),
  cacheTtlMs = CACHE_TTL_MS, usarCache = true,
} = {}) {
  const payload = validarPontos(pontos);
  const chave = chaveCache(payload);
  const instante = agora();
  const armazenado = cache.get(chave);
  if (usarCache && armazenado && instante.getTime() - Date.parse(armazenado.consultadoEm) < cacheTtlMs) {
    return { ...armazenado, cache: true };
  }
  if (usarCache && pendentes.has(chave)) return pendentes.get(chave);
  const tarefa = (async () => {
    const json = await buscarJsonComRetentativa(ENDPOINT, {
      nomeFonte: FONTE, fetchImpl, timeoutMs, tentativas, atrasoBaseMs: 1000, esperarFn,
      logger: logger === undefined && fetchImpl === globalThis.fetch ? console : logger,
      prefixoLog: "OCEANOP",
      requestInit: {
        method: "POST", headers: cabecalhosOceanop(env, headers),
        body: JSON.stringify(payload), redirect: "error",
      },
    });
    const fusoPorPonto = Object.fromEntries(pontos.map((ponto, indice) => [payload[indice].ID, ponto.fusoHorario || ponto.timeZone || null]));
    const resultado = {
      fonte: FONTE, endpoint: ENDPOINT, consulta: { pontos: payload },
      consultadoEm: instante.toISOString(),
      campos: CAMPOS.map(([chaveCampo, rotulo]) => ({ chave: chaveCampo, rotulo })),
      previsoes: normalizarResposta(json, { pontos: payload, fusoPorPonto }), cache: false,
    };
    if (usarCache) cache.set(chave, resultado);
    return resultado;
  })();
  if (usarCache) pendentes.set(chave, tarefa);
  try { return await tarefa; }
  finally { if (pendentes.get(chave) === tarefa) pendentes.delete(chave); }
}

function exigirUnidadesMar(ponto) {
  const unidades = ponto?.unidades || {};
  const exigidas = {
    AlturaOnda: "m", AlturaMaximaOnda: "m", PeriodoOnda: "s",
    PeriodoPicoOnda: "s", DirecaoOnda: "graus", AlturaOndulacao: "m",
  };
  const divergentes = Object.entries(exigidas).filter(([campo, unidade]) => unidades[campo] !== unidade);
  if (!ponto?.fusoHorario || divergentes.length) {
    throw erroConfiguracao(
      `OCEANOP: fuso e unidades marítimas ainda não homologados para ${ponto?.ID || ponto?.pointId || "o ponto"}.`,
      "OCEANOP_UNITS_OR_TIMEZONE_UNCONFIRMED"
    );
  }
}

function periodoDaHora(hora) {
  if (hora >= 5 && hora < 12) return "manha";
  if (hora >= 12 && hora < 18) return "tarde";
  if (hora >= 18 && hora < 24) return "noite";
  return null;
}

function maximo(valores) {
  const validos = valores.filter(Number.isFinite);
  return validos.length ? Math.max(...validos) : null;
}

function media(valores) {
  const validos = valores.filter(Number.isFinite);
  return validos.length ? validos.reduce((soma, valor) => soma + valor, 0) / validos.length : null;
}

function arredondar(valor, casas = 1) {
  if (!Number.isFinite(valor)) return null;
  const fator = 10 ** casas;
  return Math.round(valor * fator) / fator;
}

function registrosVigentes(resultado, ponto, { agora = new Date(), inicioHora = 5, fimHora = 24 } = {}) {
  if (!ponto?.fusoHorario) throw erroConfiguracao("OCEANOP: fuso do ponto não homologado.", "OCEANOP_TIMEZONE_UNCONFIRMED");
  const agoraData = new Date(agora);
  const dia = partesNoFuso(agoraData, ponto.fusoHorario);
  const inicio = instanteNoFuso({ ...dia, hour: inicioHora, minute: 0, second: 0 }, ponto.fusoHorario);
  const proximoDia = new Date(Date.UTC(dia.year, dia.month - 1, dia.day + (fimHora === 24 ? 1 : 0)));
  const fim = instanteNoFuso({
    year: proximoDia.getUTCFullYear(), month: proximoDia.getUTCMonth() + 1, day: proximoDia.getUTCDate(),
    hour: fimHora === 24 ? 0 : fimHora, minute: 0, second: 0,
  }, ponto.fusoHorario);
  const id = validarPonto(ponto).ID;
  return (resultado?.previsoes || []).filter((previsao) => {
    if (previsao.pointId !== id || !previsao.inicioEm || !previsao.fimEm) return false;
    const inicioPrevisao = new Date(previsao.inicioEm);
    const fimPrevisao = new Date(previsao.fimEm);
    return fimPrevisao > agoraData && fimPrevisao > inicio && inicioPrevisao < fim;
  });
}

function mapearOceanopParaMar(resultado, ponto, opcoes = {}) {
  exigirUnidadesMar(ponto);
  const registros = registrosVigentes(resultado, ponto, opcoes);
  if (!registros.length) {
    const erro = new Error("OCEANOP: nenhum período vigente para o ponto e a janela do informativo.");
    erro.code = "OCEANOP_NO_CURRENT_DATA"; erro.tipo = "no_data"; erro.transitorio = false;
    throw erro;
  }
  const agrupados = { manha: [], tarde: [], noite: [] };
  for (const registro of registros) {
    const chave = periodoDaHora(partesNoFuso(registro.inicioEm, ponto.fusoHorario).hour);
    if (chave) agrupados[chave].push(registro);
  }
  const rotulos = { manha: "Manhã", tarde: "Tarde", noite: "Noite" };
  const periodos = Object.entries(agrupados).map(([chave, itens]) => {
    const valores = (campo) => itens.map((item) => item.valores[campo]);
    const alturaMaxM = arredondar(maximo(valores("AlturaMaximaOnda")));
    const direcaoGraus = media(valores("DirecaoOnda"));
    return {
      periodo: rotulos[chave], alturaOndaM: arredondar(media(valores("AlturaOnda"))), alturaMaxM,
      periodoOndaS: arredondar(media(valores("PeriodoOnda"))),
      periodoPicoOndaS: arredondar(media(valores("PeriodoPicoOnda"))),
      direcaoOnda: Number.isFinite(direcaoGraus) ? direcaoCardinal(direcaoGraus) : "—",
      marulhoMaxM: arredondar(maximo(valores("AlturaOndulacao"))),
      periodoOndulacaoS: arredondar(media(valores("PeriodoOndulacao"))),
      estadoMar: classificarEstadoMar(alturaMaxM),
    };
  });
  const alturaMaxDiaM = maximo(periodos.map((periodo) => periodo.alturaMaxM));
  if (!Number.isFinite(alturaMaxDiaM)) {
    const erro = new Error("OCEANOP: períodos vigentes sem AlturaMaximaOnda válida.");
    erro.code = "OCEANOP_MARINE_FIELDS_MISSING"; erro.tipo = "no_data"; erro.transitorio = false;
    throw erro;
  }
  return {
    fonte: FONTE, alturaMaxDiaM, estadoMarDia: classificarEstadoMar(alturaMaxDiaM),
    temperaturaMarC: null, periodos, referenciaPonto: ponto.referencia || validarPonto(ponto).ID,
    consultadoEm: resultado.consultadoEm, ultimaAtualizacao: resultado.consultadoEm,
    desatualizado: false, pontoOceanop: validarPonto(ponto).ID,
  };
}

function converterVelocidadeParaKmh(valor, unidade) {
  if (!Number.isFinite(valor)) return null;
  if (unidade === "km/h") return valor;
  if (unidade === "m/s") return valor * 3.6;
  if (unidade === "kt") return valor * 1.852;
  return null;
}

function mapearOceanopParaVento(resultado, ponto, opcoes = {}) {
  if (!ponto?.usarVento) return null;
  const unidades = ponto.unidades || {};
  if (!ponto.alturaVelocidadeVentoM || !["km/h", "m/s", "kt"].includes(unidades.VelocidadeVento) ||
      !["km/h", "m/s", "kt"].includes(unidades.VelocidadeVento_10M_Rajada) || unidades.DirecaoVento !== "graus") {
    throw erroConfiguracao("OCEANOP: unidade/altura do vento não homologada.", "OCEANOP_WIND_METADATA_UNCONFIRMED");
  }
  const registros = registrosVigentes(resultado, ponto, opcoes);
  const agrupados = { manha: [], tarde: [], noite: [] };
  for (const registro of registros) {
    const chave = periodoDaHora(partesNoFuso(registro.inicioEm, ponto.fusoHorario).hour);
    if (chave) agrupados[chave].push(registro);
  }
  return Object.fromEntries(Object.entries(agrupados).map(([chave, itens]) => {
    const velocidades = itens.map((item) => converterVelocidadeParaKmh(item.valores.VelocidadeVento, unidades.VelocidadeVento));
    const rajadas = itens.map((item) => converterVelocidadeParaKmh(item.valores.VelocidadeVento_10M_Rajada, unidades.VelocidadeVento_10M_Rajada));
    const direcao = media(itens.map((item) => item.valores.DirecaoVento));
    return [chave, {
      velocidadeMediaKmh: arredondar(media(velocidades)), rajadaMaxKmh: arredondar(maximo(rajadas)),
      direcao: Number.isFinite(direcao) ? direcaoCardinal(direcao) : null,
      fonte: FONTE, alturaVelocidadeVentoM: ponto.alturaVelocidadeVentoM,
    }];
  }));
}

function limparCacheOceanop() {
  cache.clear();
  pendentes.clear();
}

module.exports = {
  ENDPOINT, FONTE, CAMPOS, CONDICOES_CLIMA, OCEANOP_TIMEOUT_MS, OCEANOP_TENTATIVAS,
  CACHE_TTL_MS, buscarOceanop, normalizarResposta, validarPonto, validarPontos,
  numero, numeroNoIntervalo, partesDataFonte, instanteDaFonte, mapearOceanopParaMar,
  mapearOceanopParaVento, converterVelocidadeParaKmh, registrosVigentes, limparCacheOceanop,
};
