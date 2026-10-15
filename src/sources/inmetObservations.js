const fs = require("node:fs");
const path = require("node:path");
const tls = require("node:tls");
const { Agent } = require("undici");
const { buscarJsonComRetentativa, tipoErro } = require("./httpJsonClient");

const FONTE = "INMET — estação automática";
const URL_BASE = "https://apiprevmet3.inmet.gov.br";
const URL_CATALOGO = "https://apitempo.inmet.gov.br/estacoes/T";
const ARQUIVO_CACHE = path.join(__dirname, "..", "..", "data", "inmet-observacoes.json");
const TIMEOUT_MS = 15000;
const TENTATIVAS = 3;
const IDADE_MAXIMA_MS = 4 * 60 * 60 * 1000;
const DISTANCIA_MAXIMA_KM = 150;
const RETENCAO_HISTORICO_MS = 8 * 24 * 60 * 60 * 1000;

let agenteSistema;
let catalogoMemoria = null;

function dispatcherSistema() {
  if (!agenteSistema) {
    const ca = tls.getCACertificates?.("system") || [];
    agenteSistema = ca.length ? new Agent({ connect: { ca } }) : null;
  }
  return agenteSistema;
}

function numero(valor) {
  if (Number.isFinite(valor)) return valor;
  if (typeof valor !== "string" || !valor.trim()) return null;
  const convertido = Number(valor.trim().replace(",", "."));
  return Number.isFinite(convertido) ? convertido : null;
}

function arredondar(valor, casas = 1) {
  if (!Number.isFinite(valor)) return null;
  const fator = 10 ** casas;
  return Math.round(valor * fator) / fator;
}

function dentro(valor, minimo, maximo) {
  return Number.isFinite(valor) && valor >= minimo && valor <= maximo ? valor : null;
}

function direcaoCardeal(graus) {
  const valor = dentro(graus, 0, 360);
  if (valor === null) return null;
  const pontos = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSO", "SO", "OSO", "O", "ONO", "NO", "NNO"];
  return pontos[Math.round((valor % 360) / 22.5) % 16];
}

function instanteMedicao(data, hora) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(data || ""))) return null;
  const digitos = String(hora || "").replace(/\D/g, "").padStart(4, "0");
  if (!/^\d{4}$/.test(digitos)) return null;
  const hh = Number(digitos.slice(0, 2));
  const mm = Number(digitos.slice(2));
  if (hh > 23 || mm > 59) return null;
  const instante = new Date(`${data}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00Z`);
  return Number.isNaN(instante.getTime()) ? null : instante.toISOString();
}

function haversineKm(lat1, lon1, lat2, lon2) {
  if (![lat1, lon1, lat2, lon2].every(Number.isFinite)) return null;
  const rad = (valor) => valor * Math.PI / 180;
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function normalizarCatalogo(payload) {
  if (!Array.isArray(payload)) return [];
  return payload.map((item) => ({
    codigo: String(item?.CD_ESTACAO || "").trim(),
    nome: String(item?.DC_NOME || "").trim() || null,
    uf: String(item?.SG_ESTADO || "").trim() || null,
    entidade: String(item?.SG_ENTIDADE || "").trim() || null,
    tipo: String(item?.TP_ESTACAO || "").trim() || null,
    situacao: String(item?.CD_SITUACAO || "").trim() || null,
    latitude: numero(item?.VL_LATITUDE),
    longitude: numero(item?.VL_LONGITUDE),
  })).filter((item) => item.codigo);
}

function normalizarObservacao(payload, { cidade, consultadoEm = new Date().toISOString(), catalogo = [] } = {}) {
  const dados = payload?.dados;
  const estacaoApi = payload?.estacao;
  if (!dados || !estacaoApi) {
    const erro = new Error("INMET não retornou estação e observação no formato esperado.");
    erro.name = "ParserError";
    throw erro;
  }

  const codigo = String(dados.CD_ESTACAO || estacaoApi.CODIGO || "").trim();
  const cadastro = catalogo.find((item) => item.codigo === codigo) || null;
  const latitude = numero(dados.VL_LATITUDE ?? estacaoApi.LATITUDE ?? cadastro?.latitude);
  const longitude = numero(dados.VL_LONGITUDE ?? estacaoApi.LONGITUDE ?? cadastro?.longitude);
  const distanciaCalculada = haversineKm(numero(cidade?.latitude), numero(cidade?.longitude), latitude, longitude);
  const distanciaInformada = numero(estacaoApi.DISTANCIA_EM_KM);
  const distanciaKm = arredondar(distanciaCalculada ?? distanciaInformada, 1);
  const medidoEm = instanteMedicao(dados.DT_MEDICAO, dados.HR_MEDICAO);
  if (!codigo || !medidoEm || latitude === null || longitude === null) {
    const erro = new Error("INMET retornou observação sem estação, coordenadas ou horário válidos.");
    erro.name = "ParserError";
    throw erro;
  }
  if (distanciaKm !== null && distanciaKm > DISTANCIA_MAXIMA_KM) {
    const erro = new Error(`Estação INMET mais próxima está a ${distanciaKm} km, fora do limite de representatividade de ${DISTANCIA_MAXIMA_KM} km.`);
    erro.name = "ParserError";
    erro.code = "INMET_STATION_TOO_FAR";
    throw erro;
  }
  if (cadastro && (cadastro.entidade !== "INMET" || cadastro.tipo !== "Automatica" || cadastro.situacao !== "Operante")) {
    const erro = new Error(`Estação ${codigo} não está cadastrada como automática e operante do INMET.`);
    erro.name = "ParserError";
    erro.code = "INMET_STATION_INVALID";
    throw erro;
  }

  const ventoMs = dentro(numero(dados.VEN_VEL), 0, 100);
  const rajadaMs = dentro(numero(dados.VEN_RAJ), 0, 120);
  const direcaoGraus = dentro(numero(dados.VEN_DIR), 0, 360);
  const chuvaMm = dentro(numero(dados.CHUVA), 0, 500);
  const temperaturaMinC = dentro(numero(dados.TEM_MIN), -90, 70);
  const temperaturaMaxC = dentro(numero(dados.TEM_MAX), -90, 70);
  const temperaturaAtualC = dentro(numero(dados.TEM_INS), -90, 70);
  const umidadeMinPct = dentro(numero(dados.UMD_MIN), 0, 100);
  const umidadeMaxPct = dentro(numero(dados.UMD_MAX), 0, 100);
  const umidadeAtualPct = dentro(numero(dados.UMD_INS), 0, 100);
  if ([temperaturaMinC, temperaturaMaxC, temperaturaAtualC, umidadeMinPct, umidadeMaxPct, umidadeAtualPct, ventoMs, rajadaMs, direcaoGraus, chuvaMm].every((valor) => valor === null)) {
    const erro = new Error("INMET não publicou temperatura, chuva nem vento na observação mais recente.");
    erro.name = "ParserError";
    throw erro;
  }

  const idadeMs = Date.parse(consultadoEm) - Date.parse(medidoEm);
  const desatualizado = !Number.isFinite(idadeMs) || idadeMs > IDADE_MAXIMA_MS || idadeMs < -15 * 60 * 1000;
  return {
    fonte: FONTE,
    tipoDado: "observado",
    status: desatualizado ? "desatualizado" : "operacional",
    medidoEm,
    atualizadoEm: consultadoEm,
    desatualizado,
    estacao: {
      codigo,
      nome: String(estacaoApi.NOME || dados.DC_NOME || cadastro?.nome || "").trim() || null,
      uf: String(estacaoApi.UF || dados.UF || cadastro?.uf || "").trim() || null,
      latitude,
      longitude,
      distanciaKm,
      situacao: cadastro?.situacao || "não verificada no catálogo",
    },
    temperaturaMinC,
    temperaturaMaxC,
    temperaturaAtualC,
    umidadeMinPct,
    umidadeMaxPct,
    umidadeAtualPct,
    chuvaUltimaHoraMm: chuvaMm,
    ventoVelocidadeKmh: ventoMs === null ? null : arredondar(ventoMs * 3.6, 1),
    ventoDirecaoGraus: direcaoGraus,
    ventoDirecao: direcaoCardeal(direcaoGraus),
    rajadaKmh: rajadaMs === null ? null : arredondar(rajadaMs * 3.6, 1),
    metadados: {
      fonte: FONTE,
      instanteMedicao: medidoEm,
      ultimaAtualizacao: consultadoEm,
      localidade: String(estacaoApi.NOME || dados.DC_NOME || cadastro?.nome || codigo),
      estacao: codigo,
      natureza: "observado",
      status: desatualizado ? "desatualizado" : "operacional",
    },
  };
}

function lerCache() {
  try { return JSON.parse(fs.readFileSync(ARQUIVO_CACHE, "utf8")); }
  catch (erro) { if (erro.code === "ENOENT") return { versao: 1, bases: {} }; throw erro; }
}

function gravarCache(cache) {
  fs.mkdirSync(path.dirname(ARQUIVO_CACHE), { recursive: true });
  const temporario = `${ARQUIVO_CACHE}.${process.pid}.tmp`;
  fs.writeFileSync(temporario, JSON.stringify(cache, null, 2), "utf8");
  fs.renameSync(temporario, ARQUIVO_CACHE);
}

function atualizarHistorico(cache, cidade, observacao, agoraMs = Date.now()) {
  cache.versao = 1;
  cache.bases ||= {};
  const anterior = cache.bases[cidade.chave] || { historico: [] };
  const porInstante = new Map((anterior.historico || []).map((item) => [item.medidoEm, item]));
  porInstante.set(observacao.medidoEm, observacao);
  const limite = agoraMs - RETENCAO_HISTORICO_MS;
  const historico = [...porInstante.values()]
    .filter((item) => Number.isFinite(Date.parse(item.medidoEm)) && Date.parse(item.medidoEm) >= limite)
    .sort((a, b) => Date.parse(a.medidoEm) - Date.parse(b.medidoEm));
  cache.bases[cidade.chave] = { ultimaValida: observacao, historico };
  return cache.bases[cidade.chave];
}

function partesLocais(instante, fuso) {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: fuso,
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(instante));
  const valor = (tipo) => partes.find((parte) => parte.type === tipo)?.value;
  return { data: `${valor("year")}-${valor("month")}-${valor("day")}`, hora: Number(valor("hour")), minuto: Number(valor("minute")) };
}

function periodoDaHora(hora) {
  if (hora >= 5 && hora < 12) return "manha";
  if (hora >= 12 && hora < 18) return "tarde";
  if (hora >= 18) return "noite";
  return null;
}

function extremos(valores, operacao) {
  const validos = valores.filter(Number.isFinite);
  return validos.length ? Math[operacao](...validos) : null;
}

function somaOuNull(valores) {
  const validos = valores.filter(Number.isFinite);
  return validos.length ? arredondar(validos.reduce((soma, valor) => soma + valor, 0), 1) : null;
}

function coberturaHoraria(pontos, horasEsperadas) {
  const instantesComChuva = new Set(
    pontos.filter((item) => Number.isFinite(item.chuvaUltimaHoraMm)).map((item) => item.medidoEm)
  );
  const esperadas = Math.max(0, Math.min(24, horasEsperadas));
  return {
    amostras: instantesComChuva.size,
    horasEsperadas: esperadas,
    parcial: instantesComChuva.size < esperadas,
  };
}

function coberturaIndicador(pontos, campos, horasEsperadas) {
  const instantesValidos = new Set(
    pontos
      .filter((item) => campos.some((campo) => Number.isFinite(item?.[campo])))
      .map((item) => item.medidoEm)
  );
  const esperadas = Math.max(0, Math.min(24, horasEsperadas));
  return {
    amostras: instantesValidos.size,
    horasEsperadas: esperadas,
    parcial: instantesValidos.size < esperadas,
  };
}

function agregarObservacoes(historico, {
  agora = new Date(),
  fuso = "America/Sao_Paulo",
  inicioHora = 0,
  fimHora = 24,
} = {}) {
  const agoraData = agora instanceof Date ? agora : new Date(agora);
  const agoraLocal = partesLocais(agoraData, fuso);
  const hoje = agoraLocal.data;
  const unicos = new Map((Array.isArray(historico) ? historico : [])
    .filter((item) => item?.medidoEm)
    .map((item) => [item.medidoEm, item]));
  const todos = [...unicos.values()]
    .filter((item) => Number.isFinite(Date.parse(item.medidoEm)))
    .sort((a, b) => Date.parse(a.medidoEm) - Date.parse(b.medidoEm));
  const pontos = todos
    .filter((item) => partesLocais(item.medidoEm, fuso).data === hoje)
    .sort((a, b) => Date.parse(a.medidoEm) - Date.parse(b.medidoEm));
  const periodos = {};
  for (const chave of ["manha", "tarde", "noite"]) {
    const doPeriodo = pontos.filter((item) => periodoDaHora(partesLocais(item.medidoEm, fuso).hora) === chave);
    if (!doPeriodo.length) continue;
    const ultima = doPeriodo.at(-1);
    periodos[chave] = {
      tempMin: extremos(doPeriodo.map((item) => item.temperaturaMinC), "min"),
      tempMax: extremos(doPeriodo.map((item) => item.temperaturaMaxC), "max"),
      umidadeMin: extremos(doPeriodo.map((item) => item.umidadeMinPct), "min"),
      umidadeMax: extremos(doPeriodo.map((item) => item.umidadeMaxPct), "max"),
      umidadeAtual: ultima.umidadeAtualPct ?? null,
      velocidadeMaxKmh: extremos(doPeriodo.map((item) => item.ventoVelocidadeKmh), "max"),
      rajadaMaxKmh: extremos(doPeriodo.map((item) => item.rajadaKmh), "max"),
      direcao: ultima.ventoDirecao,
      direcaoGraus: ultima.ventoDirecaoGraus,
      precipitacaoMm: somaOuNull(doPeriodo.map((item) => item.chuvaUltimaHoraMm)),
      precipitacaoHorariaMaxMm: extremos(doPeriodo.map((item) => item.chuvaUltimaHoraMm), "max"),
      amostras: doPeriodo.length,
      medidoEm: ultima.medidoEm,
      tipoDado: "observado",
    };
  }
  const chuvas = pontos.map((item) => item.chuvaUltimaHoraMm).filter(Number.isFinite);
  const inicio24h = agoraData.getTime() - 24 * 60 * 60 * 1000;
  const pontos24h = todos.filter((item) => {
    const instante = Date.parse(item.medidoEm);
    return instante > inicio24h && instante <= agoraData.getTime();
  });
  const pontosJanela = pontos.filter((item) => {
    const hora = partesLocais(item.medidoEm, fuso).hora;
    return hora >= inicioHora && hora < fimHora && Date.parse(item.medidoEm) <= agoraData.getTime();
  });
  const horasEsperadasDia = agoraLocal.hora + 1;
  const fimEfetivoJanela = Math.min(fimHora, agoraLocal.hora + 1);
  const horasEsperadasJanela = Math.max(0, fimEfetivoJanela - inicioHora);
  const chuvaPorHora = pontos.filter((item) => Number.isFinite(item.chuvaUltimaHoraMm)).map((item) => {
    const fim = partesLocais(item.medidoEm, fuso);
    const inicio = partesLocais(new Date(Date.parse(item.medidoEm) - 60 * 60 * 1000), fuso);
    const horaInicio = `${String(inicio.hora).padStart(2, "0")}:${String(inicio.minuto).padStart(2, "0")}`;
    const horaFim = `${String(fim.hora).padStart(2, "0")}:${String(fim.minuto).padStart(2, "0")}`;
    return {
      horario: horaFim,
      intervalo: `${horaInicio}–${horaFim}`,
      precipitacaoMm: item.chuvaUltimaHoraMm,
      medidoEm: item.medidoEm,
      tipoDado: "observado",
    };
  });
  return {
    dataLocal: hoje,
    pontos,
    periodos,
    chuvaPorHora,
    temperaturaMinC: extremos(pontos.map((item) => item.temperaturaMinC), "min"),
    temperaturaMaxC: extremos(pontos.map((item) => item.temperaturaMaxC), "max"),
    temperaturaAtualC: pontos.at(-1)?.temperaturaAtualC ?? null,
    umidadeMinPct: extremos(pontos.map((item) => item.umidadeMinPct), "min"),
    umidadeMaxPct: extremos(pontos.map((item) => item.umidadeMaxPct), "max"),
    umidadeAtualPct: pontos.at(-1)?.umidadeAtualPct ?? null,
    precipitacaoTotalMm: somaOuNull(chuvas),
    precipitacaoUltimas24hMm: somaOuNull(pontos24h.map((item) => item.chuvaUltimaHoraMm)),
    precipitacaoPeriodoMm: somaOuNull(pontosJanela.map((item) => item.chuvaUltimaHoraMm)),
    precipitacaoHorariaMaxMm: extremos(chuvas, "max"),
    rajadaMaxKmh: extremos(pontos.map((item) => item.rajadaKmh), "max"),
    cobertura: coberturaHoraria(pontos, horasEsperadasDia),
    coberturaTemperatura: coberturaIndicador(
      pontos,
      ["temperaturaMinC", "temperaturaMaxC", "temperaturaAtualC"],
      horasEsperadasDia
    ),
    coberturaUmidade: coberturaIndicador(
      pontos,
      ["umidadeMinPct", "umidadeMaxPct", "umidadeAtualPct"],
      horasEsperadasDia
    ),
    coberturaUltimas24h: coberturaHoraria(pontos24h, 24),
    coberturaPeriodo: coberturaHoraria(pontosJanela, horasEsperadasJanela),
    janelaSelecionada: { inicioHora, fimHora },
  };
}

async function buscarCatalogo({ fetchImpl, esperarFn, requestInit } = {}) {
  const agora = Date.now();
  if (catalogoMemoria && agora - catalogoMemoria.carregadoEm < 24 * 60 * 60 * 1000) return catalogoMemoria.itens;
  const payload = await buscarJsonComRetentativa(URL_CATALOGO, {
    nomeFonte: "INMET (catálogo de estações automáticas)", fetchImpl, esperarFn,
    timeoutMs: TIMEOUT_MS, tentativas: 2, atrasoBaseMs: 1000, requestInit,
  });
  const itens = normalizarCatalogo(payload);
  if (!itens.length) throw new Error("Catálogo INMET sem estações automáticas válidas.");
  catalogoMemoria = { carregadoEm: agora, itens };
  return itens;
}

async function buscarObservacaoInmet(cidade, {
  fetchImpl = fetch,
  esperarFn,
  carregar = lerCache,
  salvar = gravarCache,
  agora = () => new Date(),
  inicioHora = 0,
  fimHora = 24,
  logger = console,
} = {}) {
  const consultadoEm = agora().toISOString();
  const url = `${URL_BASE}/estacao/proxima/${encodeURIComponent(cidade.codigoIbge)}`;
  const dispatcher = fetchImpl === globalThis.fetch ? dispatcherSistema() : null;
  const requestInit = {
    headers: { Accept: "application/json", "User-Agent": "ProtocoloMeteorologicoCIM/1.0 (consulta publica institucional)" },
    ...(dispatcher ? { dispatcher } : {}),
  };
  let erroCatalogo = null;
  let catalogo = [];
  try { catalogo = await buscarCatalogo({ fetchImpl, esperarFn, requestInit }); }
  catch (erro) { erroCatalogo = erro; }

  try {
    const payload = await buscarJsonComRetentativa(url, {
      nomeFonte: "INMET (observação da estação mais próxima)", fetchImpl, esperarFn,
      timeoutMs: TIMEOUT_MS, tentativas: TENTATIVAS, atrasoBaseMs: 1000, requestInit,
      logger: logger === undefined && fetchImpl === globalThis.fetch ? console : logger,
      prefixoLog: "INMET-OBSERVACAO",
    });
    const observacao = normalizarObservacao(payload, { cidade, consultadoEm, catalogo });
    const cache = carregar();
    const baseCache = atualizarHistorico(cache, cidade, observacao, agora().getTime());
    salvar(cache);
    const agregado = agregarObservacoes(baseCache.historico, { agora: agora(), fuso: cidade.fusoHorario || "America/Sao_Paulo", inicioHora, fimHora });
    return {
      status: observacao.desatualizado ? "degradado" : "operacional",
      fonte: FONTE,
      endpoint: url,
      endpointCatalogo: URL_CATALOGO,
      mensagem: observacao.desatualizado ? "A observação mais recente do INMET está desatualizada." : "Observação oficial atualizada.",
      observacao,
      historico: baseCache.historico,
      agregado,
      validacaoCatalogo: erroCatalogo ? { status: "indisponivel", erro: erroCatalogo.message } : { status: "operacional" },
    };
  } catch (erro) {
    let baseCache = null;
    try { baseCache = carregar()?.bases?.[cidade.chave] || null; } catch {}
    if (baseCache?.ultimaValida) {
      const ultima = { ...baseCache.ultimaValida, status: "armazenado", desatualizado: true, metadados: { ...baseCache.ultimaValida.metadados, status: "armazenado" } };
      return {
        status: "degradado", fonte: FONTE, endpoint: url, endpointCatalogo: URL_CATALOGO,
        mensagem: `Consulta atual indisponível; usando última observação INMET de ${ultima.medidoEm}.`,
        observacao: ultima, historico: baseCache.historico || [],
        agregado: agregarObservacoes(baseCache.historico || [], { agora: agora(), fuso: cidade.fusoHorario || "America/Sao_Paulo", inicioHora, fimHora }),
        erro: { tipo: tipoErro(erro), mensagem: erro.message },
      };
    }
    return {
      status: "indisponivel", fonte: FONTE, endpoint: url, endpointCatalogo: URL_CATALOGO,
      mensagem: "INMET: observação de temperatura, umidade, chuva e vento indisponível nesta atualização.",
      observacao: null, historico: [], agregado: agregarObservacoes([], { agora: agora(), fuso: cidade.fusoHorario || "America/Sao_Paulo", inicioHora, fimHora }),
      erro: { tipo: tipoErro(erro), mensagem: erro.message },
    };
  }
}

module.exports = {
  buscarObservacaoInmet,
  normalizarObservacao,
  normalizarCatalogo,
  agregarObservacoes,
  direcaoCardeal,
  instanteMedicao,
  atualizarHistorico,
  FONTE,
  URL_BASE,
  URL_CATALOGO,
  ARQUIVO_CACHE,
  TIMEOUT_MS,
  TENTATIVAS,
  IDADE_MAXIMA_MS,
  DISTANCIA_MAXIMA_KM,
};
