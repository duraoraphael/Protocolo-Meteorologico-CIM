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

// Campos numéricos opcionais da previsão municipal. A unidade é conferida
// antes da conversão; texto descritivo (por exemplo, "ventos fracos") não é medida.
function medidaOficial(valor, unidade, minimo, maximo) {
  if (valor == null || valor === "") return null;
  const bruto = typeof valor === "object" ? valor.valor ?? valor.value : valor;
  const unidadeRecebida = typeof valor === "object"
    ? valor.unidade ?? valor.unit ?? (unidade === "km/h" ? null : unidade)
    : unidade === "km/h" ? null : unidade;
  const partes = typeof bruto === "string"
    ? /^\s*(\d+(?:[.,]\d+)?)\s*(km\/h|kmh|m\/s|kt|nós|mm|%)?\s*$/i.exec(bruto)
    : null;
  const numero = typeof bruto === "number" ? bruto : partes ? Number(partes[1].replace(",", ".")) : NaN;
  const unidadeValor = (partes?.[2] || unidadeRecebida || "").toLowerCase();
  const unidadesVento = { "km/h": 1, kmh: 1, "m/s": 3.6, kt: 1.852, "nós": 1.852 };
  const fator = unidade === "km/h" ? unidadesVento[unidadeValor] : unidadeValor === unidade ? 1 : null;
  const convertido = fator == null ? NaN : numero * fator;
  return Number.isFinite(convertido) && convertido >= minimo && convertido <= maximo
    ? Math.round(convertido * 10) / 10 : null;
}

function primeiraMedida(p, campos, unidade, minimo, maximo) {
  for (const campo of campos) {
    if (!Object.hasOwn(p, campo)) continue;
    const bruto = p[campo];
    const declarado = unidade === "km/h" && !(bruto && typeof bruto === "object")
      ? { valor: bruto, unidade: campo.endsWith("_kmh") ? "km/h" : p.unidade_vento ?? p.vento_unidade ?? null }
      : bruto;
    const valor = medidaOficial(declarado, unidade, minimo, maximo);
    if (valor !== null) return valor;
  }
  return null;
}

function numeroPrevisto(valor, unidade, minimo, maximo) {
  if (valor == null || valor === "") return null;
  const bruto = typeof valor === "object" ? valor.valor ?? valor.value : valor;
  const declarada = typeof valor === "object" ? valor.unidade ?? valor.unit : null;
  if (declarada != null && declarada !== unidade) return null;
  let numero = bruto;
  if (typeof bruto === "string") {
    const padrao = unidade === "°C"
      ? /^\s*(-?\d+(?:[.,]\d+)?)\s*(?:°\s*c)?\s*$/i
      : /^\s*(\d+(?:[.,]\d+)?)\s*%?\s*$/;
    const partes = padrao.exec(bruto);
    if (!partes) return null;
    if (unidade === "°C" && /%/.test(bruto)) return null;
    if (unidade === "%" && /°/.test(bruto)) return null;
    numero = Number(partes[1].replace(",", "."));
  }
  return Number.isFinite(numero) && numero >= minimo && numero <= maximo ? numero : null;
}

function hojeDDMMAAAA(instante = new Date(), fuso = "America/Sao_Paulo") {
  const agora = new Date(
    instante.toLocaleString("en-US", { timeZone: fuso })
  );
  const dd = String(agora.getDate()).padStart(2, "0");
  const mm = String(agora.getMonth() + 1).padStart(2, "0");
  const yyyy = agora.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function dataIsoDeBr(dataBr) {
  const partes = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(dataBr || ""));
  return partes ? `${partes[3]}-${partes[2]}-${partes[1]}` : null;
}

function prioridadeCondicao(texto) {
  const normalizado = String(texto || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (/tempestad|trovoad|granizo/.test(normalizado)) return 6;
  if (/chuva|pancad|garoa/.test(normalizado)) return 5;
  if (/nevoeiro|neblina/.test(normalizado)) return 4;
  if (/nublad|nuvens/.test(normalizado)) return 3;
  if (/parcial|poucas/.test(normalizado)) return 2;
  if (/ceu claro|ensolarad|sol/.test(normalizado)) return 1;
  return 0;
}

function consolidarCondicaoDiaria(valores) {
  const grupos = new Map();
  for (const [indice, valor] of valores.entries()) {
    const texto = textoOficial(valor);
    const chave = String(texto || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
    if (!chave) continue;
    const grupo = grupos.get(chave) || { texto, ocorrencias: 0, prioridade: prioridadeCondicao(texto), indice };
    grupo.ocorrencias += 1;
    grupos.set(chave, grupo);
  }
  return [...grupos.values()].sort((a, b) =>
    b.ocorrencias - a.ocorrencias || b.prioridade - a.prioridade || a.indice - b.indice
  )[0]?.texto || null;
}

async function buscarPrevisaoInmet(codigoIbge, {
  agora = new Date(),
  fuso = "America/Sao_Paulo",
  municipio = null,
  uf = null,
  fetchImpl = fetch,
  timeoutMs = INMET_TIMEOUT_MS,
  esperarFn,
  logger,
} = {}) {
  const url = `https://apiprevmet3.inmet.gov.br/previsao/${codigoIbge}`;
  const json = await buscarJsonComRetentativa(url, {
    nomeFonte: "INMET (previsão)",
    fetchImpl,
    timeoutMs,
    tentativas: INMET_TENTATIVAS,
    esperarFn,
    requestInit: { headers: HEADERS },
    logger: logger === undefined && fetchImpl === globalThis.fetch ? console : logger,
    prefixoLog: "INMET-PREVISAO",
  });
  const porData = json[codigoIbge];
  if (!porData) {
    throw new Error(`INMET não retornou previsão para o código ${codigoIbge}`);
  }

  const dataAlvo = hojeDDMMAAAA(agora, fuso);
  const diaEscolhido = porData[dataAlvo];
  if (!diaEscolhido) {
    const erro = new Error(`INMET não retornou previsão para a data solicitada (${dataAlvo}).`);
    erro.name = "ParserError";
    throw erro;
  }
  for (const periodo of [diaEscolhido.manha, diaEscolhido.tarde, diaEscolhido.noite].filter(Boolean)) {
    const municipioDivergente = municipio && periodo.entidade
      && normalizarComparacao(periodo.entidade) !== normalizarComparacao(municipio);
    const ufDivergente = uf && periodo.uf && String(periodo.uf).toUpperCase() !== String(uf).toUpperCase();
    if (municipioDivergente || ufDivergente) {
      const erro = new Error(`INMET retornou localidade divergente para o código ${codigoIbge}: ${periodo.entidade || "?"}/${periodo.uf || "?"}.`);
      erro.name = "ParserError";
      erro.code = "INMET_LOCATION_MISMATCH";
      throw erro;
    }
  }

  const limpar = (p) =>
    p && {
      resumo: p.resumo || null,
      tempMax: numeroPrevisto(p.temp_max, "°C", -90, 60),
      tempMin: numeroPrevisto(p.temp_min, "°C", -90, 60),
      umidadeMax: numeroPrevisto(p.umidade_max, "%", 0, 100),
      umidadeMin: numeroPrevisto(p.umidade_min, "%", 0, 100),
      direcaoVento: p.dir_vento || null,
      intensidadeVento: p.int_vento || null,
      // O endpoint municipal não publica estes campos atualmente, mas a
      // leitura aceita nomes oficiais explícitos caso passem a ser incluídos.
      velocidadeMediaKmh: primeiraMedida(p, ["vento_velocidade_media_kmh", "vento_velocidade_media", "velocidade_media_vento", "vento_medio", "vel_vento"], "km/h", 0, 300),
      rajadaMaxKmh: primeiraMedida(p, ["rajada_max", "rajada_vento", "vento_rajada", "rajada"], "km/h", 0, 400),
      precipitacaoMm: primeiraMedida(p, ["precipitacao_mm", "chuva_mm", "acumulado_chuva_mm"], "mm", 0, 10000),
      precipitacaoHorariaMaxMm: primeiraMedida(p, ["precipitacao_horaria_max_mm", "chuva_horaria_max_mm"], "mm", 0, 1000),
      probabilidadeChuva: primeiraMedida(p, ["probabilidade_chuva", "prob_chuva", "probabilidade_precipitacao"], "%", 0, 100),
    };

  const consolidarDia = (data, valor) => {
    const periodosNomeados = valor?.manha || valor?.tarde || valor?.noite
      ? [["Manhã", valor.manha], ["Tarde", valor.tarde], ["Noite", valor.noite]].filter(([, periodo]) => periodo)
      : [["Dia", valor]].filter(([, periodo]) => periodo);
    const periodos = periodosNomeados.map(([, periodo]) => periodo);
    const valores = (campo, unidade, minimo, maximo) => periodos
      .map((periodo) => numeroPrevisto(periodo?.[campo], unidade, minimo, maximo)).filter(Number.isFinite);
    const textos = (campo) => [...new Set(periodos.map((periodo) => textoOficial(periodo?.[campo])).filter(Boolean))];
    const maximos = valores("temp_max", "°C", -90, 60);
    const minimos = valores("temp_min", "°C", -90, 60);
    const umidadesMax = valores("umidade_max", "%", 0, 100);
    const umidadesMin = valores("umidade_min", "%", 0, 100);
    const rajadas = periodos
      .map((periodo) => primeiraMedida(periodo, ["rajada_max", "rajada_vento", "vento_rajada", "rajada"], "km/h", 0, 400))
      .filter(Number.isFinite);
    const precipitacoesPorPeriodo = periodos.map((periodo) =>
      primeiraMedida(periodo, ["precipitacao_mm", "chuva_mm", "acumulado_chuva_mm"], "mm", 0, 10000));
    return {
      data: dataIsoDeBr(data),
      dataBr: data,
      tempMax: maximos.length ? Math.max(...maximos) : null,
      tempMin: minimos.length ? Math.min(...minimos) : null,
      umidadeMax: umidadesMax.length ? Math.max(...umidadesMax) : null,
      umidadeMin: umidadesMin.length ? Math.min(...umidadesMin) : null,
      resumo: consolidarCondicaoDiaria(periodos.map((periodo) => periodo?.resumo)),
      direcaoVento: textos("dir_vento").join(" / ") || null,
      intensidadeVento: textos("int_vento").join(" / ") || null,
      rajadaMaxKmh: rajadas.length ? Math.max(...rajadas) : null,
      precipitacaoMm: precipitacoesPorPeriodo.length && precipitacoesPorPeriodo.every(Number.isFinite)
        ? Math.round(precipitacoesPorPeriodo.reduce((soma, item) => soma + item, 0) * 10) / 10
        : null,
    };
  };

  return {
    fonte: "INMET (previsão oficial)",
    url: `https://previsao.inmet.gov.br/${codigoIbge}`,
    data: dataAlvo,
    consultadoEm: new Date().toISOString(),
    dias: Object.entries(porData)
      .map(([data, valor]) => consolidarDia(data, valor))
      .filter((dia) => dia.data)
      .sort((a, b) => a.data.localeCompare(b.data)),
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

// Para superfícies operacionais, avisos sobrepostos do mesmo fenômeno devem
// produzir uma única classificação. Mantém integralmente o registro oficial
// escolhido (sem misturar riscos ou instruções de avisos menos graves).
function selecionarAvisosInmet(avisos, { agora = new Date() } = {}) {
  const agoraMs = agora instanceof Date ? agora.getTime() : new Date(agora).getTime();
  const grupos = [];
  const sobrepoe = (a, b) => {
    const inicioA = dataAvisoEmMs(a.inicio ?? a.onset);
    const fimA = dataAvisoEmMs(a.fim ?? a.expires);
    const inicioB = dataAvisoEmMs(b.inicio ?? b.onset);
    const fimB = dataAvisoEmMs(b.fim ?? b.expires);
    if ([inicioA, fimA, inicioB, fimB].some((valor) => valor === null)) return true;
    return inicioA <= fimB && inicioB <= fimA;
  };

  for (const aviso of Array.isArray(avisos) ? avisos.filter(Boolean) : []) {
    const chave = fenomenoAvisoInmet(aviso.descricao || aviso.event || aviso.evento || aviso.headline);
    const correspondentes = grupos
      .map((grupo, indice) => ({ grupo, indice }))
      .filter(({ grupo }) => grupo.chave === chave && grupo.avisos.some((item) => sobrepoe(item, aviso)));
    if (!correspondentes.length) {
      grupos.push({ chave, avisos: [aviso] });
      continue;
    }

    const principal = correspondentes[0].grupo;
    principal.avisos.push(aviso);
    for (const { grupo, indice } of correspondentes.slice(1).reverse()) {
      principal.avisos.push(...grupo.avisos);
      grupos.splice(indice, 1);
    }
  }

  return grupos.map(({ avisos: grupo }) => grupo.reduce((melhor, candidato) =>
    compararAvisos(candidato, melhor, agoraMs) > 0 ? candidato : melhor
  ));
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
  selecionarAvisosInmet,
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
