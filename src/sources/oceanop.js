// API oficial Petrobras OCEANOP por área. O endpoint recebe exclusivamente o
// identificador `local`; coordenadas das bases CIM nunca são enviadas.
// Unidades e fuso não são inferidos: exigem cadastro homologado.

const { buscarJsonComRetentativa, API_TENTATIVAS } = require("./httpJsonClient");
const { classificarEstadoMar, direcaoCardinal } = require("./marine");
const { partesNoFuso, instanteNoFuso, adicionarDias } = require("../logic/informativoValidity");

const ENDPOINT = "https://oceanop-api-disp.petrobras.com.br/api/v1/previsao/JsonPrevisaoAreaAsync";
const FONTE = "Petrobras — OCEANOP";
const OCEANOP_TIMEOUT_MS = 15000;
const OCEANOP_TENTATIVAS = API_TENTATIVAS;
const CACHE_TTL_MS = 5 * 60 * 1000;

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
  ["PeriodoOndulacao", "Período da ondulação"], ["Latitude", "Latitude informada"],
  ["Longitude", "Longitude informada"], ["Confiabilidaae", "Confiabilidade"],
  ["IndiceProbabilidadeTrovao", "Índice de probabilidade de trovão"],
]);

const TEXTUAIS = new Set(["Confiabilidaae", "Condicao_Clima"]);
const LIMITES = Object.freeze({
  Temperatura: [-100, 100], DirecaoVento: [0, 360], DirecaoOnda: [0, 360],
  Direcao_VentoOnda: [0, 360], Direcao_AlturaVentoOnda: [0, 360], DirecaoOndulacao: [0, 360],
  VelocidadeVento: [0, 1000], VelocidadeVento_10M_Rajada: [0, 1000],
  VelocidadeVento_20M: [0, 1000], VelocidadeVento_30M: [0, 1000],
  VelocidadeVento_40M: [0, 1000], VelocidadeVento_50M: [0, 1000],
  VelocidadeVento_50M_Rajada: [0, 1000], VelocidadeVento_80M: [0, 1000],
  VelocidadeVento_100M: [0, 1000], AlturaOnda: [0, 100], AlturaMaximaOnda: [0, 100],
  AlturaOndulacao: [0, 100], PeriodoOnda: [0, 1000], PeriodoPicoOnda: [0, 1000],
  Periodo_VentoOnda: [0, 1000], PeriodoOndulacao: [0, 1000], Precipitacao: [0, 1e6],
  Visibilidade: [0, 1e9], PressaoNivelMar: [0, 2e6], Cobertura_Nuvem_Baixa: [0, 100],
  Cobertura_Nuvem_Media: [0, 100], Cobertura_Nuvem_Alta: [0, 100],
  IndiceProbabilidadeTrovao: [0, 100], Latitude: [-90, 90], Longitude: [-180, 180],
});
const CONDICOES_CLIMA = Object.freeze({ partly_cloudy: "Parcialmente nublado", cloudy: "Nublado" });
const cache = new Map();
const pendentes = new Map();
const diagnostico = { ultimaConsulta: null, ultimaConsultaBemSucedida: null, localidadesConsultadas: 0, localidadesComDadosValidos: 0, origemDados: null, errosRecentes: [] };

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
  const limite = LIMITES[campo];
  return !limite || (convertido >= limite[0] && convertido <= limite[1]) ? convertido : null;
}
function erroConfiguracao(mensagem, code = "OCEANOP_INVALID_CONFIGURATION") {
  return Object.assign(new Error(mensagem), { code, tipo: "configuration", transitorio: false, status: 400 });
}
function validarConsulta(localOuArea) {
  const local = texto(typeof localOuArea === "string" ? localOuArea : localOuArea?.local, 100);
  if (!local || /[\x00-\x1f\x7f]/.test(local)) throw erroConfiguracao("OCEANOP: informe o identificador local autorizado, com até 100 caracteres.");
  return { local };
}

function partesDataFonte(valor) {
  const data = texto(valor, 40);
  let m = data.match(/^(\d{2})\/(\d{2})\/(\d{4})[ T](\d{2}):(\d{2}):(\d{2})$/);
  if (m) return { year: +m[3], month: +m[2], day: +m[1], hour: +m[4], minute: +m[5], second: +m[6] };
  m = data.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
  return m ? { year: +m[1], month: +m[2], day: +m[3], hour: +m[4], minute: +m[5], second: +(m[6] || 0) } : null;
}
function validarPartesData(p) {
  if (!p) return false;
  const d = new Date(Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second));
  return d.getUTCFullYear() === p.year && d.getUTCMonth() === p.month - 1 && d.getUTCDate() === p.day &&
    d.getUTCHours() === p.hour && d.getUTCMinutes() === p.minute && d.getUTCSeconds() === p.second;
}
function instanteDaFonte(valor, fuso) {
  const partes = partesDataFonte(valor);
  if (!validarPartesData(partes) || !texto(fuso, 100)) return null;
  try { return instanteNoFuso(partes, fuso).toISOString(); } catch { return null; }
}
function chaveOrdenacaoData(valor) {
  const p = partesDataFonte(valor);
  return validarPartesData(p) ? [p.year, p.month, p.day, p.hour, p.minute, p.second].map((v, i) => String(v).padStart(i ? 2 : 4, "0")).join("") : "99999999999999";
}

function normalizarResposta(json, { fusoHorario = null } = {}) {
  if (!json || json.success !== true || !Array.isArray(json.data) || json.data.length > 10000) {
    throw Object.assign(new Error("OCEANOP retornou uma resposta fora do formato esperado."), { name: "ParserError", code: "OCEANOP_INVALID_PAYLOAD", transitorio: false });
  }
  return json.data.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw Object.assign(new Error("OCEANOP retornou um registro inválido."), { name: "ParserError", code: "OCEANOP_INVALID_RECORD", transitorio: false });
    const valores = {}, camposInvalidos = [];
    for (const [chave] of CAMPOS) {
      if (TEXTUAIS.has(chave)) valores[chave] = texto(item[chave]) || null;
      else {
        valores[chave] = numeroNoIntervalo(item[chave], chave);
        if (item[chave] !== undefined && item[chave] !== null && texto(String(item[chave])) && valores[chave] === null) camposInvalidos.push(chave);
      }
    }
    const inicio = texto(item.DataInicial, 40), fim = texto(item.DataFinal, 40), escritoEm = texto(item.DataEscrita, 40);
    return {
      local: texto(item.Local, 200), inicio, fim, escritoEm,
      inicioEm: instanteDaFonte(inicio, fusoHorario), fimEm: instanteDaFonte(fim, fusoHorario),
      escritoEmIso: instanteDaFonte(escritoEm, fusoHorario), fuso: fusoHorario || null,
      condicaoClimaPt: CONDICOES_CLIMA[valores.Condicao_Clima] || null, camposInvalidos, valores,
    };
  }).sort((a, b) => chaveOrdenacaoData(a.inicio).localeCompare(chaveOrdenacaoData(b.inicio)));
}

function cabecalhosOceanop(adicionais = {}) {
  return { Accept: "application/json", ...adicionais };
}
function registrarErro(erro, ocorridoEm) {
  diagnostico.localidadesComDadosValidos = 0; diagnostico.origemDados = "indisponivel";
  diagnostico.errosRecentes.unshift({ ocorridoEm, tipo: erro?.tipo || "unknown", codigo: erro?.code || null, httpStatus: erro?.httpStatus ?? null });
  diagnostico.errosRecentes.splice(5);
}
function obterDiagnosticoOceanop() {
  const falhou = diagnostico.ultimaConsulta && (!diagnostico.ultimaConsultaBemSucedida || diagnostico.ultimaConsulta > diagnostico.ultimaConsultaBemSucedida);
  const status = falhou || !diagnostico.localidadesComDadosValidos ? "INDISPONIVEL" : diagnostico.origemDados === "cache_valido" ? "DEGRADADO" : "ATIVO";
  return { status, ...diagnostico, errosRecentes: diagnostico.errosRecentes.map((e) => ({ ...e })) };
}

async function buscarOceanop(localOuArea, { fetchImpl = fetch, timeoutMs = OCEANOP_TIMEOUT_MS, tentativas = OCEANOP_TENTATIVAS, esperarFn, logger, headers = {}, agora = () => new Date(), cacheTtlMs = CACHE_TTL_MS, usarCache = true } = {}) {
  const consulta = validarConsulta(localOuArea);
  const area = typeof localOuArea === "object" && localOuArea ? localOuArea : {};
  const chave = consulta.local.toLocaleLowerCase("pt-BR"), instante = agora(), armazenado = cache.get(chave);
  if (usarCache && armazenado && instante.getTime() - Date.parse(armazenado.consultadoEm) < cacheTtlMs) {
    Object.assign(diagnostico, { localidadesConsultadas: 1, localidadesComDadosValidos: 1, origemDados: "cache_valido" });
    return { ...armazenado, cache: true };
  }
  if (usarCache && pendentes.has(chave)) return pendentes.get(chave);
  Object.assign(diagnostico, { ultimaConsulta: instante.toISOString(), localidadesConsultadas: 1, origemDados: "consulta_oceanop" });
  const tarefa = (async () => {
    const url = new URL(ENDPOINT); url.searchParams.set("local", consulta.local);
    const json = await buscarJsonComRetentativa(url, {
      nomeFonte: FONTE, fetchImpl, timeoutMs, tentativas, atrasoBaseMs: 1000, esperarFn,
      logger: logger === undefined && fetchImpl === globalThis.fetch ? console : logger, prefixoLog: "OCEANOP",
      requestInit: { method: "GET", headers: cabecalhosOceanop(headers), redirect: "error" },
    });
    const resultado = { fonte: FONTE, endpoint: ENDPOINT, consulta, consultadoEm: instante.toISOString(), campos: CAMPOS.map(([chaveCampo, rotulo]) => ({ chave: chaveCampo, rotulo })), previsoes: normalizarResposta(json, { fusoHorario: area.fusoHorario || null }), cache: false };
    if (!resultado.previsoes.length) throw Object.assign(new Error("OCEANOP retornou success=true, mas sem registros de previsão."), { name: "ParserError", code: "OCEANOP_EMPTY_DATA", transitorio: false });
    if (usarCache) cache.set(chave, resultado);
    Object.assign(diagnostico, { ultimaConsultaBemSucedida: resultado.consultadoEm, localidadesComDadosValidos: 1, origemDados: "consulta_oceanop" });
    return resultado;
  })();
  if (usarCache) pendentes.set(chave, tarefa);
  try { return await tarefa; } catch (erro) { registrarErro(erro, agora().toISOString()); throw erro; }
  finally { if (pendentes.get(chave) === tarefa) pendentes.delete(chave); }
}

function converterVelocidadeParaKmh(valor, unidade) {
  if (!Number.isFinite(valor)) return null;
  return unidade === "km/h" ? valor : unidade === "m/s" ? valor * 3.6 : null;
}
function exigirMetadadosVento(area) {
  const u = area?.unidades || {};
  if (!area?.fusoHorario || area?.usarVento !== true || !["km/h", "m/s"].includes(u.VelocidadeVento) || !["km/h", "m/s"].includes(u.VelocidadeVento_10M_Rajada) || u.DirecaoVento !== "graus") {
    throw erroConfiguracao("OCEANOP: fuso e unidades do vento ainda não foram homologados para esta área.", "OCEANOP_WIND_METADATA_UNCONFIRMED");
  }
}
function limitesJanela(area, agora, inicioHora, fimHora) {
  if (!area?.fusoHorario) throw erroConfiguracao("OCEANOP: fuso da área não homologado.", "OCEANOP_TIMEZONE_UNCONFIRMED");
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
  const x = v.reduce((s, graus) => s + Math.cos(graus * Math.PI / 180), 0);
  const y = v.reduce((s, graus) => s + Math.sin(graus * Math.PI / 180), 0);
  if (Math.abs(x) < 1e-12 && Math.abs(y) < 1e-12) return null;
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}
function maximoRegistro(itens, campo, unidade) {
  return itens.map((item) => ({ item, valor: converterVelocidadeParaKmh(item.valores[campo], unidade) })).filter((x) => Number.isFinite(x.valor)).reduce((m, x) => !m || x.valor > m.valor ? x : m, null);
}
function resumoVento(itens, area) {
  if (!itens.length) return null;
  const u = area.unidades, pico = maximoRegistro(itens, "VelocidadeVento_10M_Rajada", u.VelocidadeVento_10M_Rajada);
  const direcaoGraus = mediaDirecao(itens.map((i) => i.valores.DirecaoVento));
  return {
    velocidadeMediaKmh: arredondar(media(itens.map((i) => converterVelocidadeParaKmh(i.valores.VelocidadeVento, u.VelocidadeVento)))),
    rajadaMaxKmh: arredondar(pico?.valor), rajadaPrevistaEm: pico?.item.inicioEm || null,
    periodoReferencia: pico?.item.inicio && pico?.item.fim ? `${pico.item.inicio} a ${pico.item.fim}` : null,
    dataEscrita: pico?.item.escritoEm || null, local: pico?.item.local || itens.find((i) => i.local)?.local || area.referencia || area.local,
    direcaoGraus: Number.isFinite(direcaoGraus) ? arredondar(direcaoGraus, 0) : null,
    direcao: Number.isFinite(direcaoGraus) ? direcaoCardinal(direcaoGraus) : null, fonte: FONTE,
  };
}
function mapearOceanopParaVento(resultado, area, opcoes = {}) {
  exigirMetadadosVento(area);
  const registros = registrosNaJanela(resultado, area, opcoes);
  if (!registros.length) throw Object.assign(new Error("OCEANOP: nenhum período válido para a área e a janela do informativo."), { code: "OCEANOP_NO_CURRENT_DATA", tipo: "no_data", transitorio: false });
  const grupos = { manha: [], tarde: [], noite: [] };
  for (const r of registros) { const chave = periodoDaHora(partesNoFuso(r.inicioEm, area.fusoHorario).hour); if (chave) grupos[chave].push(r); }
  return { ...Object.fromEntries(Object.entries(grupos).map(([chave, itens]) => [chave, resumoVento(itens, area)])), resumo: resumoVento(registros, area) };
}
function dataLocalIso(instante, fuso) { const p = partesNoFuso(instante, fuso); return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`; }
function mapearOceanopParaProximosDias(resultado, area, { agora = new Date(), quantidade = 3 } = {}) {
  exigirMetadadosVento(area);
  const hoje = partesNoFuso(agora, area.fusoHorario);
  return Array.from({ length: quantidade }, (_, i) => adicionarDias(hoje, i + 1)).map((d) => `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`).map((data) => {
    const itens = (resultado?.previsoes || []).filter((item) => item.inicioEm && dataLocalIso(item.inicioEm, area.fusoHorario) === data);
    return { data, ...resumoVento(itens, area) };
  }).filter((dia) => Number.isFinite(dia.rajadaMaxKmh));
}

function exigirUnidadesMar(area) {
  const u = area?.unidades || {}, exigidas = { AlturaOnda: "m", AlturaMaximaOnda: "m", PeriodoOnda: "s", PeriodoPicoOnda: "s", DirecaoOnda: "graus", AlturaOndulacao: "m" };
  if (!area?.fusoHorario || area?.usarMar !== true || Object.entries(exigidas).some(([c, v]) => u[c] !== v)) throw erroConfiguracao("OCEANOP: fuso e unidades marítimas ainda não homologados para esta área.", "OCEANOP_UNITS_OR_TIMEZONE_UNCONFIRMED");
}
function mapearOceanopParaMar(resultado, area, opcoes = {}) {
  exigirUnidadesMar(area);
  const registros = registrosNaJanela(resultado, area, opcoes);
  if (!registros.length) throw Object.assign(new Error("OCEANOP: nenhum período marítimo válido."), { code: "OCEANOP_NO_CURRENT_DATA" });
  const grupos = { manha: [], tarde: [], noite: [] }, rotulos = { manha: "Manhã", tarde: "Tarde", noite: "Noite" };
  for (const r of registros) { const chave = periodoDaHora(partesNoFuso(r.inicioEm, area.fusoHorario).hour); if (chave) grupos[chave].push(r); }
  const max = (v) => v.filter(Number.isFinite).reduce((m, n) => m === null || n > m ? n : m, null);
  const periodos = Object.entries(grupos).map(([chave, itens]) => { const valores = (campo) => itens.map((i) => i.valores[campo]); const alturaMaxM = arredondar(max(valores("AlturaMaximaOnda"))), direcao = media(valores("DirecaoOnda")); return { periodo: rotulos[chave], alturaOndaM: arredondar(media(valores("AlturaOnda"))), alturaMaxM, periodoOndaS: arredondar(media(valores("PeriodoOnda"))), periodoPicoOndaS: arredondar(media(valores("PeriodoPicoOnda"))), direcaoOnda: Number.isFinite(direcao) ? direcaoCardinal(direcao) : "—", marulhoMaxM: arredondar(max(valores("AlturaOndulacao"))), periodoOndulacaoS: arredondar(media(valores("PeriodoOndulacao"))), estadoMar: classificarEstadoMar(alturaMaxM) }; });
  const alturaMaxDiaM = max(periodos.map((p) => p.alturaMaxM));
  if (!Number.isFinite(alturaMaxDiaM)) throw Object.assign(new Error("OCEANOP: AlturaMaximaOnda ausente."), { code: "OCEANOP_MARINE_FIELDS_MISSING" });
  return { fonte: FONTE, alturaMaxDiaM, estadoMarDia: classificarEstadoMar(alturaMaxDiaM), temperaturaMarC: null, periodos, referenciaPonto: area.referencia || area.local, consultadoEm: resultado.consultadoEm, ultimaAtualizacao: resultado.consultadoEm, desatualizado: false, pontoOceanop: area.local };
}
function limparCacheOceanop() {
  cache.clear(); pendentes.clear();
  Object.assign(diagnostico, { ultimaConsulta: null, ultimaConsultaBemSucedida: null, localidadesConsultadas: 0, localidadesComDadosValidos: 0, origemDados: null, errosRecentes: [] });
}

module.exports = {
  ENDPOINT, FONTE, CAMPOS, CONDICOES_CLIMA, OCEANOP_TIMEOUT_MS, OCEANOP_TENTATIVAS, CACHE_TTL_MS,
  buscarOceanop, normalizarResposta, validarConsulta, numero, numeroNoIntervalo, partesDataFonte, instanteDaFonte,
  mapearOceanopParaMar, mapearOceanopParaVento, mapearOceanopParaProximosDias, converterVelocidadeParaKmh,
  registrosNaJanela, limparCacheOceanop, obterDiagnosticoOceanop, cabecalhosOceanop,
};
