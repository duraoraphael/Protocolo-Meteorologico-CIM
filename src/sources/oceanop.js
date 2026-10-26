// API oficial Petrobras OCEANOP — previsão por coordenadas, usada para rajada.
// Fuso e unidade de velocidade não são inferidos pela resposta: vêm do cadastro
// em src/config/oceanopPontos.js (unidade ajustável por OCEANOP_UNIDADE_VENTO).

const { buscarJsonComRetentativa, API_TENTATIVAS } = require("./httpJsonClient");
const { partesNoFuso, instanteNoFuso, adicionarDias } = require("../logic/informativoValidity");
const { converterVelocidadeParaKmh, unidadeVelocidadeSuportada } = require("../logic/windUnits");

const ENDPOINT_PONTOS = "https://oceanop-api-disp.petrobras.com.br/api/v1/previsao/JsonPrevisaoPorListaDePontosLatLonAsync";
const ENDPOINT_AREA = "https://oceanop-api-disp.petrobras.com.br/api/v1/previsao/JsonPrevisaoAreaAsync";
const FONTE = "Petrobras — OCEANOP";
const OCEANOP_TIMEOUT_MS = 15000;
const OCEANOP_TENTATIVAS = API_TENTATIVAS;
const CACHE_TTL_MS = 5 * 60 * 1000;

const CAMPOS_NUMERICOS = Object.freeze({
  DirecaoVento: [0, 360],
  VelocidadeVento: [0, 1000],
  VelocidadeVento_10M_Rajada: [0, 1000],
  VelocidadeVento_50M_Rajada: [0, 1000],
  Precipitacao: [0, 1e6],
});

const cache = new Map();
const pendentes = new Map();
const diagnostico = { ultimaConsulta: null, ultimaConsultaBemSucedida: null, origemDados: null, errosRecentes: [] };

function direcaoCardinal(graus) {
  if (!Number.isFinite(graus)) return "—";
  const pontos = ["N", "NNE", "NE", "ENE", "L", "ESE", "SE", "SSE", "S", "SSO", "SO", "OSO", "O", "ONO", "NO", "NNO"];
  return pontos[Math.round((((graus % 360) + 360) % 360) / 22.5) % 16];
}

function texto(valor, limite = 500) { return typeof valor === "string" ? valor.trim().slice(0, limite) : ""; }
function numero(valor) {
  if (typeof valor === "number") return Number.isFinite(valor) ? valor : null;
  if (typeof valor !== "string" || !/^[+-]?\d+(?:[.,]\d+)?$/.test(valor.trim())) return null;
  const convertido = Number(valor.trim().replace(",", "."));
  return Number.isFinite(convertido) ? convertido : null;
}
function numeroNoIntervalo(valor, campo) {
  const convertido = numero(valor);
  if (convertido === null) return null;
  const limite = CAMPOS_NUMERICOS[campo];
  return !limite || (convertido >= limite[0] && convertido <= limite[1]) ? convertido : null;
}
function erroConfiguracao(mensagem, code = "OCEANOP_INVALID_CONFIGURATION") {
  return Object.assign(new Error(mensagem), { code, tipo: "configuration", transitorio: false, status: 400 });
}
function erroParser(mensagem, code) {
  return Object.assign(new Error(mensagem), { name: "ParserError", code, tipo: "parser", transitorio: false });
}

function normalizarIdentificador(valor) {
  return texto(valor, 200)
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/[^a-z0-9]+/g, " ").trim();
}

function validarPonto(ponto) {
  const id = texto(ponto?.id, 100);
  const latitude = numero(ponto?.latitude);
  const longitude = numero(ponto?.longitude);
  if (!id || /[\x00-\x1f\x7f]/.test(id) || latitude === null || latitude < -90 || latitude > 90
    || longitude === null || longitude < -180 || longitude > 180) {
    throw erroConfiguracao("OCEANOP: ponto por coordenadas inválido.", "OCEANOP_INVALID_POINT");
  }
  return { id, latitude, longitude };
}

function partesDataFonte(valor) {
  const data = texto(valor, 40);
  let m = data.match(/^(\d{2})\/(\d{2})\/(\d{4})[ T](\d{2}):(\d{2}):(\d{2})$/);
  if (m) return { year: +m[3], month: +m[2], day: +m[1], hour: +m[4], minute: +m[5], second: +m[6] };
  m = data.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
  return m ? { year: +m[1], month: +m[2], day: +m[3], hour: +m[4], minute: +m[5], second: +(m[6] || 0) } : null;
}
function partesValidas(p) {
  if (!p) return false;
  const d = new Date(Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second));
  return d.getUTCFullYear() === p.year && d.getUTCMonth() === p.month - 1 && d.getUTCDate() === p.day
    && d.getUTCHours() === p.hour && d.getUTCMinutes() === p.minute && d.getUTCSeconds() === p.second;
}
function instanteDaFonte(valor, fuso) {
  const partes = partesDataFonte(valor);
  if (!partesValidas(partes) || !texto(fuso, 100)) return null;
  try { return instanteNoFuso(partes, fuso).toISOString(); } catch { return null; }
}

function normalizarResposta(json, { fusoHorario = null } = {}) {
  if (!json || json.success !== true || !Array.isArray(json.data) || json.data.length > 10000) {
    throw erroParser("OCEANOP retornou uma resposta fora do formato esperado.", "OCEANOP_INVALID_PAYLOAD");
  }
  return json.data.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw erroParser("OCEANOP retornou um registro inválido.", "OCEANOP_INVALID_RECORD");
    const valores = {};
    for (const campo of Object.keys(CAMPOS_NUMERICOS)) valores[campo] = numeroNoIntervalo(item[campo], campo);
    const inicio = texto(item.DataInicial, 40), fim = texto(item.DataFinal, 40), escritoEm = texto(item.DataEscrita, 40);
    return {
      pointId: texto(item.PointID, 100), local: texto(item.Local, 200),
      inicio, fim, escritoEm,
      inicioEm: instanteDaFonte(inicio, fusoHorario), fimEm: instanteDaFonte(fim, fusoHorario),
      fuso: fusoHorario || null, valores,
    };
  }).sort((a, b) => (a.inicioEm || "9").localeCompare(b.inicioEm || "9"));
}

// O retorno só é aceito se pertencer ao ponto solicitado. O PointID é o
// identificador contratual; `Local` é apenas o nome do campo/plataforma.
function validarPontoRetornado(previsoes, id) {
  const esperado = normalizarIdentificador(id);
  if (!previsoes.length) {
    throw erroParser("OCEANOP não possui previsão cadastrada para estas coordenadas.", "OCEANOP_NO_COVERAGE");
  }
  if (previsoes.some((p) => normalizarIdentificador(p.pointId) !== esperado)) {
    throw erroParser("OCEANOP retornou dados de outro ponto; a resposta foi descartada.", "OCEANOP_POINT_MISMATCH");
  }
}

// Prioridade: Bearer > X-API-Key > usuário/senha (HTTP Basic). O Basic só é
// enviado se a chave e o token não existirem; as credenciais nunca vão a logs.
function cabecalhosAutorizacao(env = process.env) {
  const apiKey = String(env.OCEANOP_API_KEY || "").trim();
  const accessToken = String(env.OCEANOP_ACCESS_TOKEN || "").trim();
  const usuario = String(env.OCEANOP_USUARIO || "").trim();
  const senha = String(env.OCEANOP_SENHA || "");
  const basic = !apiKey && !accessToken && usuario && senha
    ? { Authorization: `Basic ${Buffer.from(`${usuario}:${senha}`, "utf8").toString("base64")}` }
    : {};
  return {
    ...(apiKey ? { "X-API-Key": apiKey } : {}),
    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    ...basic,
  };
}

function registrarErro(erro, ocorridoEm) {
  diagnostico.origemDados = "indisponivel";
  diagnostico.errosRecentes.unshift({ ocorridoEm, tipo: erro?.tipo || "unknown", codigo: erro?.code || null, httpStatus: erro?.httpStatus ?? null });
  diagnostico.errosRecentes.splice(5);
}
function obterDiagnosticoOceanop() {
  const falhou = diagnostico.ultimaConsulta && (!diagnostico.ultimaConsultaBemSucedida || diagnostico.ultimaConsulta > diagnostico.ultimaConsultaBemSucedida);
  return { status: falhou || !diagnostico.ultimaConsultaBemSucedida ? "INDISPONIVEL" : "ATIVO", ...diagnostico, errosRecentes: diagnostico.errosRecentes.map((e) => ({ ...e })) };
}

// Cache de 5 min e deduplicação de chamadas simultâneas, comuns aos dois modos.
async function consultarComCache(chave, { agora, cacheTtlMs, usarCache }, requisitar) {
  const instante = agora();
  const armazenado = cache.get(chave);
  if (usarCache && armazenado && instante.getTime() - Date.parse(armazenado.consultadoEm) < cacheTtlMs) {
    return { ...armazenado, cache: true };
  }
  if (usarCache && pendentes.has(chave)) return pendentes.get(chave);
  diagnostico.ultimaConsulta = instante.toISOString();
  const tarefa = (async () => {
    const resultado = { fonte: FONTE, consultadoEm: instante.toISOString(), cache: false, ...(await requisitar()) };
    if (usarCache) cache.set(chave, resultado);
    Object.assign(diagnostico, { ultimaConsultaBemSucedida: resultado.consultadoEm, origemDados: "consulta_oceanop" });
    return resultado;
  })();
  if (usarCache) pendentes.set(chave, tarefa);
  try { return await tarefa; } catch (erro) { registrarErro(erro, agora().toISOString()); throw erro; }
  finally { if (pendentes.get(chave) === tarefa) pendentes.delete(chave); }
}

function opcoesHttp(ponto, { fetchImpl, timeoutMs, tentativas, esperarFn, logger }) {
  return {
    nomeFonte: FONTE, fetchImpl, timeoutMs, tentativas, atrasoBaseMs: 1000, esperarFn,
    logger: logger === undefined && fetchImpl === globalThis.fetch ? console : logger,
    prefixoLog: "OCEANOP",
  };
}

// As datas da resposta não trazem fuso. `fusoDados` (padrão UTC) interpreta o
// texto da fonte; `fusoHorario` é o fuso local da base, usado nas janelas.
function fusoDosDados(ponto) { return ponto.fusoDados || ponto.fusoHorario || null; }

const PADRAO_HTTP = { fetchImpl: fetch, timeoutMs: OCEANOP_TIMEOUT_MS, tentativas: OCEANOP_TENTATIVAS, headers: {}, env: process.env, agora: () => new Date(), cacheTtlMs: CACHE_TTL_MS, usarCache: true };

// Modo "coordenadas": POST com ID/Lat/Lon. A API só responde para coordenadas
// exatamente cadastradas; ponto desconhecido volta com `data` vazio.
async function buscarOceanopPorCoordenadas(ponto, opcoes = {}) {
  const o = { ...PADRAO_HTTP, ...opcoes };
  const consulta = validarPonto(ponto);
  const chave = `ponto:${normalizarIdentificador(consulta.id)}:${consulta.latitude}:${consulta.longitude}`;
  return consultarComCache(chave, o, async () => {
    const json = await buscarJsonComRetentativa(ENDPOINT_PONTOS, {
      ...opcoesHttp(ponto, o),
      requestInit: {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json", ...cabecalhosAutorizacao(o.env), ...o.headers },
        body: JSON.stringify([{ ID: consulta.id, Lat: consulta.latitude, Lon: consulta.longitude }]),
        redirect: "error",
      },
    });
    const previsoes = normalizarResposta(json, { fusoHorario: fusoDosDados(ponto) });
    validarPontoRetornado(previsoes, consulta.id);
    return { endpoint: ENDPOINT_PONTOS, modo: "coordenadas", consulta, previsoes };
  });
}

// Modo "area": GET por nome de área, para bases sem coordenada cadastrada. A
// resposta não tem PointID e pode trazer vários locais; só os de
// `locaisAceitos` (ex.: "Macaé", "Macaé (SBME)") são usados.
async function buscarOceanopPorArea(ponto, opcoes = {}) {
  const o = { ...PADRAO_HTTP, ...opcoes };
  const local = texto(ponto?.localArea, 100);
  if (!local || !Array.isArray(ponto?.locaisAceitos) || !ponto.locaisAceitos.length) {
    throw erroConfiguracao("OCEANOP: área sem nome ou locais aceitos.", "OCEANOP_INVALID_AREA");
  }
  return consultarComCache(`area:${normalizarIdentificador(local)}`, o, async () => {
    const url = new URL(ENDPOINT_AREA);
    url.searchParams.set("local", local);
    const json = await buscarJsonComRetentativa(url, {
      ...opcoesHttp(ponto, o),
      requestInit: { method: "GET", headers: { Accept: "application/json", ...cabecalhosAutorizacao(o.env), ...o.headers }, redirect: "error" },
    });
    const aceitos = new Set(ponto.locaisAceitos.map(normalizarIdentificador));
    const previsoes = normalizarResposta(json, { fusoHorario: fusoDosDados(ponto) }).filter((p) => aceitos.has(normalizarIdentificador(p.local)));
    if (!previsoes.length) throw erroParser("OCEANOP não retornou o local esperado para esta área; a resposta foi descartada.", "OCEANOP_NO_COVERAGE");
    return { endpoint: ENDPOINT_AREA, modo: "area", consulta: { local }, previsoes };
  });
}

// Ponto único de entrada: cada base declara seu `modo` em oceanopPontos.js.
function buscarOceanopDaBase(ponto, opcoes = {}) {
  if (ponto?.habilitado !== true) {
    return Promise.reject(erroConfiguracao(ponto?.motivo || "OCEANOP: base sem ponto cadastrado.", "OCEANOP_NOT_CONFIGURED"));
  }
  return ponto.modo === "area" ? buscarOceanopPorArea(ponto, opcoes) : buscarOceanopPorCoordenadas(ponto, opcoes);
}

function exigirMetadadosVento(area) {
  const u = area?.unidades || {};
  if (!area?.fusoHorario || area?.usarVento !== true || !unidadeVelocidadeSuportada(u.VelocidadeVento)
    || !unidadeVelocidadeSuportada(u.VelocidadeVento_10M_Rajada) || u.DirecaoVento !== "graus") {
    throw erroConfiguracao("OCEANOP: fuso e unidades do vento não configurados para este ponto.", "OCEANOP_WIND_METADATA_UNCONFIRMED");
  }
}
function limitesJanela(area, agora, inicioHora, fimHora) {
  const dia = partesNoFuso(agora, area.fusoHorario);
  const inicio = instanteNoFuso({ ...dia, hour: inicioHora, minute: 0, second: 0 }, area.fusoHorario);
  const diaFim = fimHora === 24 ? adicionarDias(dia, 1) : dia;
  return { inicio, fim: instanteNoFuso({ ...diaFim, hour: fimHora === 24 ? 0 : fimHora, minute: 0, second: 0 }, area.fusoHorario) };
}
function registrosNaJanela(resultado, area, { agora = new Date(), inicioHora = 5, fimHora = 24, exigirFuturo = true } = {}) {
  const agoraData = new Date(agora), { inicio, fim } = limitesJanela(area, agoraData, inicioHora, fimHora);
  return (resultado?.previsoes || []).filter((p) => {
    if (!p.inicioEm || !p.fimEm) return false;
    const pi = new Date(p.inicioEm), pf = new Date(p.fimEm);
    return (!exigirFuturo || pf > agoraData) && pf > inicio && pi < fim;
  });
}
function periodoDaHora(hora) { return hora >= 5 && hora < 12 ? "manha" : hora >= 12 && hora < 18 ? "tarde" : hora >= 18 && hora < 24 ? "noite" : null; }
function arredondar(valor, casas = 1) { if (!Number.isFinite(valor)) return null; const f = 10 ** casas; return Math.round(valor * f) / f; }
function media(valores) { const v = valores.filter(Number.isFinite); return v.length ? v.reduce((s, n) => s + n, 0) / v.length : null; }
function mediaDirecao(valores) {
  const v = valores.filter(Number.isFinite);
  if (!v.length) return null;
  const x = v.reduce((s, g) => s + Math.cos(g * Math.PI / 180), 0);
  const y = v.reduce((s, g) => s + Math.sin(g * Math.PI / 180), 0);
  if (Math.abs(x) < 1e-12 && Math.abs(y) < 1e-12) return null;
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

// Horários exibidos/registrados no fuso local da base, no mesmo formato da
// Open-Meteo (sem sufixo Z); o texto original da fonte pode estar em outro fuso.
const dois = (n) => String(n).padStart(2, "0");
function localNaivo(instante, fuso) { const p = partesNoFuso(instante, fuso); return `${p.year}-${dois(p.month)}-${dois(p.day)}T${dois(p.hour)}:${dois(p.minute)}`; }
function periodoLocal(item, fuso) {
  if (!item?.inicioEm || !item?.fimEm) return null;
  const i = partesNoFuso(item.inicioEm, fuso), f = partesNoFuso(new Date(new Date(item.fimEm).getTime() - 1000), fuso);
  return `${dois(i.day)}/${dois(i.month)}/${i.year} ${dois(i.hour)}:${dois(i.minute)}–${dois(f.hour)}:${dois(f.minute)}`;
}

function resumoVento(itens, area) {
  if (!itens.length) return null;
  const u = area.unidades;
  const pico = itens
    .map((item) => ({ item, valor: converterVelocidadeParaKmh(item.valores.VelocidadeVento_10M_Rajada, u.VelocidadeVento_10M_Rajada) }))
    .filter((x) => Number.isFinite(x.valor))
    .reduce((m, x) => !m || x.valor > m.valor ? x : m, null);
  const direcaoGraus = mediaDirecao(itens.map((i) => i.valores.DirecaoVento));
  return {
    velocidadeMediaKmh: arredondar(media(itens.map((i) => converterVelocidadeParaKmh(i.valores.VelocidadeVento, u.VelocidadeVento)))),
    rajadaMaxKmh: arredondar(pico?.valor),
    rajadaPrevistaEm: pico?.item.inicioEm ? localNaivo(pico.item.inicioEm, area.fusoHorario) : null,
    periodoReferencia: pico ? periodoLocal(pico.item, area.fusoHorario) : null,
    local: area.referencia || area.id,
    direcaoGraus: Number.isFinite(direcaoGraus) ? arredondar(direcaoGraus, 0) : null,
    direcao: Number.isFinite(direcaoGraus) ? direcaoCardinal(direcaoGraus) : null,
    fonte: FONTE,
  };
}

// Máxima de rajada por período do dia (manhã/tarde/noite) e no total da janela.
function mapearOceanopParaVento(resultado, area, opcoes = {}) {
  exigirMetadadosVento(area);
  const registros = registrosNaJanela(resultado, area, opcoes);
  if (!registros.length) throw Object.assign(new Error("OCEANOP: nenhum período válido para a janela do informativo."), { code: "OCEANOP_NO_CURRENT_DATA", tipo: "no_data", transitorio: false });
  const grupos = { manha: [], tarde: [], noite: [] };
  for (const r of registros) { const chave = periodoDaHora(partesNoFuso(r.inicioEm, area.fusoHorario).hour); if (chave) grupos[chave].push(r); }
  return { ...Object.fromEntries(Object.entries(grupos).map(([chave, itens]) => [chave, resumoVento(itens, area)])), resumo: resumoVento(registros, area) };
}

function dataLocalIso(instante, fuso) { const p = partesNoFuso(instante, fuso); return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`; }
function mapearOceanopParaProximosDias(resultado, area, { agora = new Date(), quantidade = 3 } = {}) {
  exigirMetadadosVento(area);
  const hoje = partesNoFuso(agora, area.fusoHorario);
  return Array.from({ length: quantidade }, (_, i) => adicionarDias(hoje, i + 1))
    .map((d) => `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`)
    .map((data) => {
      const itens = (resultado?.previsoes || []).filter((item) => item.inicioEm && dataLocalIso(item.inicioEm, area.fusoHorario) === data);
      return { data, ...resumoVento(itens, area) };
    })
    .filter((dia) => Number.isFinite(dia.rajadaMaxKmh));
}

function limparCacheOceanop() {
  cache.clear(); pendentes.clear();
  Object.assign(diagnostico, { ultimaConsulta: null, ultimaConsultaBemSucedida: null, origemDados: null, errosRecentes: [] });
}

module.exports = {
  ENDPOINT_PONTOS, ENDPOINT_AREA, FONTE, OCEANOP_TIMEOUT_MS, OCEANOP_TENTATIVAS, CACHE_TTL_MS,
  buscarOceanopDaBase, buscarOceanopPorArea, buscarOceanopPorCoordenadas, normalizarResposta, validarPonto, validarPontoRetornado, numero, numeroNoIntervalo,
  partesDataFonte, instanteDaFonte, mapearOceanopParaVento, mapearOceanopParaProximosDias,
  registrosNaJanela, limparCacheOceanop, obterDiagnosticoOceanop, cabecalhosAutorizacao,
};
