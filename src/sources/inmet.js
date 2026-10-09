// Fonte: INMET — API pública oficial (sem necessidade de chave), usada como
// fonte OFICIAL de validação cruzada e como fonte de avisos de perigo
// (equivalente aos alertas de Defesa Civil coordenados nacionalmente).
//
// Endpoints confirmados manualmente em 25/08/2026:
//   Previsão por município (código IBGE): https://apiprevmet3.inmet.gov.br/previsao/<codigoIbge>
//   Avisos de perigo ativos (nacional):    https://apiprevmet3.inmet.gov.br/avisos/ativos
//
// OBS: apitempo.inmet.gov.br (usado em versões antigas de tutoriais) está
// fora do ar / não resolve mais rotas de previsão — não usar.

const {
  API_TIMEOUT_MS,
  API_TENTATIVAS,
  buscarJsonComRetentativa,
} = require("./httpJsonClient");

const HEADERS = { "User-Agent": "Mozilla/5.0 (ProtocoloMeteorologicoCIM/1.0)" };
const INMET_TIMEOUT_MS = API_TIMEOUT_MS;
const INMET_AVISOS_TIMEOUT_MS = 15000;
const INMET_TENTATIVAS = API_TENTATIVAS;

function hojeDDMMAAAA() {
  const agora = new Date(
    new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" })
  );
  const dd = String(agora.getDate()).padStart(2, "0");
  const mm = String(agora.getMonth() + 1).padStart(2, "0");
  const yyyy = agora.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

async function buscarPrevisaoInmet(codigoIbge, {
  fetchImpl = fetch,
  timeoutMs = INMET_TIMEOUT_MS,
  esperarFn,
} = {}) {
  const url = `https://apiprevmet3.inmet.gov.br/previsao/${codigoIbge}`;
  const json = await buscarJsonComRetentativa(url, {
    nomeFonte: "INMET (previsão)",
    fetchImpl,
    timeoutMs,
    tentativas: INMET_TENTATIVAS,
    esperarFn,
    requestInit: { headers: HEADERS },
  });
  const porData = json[codigoIbge];
  if (!porData) {
    throw new Error(`INMET não retornou previsão para o código ${codigoIbge}`);
  }

  const dataAlvo = hojeDDMMAAAA();
  const diaEscolhido = porData[dataAlvo] || porData[Object.keys(porData)[0]];
  if (!diaEscolhido) {
    throw new Error("INMET retornou payload sem períodos de previsão");
  }

  const numeroOficial = (...valores) => {
    for (const valor of valores) {
      if (Number.isFinite(valor)) return valor;
      if (typeof valor === "string" && /^\s*-?\d+(?:[.,]\d+)?\s*(?:km\/h|mm)?\s*$/i.test(valor)) {
        const numero = Number(valor.replace(/\s*(?:km\/h|mm)\s*$/i, "").replace(",", "."));
        if (Number.isFinite(numero)) return numero;
      }
    }
    return null;
  };
  const limpar = (p) =>
    p && {
      resumo: p.resumo || null,
      tempMax: p.temp_max ?? null,
      tempMin: p.temp_min ?? null,
      umidadeMax: p.umidade_max ?? null,
      umidadeMin: p.umidade_min ?? null,
      direcaoVento: p.dir_vento || null,
      intensidadeVento: p.int_vento || null,
      // O endpoint municipal não publica estes campos atualmente, mas a
      // leitura aceita nomes oficiais explícitos caso passem a ser incluídos.
      rajadaMaxKmh: numeroOficial(p.rajada_max, p.rajada_vento, p.vento_rajada, p.rajada),
      precipitacaoMm: numeroOficial(p.precipitacao_mm, p.chuva_mm, p.acumulado_chuva_mm),
    };

  return {
    fonte: "INMET (previsão oficial)",
    url: `https://previsao.inmet.gov.br/${codigoIbge}`,
    data: dataAlvo,
    periodos: {
      manha: limpar(diaEscolhido.manha),
      tarde: limpar(diaEscolhido.tarde),
      noite: limpar(diaEscolhido.noite),
    },
  };
}

function textoOficial(...valores) {
  for (const valor of valores) {
    if (typeof valor === "string" && valor.trim()) return valor.trim();
    if (Number.isFinite(valor)) return String(valor);
  }
  return null;
}

function listaOficial(...valores) {
  for (const valor of valores) {
    if (Array.isArray(valor)) {
      const itens = valor
        .map((item) => textoOficial(item?.description, item?.value, item))
        .filter(Boolean);
      if (itens.length) return itens;
    }
    const texto = textoOficial(valor);
    if (texto) return [texto];
  }
  return [];
}

function normalizarComparacao(valor) {
  return String(valor || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function fenomenoAvisoInmet(descricao) {
  const texto = normalizarComparacao(descricao);
  if (/tempestade|trovoada|granizo/.test(texto)) return "tempestade";
  if (/baixa umidade|umidade baixa|tempo seco/.test(texto)) return "baixa-umidade";
  if (/chuva|alagamento|inundacao|enxurrada/.test(texto)) return "chuva";
  if (/vento|ventania|rajada/.test(texto)) return "vento";
  if (/ressaca|agitacao maritima|onda/.test(texto)) return "ressaca";
  if (/calor|onda de calor/.test(texto)) return "calor";
  if (/frio|geada|baixa temperatura/.test(texto)) return "frio";
  if (/nevoeiro|neblina/.test(texto)) return "nevoeiro";

  const simplificado = texto
    .replace(/\bavisos?\b|\bmeteorologic[oa]s?\b|\bintens[oa]s?\b/g, " ")
    .replace(/\b([a-z]{5,})s\b/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  return (simplificado || "aviso").replace(/\s+/g, "-");
}

function grauAvisoInmet(severidade) {
  const texto = normalizarComparacao(severidade);
  if (texto.includes("grande perigo") || texto === "extreme") return "EMERGÊNCIA";
  if (texto.includes("perigo potencial") || texto === "moderate") return "ATENÇÃO";
  if (texto.includes("perigo") || texto === "severe") return "ALERTA";
  return null;
}

function prioridadeAvisoInmet(aviso) {
  return { "ATENÇÃO": 1, ALERTA: 2, "EMERGÊNCIA": 3 }[
    grauAvisoInmet(aviso?.severidade ?? aviso?.severity)
  ] || 0;
}

function dataAvisoEmMs(valor) {
  if (valor instanceof Date) return Number.isNaN(valor.getTime()) ? null : valor.getTime();
  if (typeof valor !== "string" || !valor.trim()) return null;
  const brasileira = /^(\d{2})\/(\d{2})\/(\d{4})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(valor.trim());
  if (brasileira) {
    const [, dd, mm, aaaa, hora = "00", minuto = "00", segundo = "00"] = brasileira;
    const data = new Date(`${aaaa}-${mm}-${dd}T${hora}:${minuto}:${segundo}-03:00`);
    return Number.isNaN(data.getTime()) ? null : data.getTime();
  }
  // /avisos/ativos publica "AAAA-MM-DD HH:MM" sem fuso — horário de Brasília.
  // Sem isto, Date.parse usaria o fuso da máquina que roda o servidor.
  const semFuso = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(valor.trim());
  if (semFuso) {
    const [, aaaa, mm, dd, hora, minuto, segundo = "00"] = semFuso;
    const data = new Date(`${aaaa}-${mm}-${dd}T${hora}:${minuto}:${segundo}-03:00`);
    return Number.isNaN(data.getTime()) ? null : data.getTime();
  }
  const ms = Date.parse(valor);
  return Number.isNaN(ms) ? null : ms;
}

function avisoVigente(aviso, agoraMs) {
  const inicio = dataAvisoEmMs(aviso?.inicio ?? aviso?.onset);
  const fim = dataAvisoEmMs(aviso?.fim ?? aviso?.expires);
  return (inicio === null || inicio <= agoraMs) && (fim === null || fim >= agoraMs);
}

function compararAvisos(a, b, agoraMs) {
  const gravidade = prioridadeAvisoInmet(a) - prioridadeAvisoInmet(b);
  if (gravidade) return gravidade;
  const vigencia = Number(avisoVigente(a, agoraMs)) - Number(avisoVigente(b, agoraMs));
  if (vigencia) return vigencia;
  const inicio = (dataAvisoEmMs(a?.inicio ?? a?.onset) ?? -Infinity) - (dataAvisoEmMs(b?.inicio ?? b?.onset) ?? -Infinity);
  if (inicio) return inicio;
  return (dataAvisoEmMs(a?.fim ?? a?.expires) ?? -Infinity) - (dataAvisoEmMs(b?.fim ?? b?.expires) ?? -Infinity);
}

function deduplicarTextos(valores) {
  const unicos = new Map();
  for (const valor of valores.flatMap((item) => Array.isArray(item) ? item : item ? [item] : [])) {
    const texto = textoOficial(valor);
    const chave = normalizarComparacao(texto);
    if (texto && chave && !unicos.has(chave)) unicos.set(chave, texto);
  }
  return [...unicos.values()];
}

function consolidarAvisosInmet(avisos, { agora = new Date() } = {}) {
  const agoraMs = agora instanceof Date ? agora.getTime() : new Date(agora).getTime();
  const grupos = new Map();
  for (const aviso of Array.isArray(avisos) ? avisos.filter(Boolean) : []) {
    const chave = fenomenoAvisoInmet(aviso.descricao || aviso.event || aviso.evento || aviso.headline);
    if (!grupos.has(chave)) grupos.set(chave, []);
    grupos.get(chave).push(aviso);
  }

  return [...grupos.values()].map((grupo) => {
    const escolhido = grupo.reduce((melhor, candidato) =>
      compararAvisos(candidato, melhor, agoraMs) > 0 ? candidato : melhor
    );
    const consolidado = {
      ...escolhido,
      riscos: deduplicarTextos(grupo.map((aviso) => aviso.riscos || aviso.description)),
      instrucoes: deduplicarTextos(grupo.map((aviso) => aviso.instrucoes || aviso.instruction)),
    };
    if (grupo.some((aviso) => Array.isArray(aviso.geocodes))) {
      consolidado.geocodes = [...new Set(grupo.flatMap((aviso) => aviso.geocodes || []))];
    }
    return consolidado;
  });
}

// Identificador oficial do aviso. `id_aviso` é o mesmo em todas as versões
// (sequências) de um aviso; `codigo` é o identificador CAP da versão.
function identificadorAviso(aviso) {
  if (aviso?.idAviso != null) return `inmet:${aviso.idAviso}`;
  if (aviso?.id) return `cap:${String(aviso.id).replace(/\.\d+$/, "")}`;
  return null;
}

function chaveConteudoAviso(aviso) {
  return [
    fenomenoAvisoInmet(aviso.descricao),
    normalizarComparacao(aviso.severidade),
    [...new Set(aviso.geocodes || [])].sort().join(","),
    dataAvisoEmMs(aviso.inicio) ?? normalizarComparacao(aviso.inicio),
    dataAvisoEmMs(aviso.fim) ?? normalizarComparacao(aviso.fim),
    (aviso.riscos || []).map(normalizarComparacao).join("|"),
  ].join("#");
}

/**
 * Remove repetições do MESMO aviso oficial, sem fundir avisos distintos que
 * tratam do mesmo fenômeno (ao contrário de consolidarAvisosInmet, usado
 * pelo PDF/e-mail). Com identificador oficial, versões do mesmo aviso viram
 * uma só (prevalece a sequência mais recente); sem identificador, só são
 * fundidos avisos com mesmo fenômeno, classificação, área, validade e riscos.
 * Riscos e instruções de todas as cópias são preservados.
 */
function deduplicarAvisosInmet(avisos) {
  const grupos = new Map();
  const grupoPorConteudo = new Map();
  const lista = Array.isArray(avisos) ? avisos.filter(Boolean) : [];
  // Primeiro os avisos com identificador oficial; depois os sem
  // identificador, comparados por conteúdo com TODOS os grupos (inclusive os
  // identificados), para que uma cópia sem id não vire um aviso a mais.
  for (const aviso of [...lista.filter(identificadorAviso), ...lista.filter((a) => !identificadorAviso(a))]) {
    const conteudo = chaveConteudoAviso(aviso);
    const chave = identificadorAviso(aviso) || grupoPorConteudo.get(conteudo) || `conteudo:${conteudo}`;
    if (!grupos.has(chave)) grupos.set(chave, []);
    grupos.get(chave).push(aviso);
    if (!grupoPorConteudo.has(conteudo)) grupoPorConteudo.set(conteudo, chave);
  }
  return [...grupos.values()].map((grupo) => {
    const principal = grupo.reduce((atual, candidato) =>
      (candidato.sequencia ?? 0) > (atual.sequencia ?? 0) ? candidato : atual
    );
    if (grupo.length === 1) return principal;
    return {
      ...principal,
      riscos: deduplicarTextos(grupo.map((aviso) => aviso.riscos)),
      instrucoes: deduplicarTextos(grupo.map((aviso) => aviso.instrucoes)),
      geocodes: [...new Set(grupo.flatMap((aviso) => aviso.geocodes || []))],
      copiasNaFonte: grupo.length,
    };
  });
}

/** Aviso ainda aplicável: não encerrado e com término não ultrapassado. */
function avisoAplicavel(aviso, agora = new Date()) {
  if (aviso?.encerrado === true) return false;
  const fim = dataAvisoEmMs(aviso?.fim);
  return fim === null || fim >= agora.getTime();
}

function valoresGeocode(valor) {
  if (Array.isArray(valor)) return valor.flatMap(valoresGeocode);
  if (valor && typeof valor === "object") {
    return valoresGeocode(valor.value ?? valor.codigo ?? valor.codigoIbge ?? valor.geocode);
  }
  if (typeof valor !== "string" && !Number.isFinite(valor)) return [];
  return String(valor).split(/[;,\s]+/).map((item) => item.trim()).filter(Boolean);
}

function geocodesDoAviso(aviso) {
  return new Set([
    aviso.geocodes,
    aviso.geocode,
    aviso.codigosIbge,
    aviso.codigoIbge,
    aviso.area?.geocode,
    aviso.area?.geocodes,
    aviso.areas?.flatMap?.((area) => [area?.geocode, area?.geocodes]),
  ].flatMap(valoresGeocode));
}

function normalizarAviso(aviso) {
  const origem = aviso?.properties && typeof aviso.properties === "object"
    ? { ...aviso.properties, geometry: aviso.geometry }
    : aviso;
  if (!origem || typeof origem !== "object") return null;

  // `event`, `description`, `onset`, `expires` e `instruction` são os nomes
  // CAP. Os equivalentes em português preservam compatibilidade com o JSON
  // historicamente servido por /avisos/ativos. Nenhum texto é sintetizado.
  const municipios = textoOficial(origem.municipios);
  const geocodesMunicipios = municipios
    ? [...municipios.matchAll(/\((\d{7})\)/g)].map((partes) => partes[1])
    : [];
  const geocodesEstruturados = [...geocodesDoAviso(origem)];
  return {
    id: textoOficial(origem.codigo, origem.identifier),
    idAviso: textoOficial(origem.id_aviso),
    sequencia: Number.isFinite(origem.id_sequencia) ? origem.id_sequencia : null,
    encerrado: origem.encerrado === true,
    estados: textoOficial(origem.estados),
    totalMunicipios: municipios ? municipios.split(/,(?=[^,]+ - [A-Z]{2} \(\d{7}\))/).length : null,
    atualizadoEm: textoOficial(origem.updated_at, origem.sent),
    descricao: textoOficial(origem.event, origem.evento, origem.descricao, origem.headline),
    severidade: textoOficial(origem.severity, origem.severidade),
    cor: textoOficial(origem.aviso_cor, origem.cor),
    inicio: textoOficial(origem.onset, origem.inicio),
    fim: textoOficial(origem.expires, origem.fim),
    riscos: listaOficial(origem.description, origem.riscos),
    instrucoes: listaOficial(origem.instruction, origem.instrucoes),
    geocodes: [...new Set(geocodesEstruturados.length ? geocodesEstruturados : geocodesMunicipios)],
  };
}

function extrairAvisos(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];

  for (const chave of ["hoje", "avisos", "alerts", "features"]) {
    if (Array.isArray(payload[chave])) return payload[chave];
  }

  // A interface nova do INMET organiza avisos por dia. Aceita esses baldes
  // sem confundir metadados escalares com avisos.
  const porDia = Object.values(payload)
    .filter(Array.isArray)
    .flat();
  return porDia;
}

async function buscarAvisosInmet(codigoIbge, {
  agora = new Date(),
  inicioPeriodo = agora,
  fimPeriodo = null,
  fetchImpl = fetch,
  timeoutMs = INMET_AVISOS_TIMEOUT_MS,
  esperarFn,
  logger,
} = {}) {
  const url = "https://apiprevmet3.inmet.gov.br/avisos/ativos";
  const json = await buscarJsonComRetentativa(url, {
    nomeFonte: "INMET (avisos)",
    fetchImpl,
    timeoutMs,
    tentativas: INMET_TENTATIVAS,
    atrasoBaseMs: 1000,
    esperarFn,
    requestInit: { headers: HEADERS },
    logger: logger === undefined && fetchImpl === globalThis.fetch ? console : logger,
    prefixoLog: "INMET-AVISOS",
  });
  if (!json || typeof json !== "object") {
    const erro = new Error("INMET Avisos retornou payload fora do formato esperado.");
    erro.name = "ParserError";
    erro.tipo = "parser";
    erro.code = "INMET_ALERTS_INVALID_PAYLOAD";
    erro.transitorio = false;
    throw erro;
  }
  const todos = extrairAvisos(json);
  const normalizados = todos.map(normalizarAviso).filter(Boolean);
  const codigo = String(codigoIbge);
  // Só avisos cuja área abrange o município da base e que ainda valem.
  // Repetições do mesmo aviso são removidas; avisos distintos do mesmo
  // fenômeno são mantidos (a consolidação por fenômeno, se desejada, é feita
  // na renderização do PDF/e-mail).
  const inicioMs = inicioPeriodo instanceof Date ? inicioPeriodo.getTime() : Date.parse(inicioPeriodo);
  const fimMs = fimPeriodo == null
    ? null
    : fimPeriodo instanceof Date ? fimPeriodo.getTime() : Date.parse(fimPeriodo);
  const intersecaPeriodo = (aviso) => {
    if (aviso.encerrado === true) return false;
    const inicioAviso = dataAvisoEmMs(aviso.inicio);
    const fimAviso = dataAvisoEmMs(aviso.fim);
    if (Number.isFinite(fimMs) && inicioAviso !== null && inicioAviso > fimMs) return false;
    if (Number.isFinite(inicioMs) && fimAviso !== null && fimAviso < inicioMs) return false;
    return true;
  };
  const relevantes = deduplicarAvisosInmet(
    normalizados.filter((aviso) => aviso.geocodes.includes(codigo) && intersecaPeriodo(aviso))
  );

  return {
    fonte: "INMET (avisos de perigo ativos)",
    url: "https://apiprevmet3.inmet.gov.br/avisos/ativos",
    totalAvisosPais: todos.length,
    avisos: relevantes.map(({ geocodes, ...aviso }) => aviso),
  };
}

module.exports = {
  buscarPrevisaoInmet,
  buscarAvisosInmet,
  normalizarAviso,
  extrairAvisos,
  consolidarAvisosInmet,
  deduplicarAvisosInmet,
  avisoAplicavel,
  dataAvisoEmMs,
  fenomenoAvisoInmet,
  grauAvisoInmet,
  normalizarComparacao,
  INMET_TIMEOUT_MS,
  INMET_AVISOS_TIMEOUT_MS,
  INMET_TENTATIVAS,
};
