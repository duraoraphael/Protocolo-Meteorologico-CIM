// Monitor de Secas (ANA) — acompanhamento MENSAL da seca, não previsão.
//
// O portal https://monitordesecas.ana.gov.br/ é uma SPA (Angular) sem
// conteúdo no HTML inicial. Esta coleta repete as requisições públicas e
// anônimas que a própria página faz (verificado no bundle main-es2015 e nas
// respostas reais em 15/10/2026), sem autenticação e sem contornar bloqueios:
//
// 1. Meses disponíveis — a página /srm/municipio/:uf lista os prefixos do
//    bucket público ana-monitor-secas-files (S3 ListObjectsV2):
//      ?list-type=2&prefix=uploads/produtos/srm_persist/&delimiter=/
// 2. Mapa ESTADUAL — a mesma página exibe, para a UF e o mês escolhidos,
//      uploads/produtos/srm_persist/AAAAMM/ms/ms_<alias>_AAAAMM.png
//    (alias da tabela de UFs do próprio site). A listagem da pasta ms/ traz
//    tamanho e ETag (MD5) de cada arquivo, usados para validar o download.
// 3. Texto e áreas por UF — API pública apimsbr.ana.gov.br/rest/cms-msne/
//    mapa-monitor do mesmo mês: `descricao` e `area` com tipo_area 1 (UF) e
//    chave = código IBGE da UF — o mesmo filtro da página de estatísticas
//    (rpc/v1/dados-tabulares-monitor?tipo_area=1&area=<IBGE>).
//
// Mapa e texto vêm sempre do MESMO mês. A publicação mais recente é a do mês
// mais novo que tenha, ao mesmo tempo, mapa final na API e mapas estaduais no
// bucket. A verificação de novas publicações roda no máximo uma vez a cada
// MONITOR_SECAS_INTERVALO_HORAS; entre verificações, cada UF usa a cópia
// validada em data/monitor-secas/AAAA-MM/ufs/<UF>.png, compartilhada por todas
// as bases do mesmo estado. Só a UF pedida é baixada.
//
// A fonte publica análise ESTADUAL; não há classificação por município.
const fs = require("node:fs");
const path = require("node:path");
const tls = require("node:tls");
const zlib = require("node:zlib");
const crypto = require("node:crypto");
const { Agent } = require("undici");
const { registrarFalha } = require("./sourceHealth");

const API_URL = "https://apimsbr.ana.gov.br/rest/cms-msne/mapa-monitor";
const BUCKET_URL = "https://ana-monitor-secas-files.s3.sa-east-1.amazonaws.com";
const PREFIXO_PRODUTOS = "uploads/produtos/srm_persist/";
const PORTAL_URL = "https://monitordesecas.ana.gov.br/";
const CLASSIFICACAO_URL = "https://monitordesecas.ana.gov.br/tabela-de-classificacao";
const PASTA_CACHE = path.join(__dirname, "..", "..", "data", "monitor-secas");
const LIMITE_JSON = 2_000_000;
const LIMITE_XML = 2_000_000;
const LIMITE_PNG = 15_000_000;
const DIMENSAO_MINIMA = 800;
const VERSAO_CACHE = 3;
const INTERVALO_PADRAO_HORAS = 12;
const MESES_TENTADOS = 3;

const MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

// Categorias e cores conforme a legenda/QML oficiais do Monitor de Secas.
const CATEGORIAS = Object.freeze({
  si: { codigo: "—", nome: "Sem Seca Relativa", cor: "#FFFFFF" },
  s0: { codigo: "S0", nome: "Seca Fraca", cor: "#FFFF00" },
  s1: { codigo: "S1", nome: "Seca Moderada", cor: "#FFD37F" },
  s2: { codigo: "S2", nome: "Seca Grave", cor: "#E67300" },
  s3: { codigo: "S3", nome: "Seca Extrema", cor: "#E60000" },
  s4: { codigo: "S4", nome: "Seca Excepcional", cor: "#730000" },
});

// Código IBGE, nome e alias de arquivo de cada UF. O alias é o da tabela de
// UFs do próprio portal (usado nos nomes ms_<alias>_AAAAMM.png).
const UFS = Object.freeze({
  RO: [11, "Rondônia", "rondonia"], AC: [12, "Acre", "acre"], AM: [13, "Amazonas", "amazonas"],
  RR: [14, "Roraima", "roraima"], PA: [15, "Pará", "para"], AP: [16, "Amapá", "amapa"],
  TO: [17, "Tocantins", "tocantins"], MA: [21, "Maranhão", "maranhao"], PI: [22, "Piauí", "piaui"],
  CE: [23, "Ceará", "ceara"], RN: [24, "Rio Grande do Norte", "rio_grande_do_norte"],
  PB: [25, "Paraíba", "paraiba"], PE: [26, "Pernambuco", "pernambuco"], AL: [27, "Alagoas", "alagoas"],
  SE: [28, "Sergipe", "sergipe"], BA: [29, "Bahia", "bahia"], MG: [31, "Minas Gerais", "minas_gerais"],
  ES: [32, "Espírito Santo", "espirito_santo"], RJ: [33, "Rio de Janeiro", "rio_de_janeiro"],
  SP: [35, "São Paulo", "sao_paulo"], PR: [41, "Paraná", "parana"], SC: [42, "Santa Catarina", "santa_catarina"],
  RS: [43, "Rio Grande do Sul", "rio_grande_do_sul"], MS: [50, "Mato Grosso do Sul", "mato_grosso_do_sul"],
  MT: [51, "Mato Grosso", "mato_grosso"], GO: [52, "Goiás", "goias"], DF: [53, "Distrito Federal", "distrito_federal"],
});

// --- Competência -----------------------------------------------------------

function competenciaDeChave(texto) {
  const partes = String(texto || "").trim().match(/^(\d{4})-(\d{2})$/);
  const ano = partes && Number(partes[1]);
  const mes = partes && Number(partes[2]);
  if (!partes || mes < 1 || mes > 12 || ano < 2014) {
    throw new Error(`Competência inválida: "${texto}" (use AAAA-MM).`);
  }
  return { mes, ano, chave: `${ano}-${String(mes).padStart(2, "0")}`, rotulo: `${MESES[mes - 1]}/${ano}` };
}

/**
 * Competência fixada por MONITOR_SECAS_COMPETENCIA (AAAA-MM), ou `null` no
 * modo normal, em que a publicação mais recente é descoberta na fonte.
 */
function competenciaConfigurada(valor = process.env.MONITOR_SECAS_COMPETENCIA) {
  if (!String(valor || "").trim()) return null;
  try { return competenciaDeChave(valor); }
  catch { throw new Error(`MONITOR_SECAS_COMPETENCIA inválida: "${valor}" (use AAAA-MM).`); }
}

function intervaloVerificacaoMs(valor = process.env.MONITOR_SECAS_INTERVALO_HORAS) {
  const horas = String(valor ?? "").trim() === "" ? INTERVALO_PADRAO_HORAS : Number(valor);
  return Number.isFinite(horas) && horas >= 0 ? horas * 3_600_000 : INTERVALO_PADRAO_HORAS * 3_600_000;
}

const aaaamm = (comp) => `${comp.ano}${String(comp.mes).padStart(2, "0")}`;

function urlPaginaMapa({ mes, ano }) {
  return `https://monitordesecas.ana.gov.br/mapa?mes=${mes}&ano=${ano}`;
}

// Página do portal com o mapa estadual da UF no mês (parâmetro `data` MM/AAAA).
function urlPaginaUf(comp, uf) {
  return `https://monitordesecas.ana.gov.br/srm/municipio/${uf}?data=${String(comp.mes).padStart(2, "0")}/${comp.ano}`;
}

function urlApi({ mes, ano }) {
  return `${API_URL}?mes=${mes}&ano=${ano}&final=true&response_format=apil5&use_fk=true&include_all_obj_fk=true&limit=1&orderBy=id,desc`;
}

function urlListagem(prefixo, { delimitador = false, continuacao = null } = {}) {
  const params = new URLSearchParams({ "list-type": "2", prefix: prefixo });
  if (delimitador) params.set("delimiter", "/");
  if (continuacao) params.set("continuation-token", continuacao);
  return `${BUCKET_URL}/?${params.toString()}`;
}

const prefixoMapasUf = (comp) => `${PREFIXO_PRODUTOS}${aaaamm(comp)}/ms/`;

function chaveMapaUf(comp, uf) {
  const alias = UFS[uf]?.[2];
  if (!alias) throw new Error(`UF desconhecida: ${uf}`);
  return `${prefixoMapasUf(comp)}ms_${alias}_${aaaamm(comp)}.png`;
}

const urlMapaUf = (comp, uf) => `${BUCKET_URL}/${chaveMapaUf(comp, uf)}`;

// --- HTTP ------------------------------------------------------------------

// Mesmo critério do Clima e Saúde: confia nas CAs do sistema (proxy
// corporativo) sem desligar a validação TLS.
let agenteSistema;
function dispatcherSistema() {
  if (agenteSistema === undefined) {
    const ca = tls.getCACertificates?.("system") || [];
    agenteSistema = ca.length ? new Agent({ connect: { ca } }) : null;
  }
  return agenteSistema;
}

async function baixar(url, { fetchFn = fetch, limite, tipo, timeoutMs = 20000, tentativas = 2, contexto = "" } = {}) {
  let ultimoErro;
  for (let i = 1; i <= tentativas; i++) {
    try {
      const resposta = await fetchFn(url, {
        signal: AbortSignal.timeout(timeoutMs),
        redirect: "error",
        ...(fetchFn === globalThis.fetch && dispatcherSistema() ? { dispatcher: dispatcherSistema() } : {}),
        headers: {
          "User-Agent": "Protocolo-Meteorologico-CIM/1.0 (consulta publica institucional)",
          Referer: "https://monitordesecas.ana.gov.br/",
        },
      });
      if (resposta.status !== 200) throw Object.assign(new Error(`HTTP ${resposta.status} em ${url}`), { httpStatus: resposta.status });
      const buffer = Buffer.from(await resposta.arrayBuffer());
      if (buffer.length === 0) throw new Error(`Resposta vazia em ${url}`);
      if (limite && buffer.length > limite) throw new Error(`${tipo || "Arquivo"} maior que o limite (${buffer.length} bytes).`);
      console.log(`[MONITOR-SECAS]${contexto} ${tipo || "Download"}: HTTP 200, ${buffer.length} bytes — ${url}`);
      return buffer;
    } catch (erro) {
      ultimoErro = erro;
      console.warn(`[MONITOR-SECAS]${contexto} Tentativa ${i}/${tentativas} falhou (${tipo || "download"}) fonte=${url}: ${erro.message}`);
      if (i < tentativas) await new Promise((resolve) => setTimeout(resolve, 1500 * i));
    }
  }
  throw ultimoErro;
}

// --- Listagem do bucket (S3 ListObjectsV2, XML) -----------------------------

function textoXml(bloco, tag) {
  const m = bloco.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  return m ? m[1].replace(/&quot;/g, "\"").replace(/&amp;/g, "&").trim() : null;
}

function interpretarListagemS3(xml) {
  const texto = String(xml || "");
  if (!/<ListBucketResult[\s>]/.test(texto)) throw new Error("Listagem do bucket da ANA fora do formato esperado.");
  const prefixos = [...texto.matchAll(/<CommonPrefixes>([\s\S]*?)<\/CommonPrefixes>/g)].map((m) => textoXml(m[1], "Prefix")).filter(Boolean);
  const arquivos = [...texto.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)].map((m) => ({
    chave: textoXml(m[1], "Key"),
    tamanho: Number(textoXml(m[1], "Size")),
    etag: (textoXml(m[1], "ETag") || "").replace(/"/g, "").toLowerCase(),
    modificadoEm: textoXml(m[1], "LastModified"),
  })).filter((a) => a.chave);
  return { prefixos, arquivos, truncada: textoXml(texto, "IsTruncated") === "true", continuacao: textoXml(texto, "NextContinuationToken") };
}

async function listarBucket(prefixo, { fetchFn, delimitador = false, contexto = "" }) {
  const resultado = { prefixos: [], arquivos: [] };
  let continuacao = null;
  for (let pagina = 0; pagina < 10; pagina++) {
    const xml = await baixar(urlListagem(prefixo, { delimitador, continuacao }), { fetchFn, limite: LIMITE_XML, tipo: "Listagem do bucket", contexto });
    const parte = interpretarListagemS3(xml.toString("utf8"));
    resultado.prefixos.push(...parte.prefixos);
    resultado.arquivos.push(...parte.arquivos);
    if (!parte.truncada) return resultado;
    if (!parte.continuacao) throw new Error("Listagem do bucket truncada sem token de continuação.");
    continuacao = parte.continuacao;
  }
  throw new Error("Listagem do bucket excedeu o limite de páginas.");
}

/** Meses (AAAAMM) com produtos estaduais publicados, do mais novo ao mais antigo. */
async function listarMesesPublicados({ fetchFn }) {
  const { prefixos } = await listarBucket(PREFIXO_PRODUTOS, { fetchFn, delimitador: true });
  return [...new Set(prefixos
    .map((p) => p.slice(PREFIXO_PRODUTOS.length).replace(/\/$/, ""))
    .filter((m) => /^\d{6}$/.test(m)))]
    .sort().reverse();
}

/** Índice UF → arquivo do mapa estadual do mês (sem baixar as imagens). */
async function listarMapasUf(comp, { fetchFn }) {
  const { arquivos } = await listarBucket(prefixoMapasUf(comp), { fetchFn });
  const porChave = new Map(arquivos.map((a) => [a.chave, a]));
  const indice = {};
  for (const uf of Object.keys(UFS)) {
    const arquivo = porChave.get(chaveMapaUf(comp, uf));
    if (arquivo && arquivo.tamanho > 0) indice[uf] = arquivo;
  }
  return indice;
}

// --- Texto e áreas oficiais (API) ------------------------------------------

function textoLimpo(html) {
  return String(html || "")
    .replace(/<\/p>|<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+/g, " ")
    .split("\n").map((l) => l.trim()).filter(Boolean).join("\n");
}

// `area` traz, por categoria, a área ACUMULADA em centésimos de ponto
// percentual (S0 = S0–S4, S1 = S1–S4, …). É a leitura feita pelo próprio
// portal: área/100 = % acumulado; categoria isolada = diferença entre
// acumulados; sem seca relativa = 100 − (S0–S4).
function percentuaisArea(acumulado) {
  const valores = ["S0", "S1", "S2", "S3", "S4"].map((c) => acumulado?.[c]);
  if (!valores.every((v) => Number.isInteger(v) && v >= 0 && v <= 10000)) return null;
  if (valores.some((v, i) => i > 0 && v > valores[i - 1])) return null;
  const pct = (v) => Math.round(v) / 100;
  return {
    si: pct(10000 - valores[0]),
    s0: pct(valores[0] - valores[1]),
    s1: pct(valores[1] - valores[2]),
    s2: pct(valores[2] - valores[3]),
    s3: pct(valores[3] - valores[4]),
    s4: pct(valores[4]),
  };
}

function interpretarApi(json, competencia) {
  const mapa = json?.data?.list?.[0];
  if (!mapa) throw new Error(`A ANA não publicou mapa final para ${competencia.rotulo}.`);
  // Nunca aceita outro mês como se fosse o pedido.
  if (Number(mapa.mes) !== competencia.mes || Number(mapa.ano) !== competencia.ano) {
    throw new Error(`A API devolveu ${mapa.mes}/${mapa.ano} em vez de ${competencia.mes}/${competencia.ano}.`);
  }
  if (mapa.final !== true) throw new Error(`O mapa de ${competencia.rotulo} ainda não é a versão final.`);
  const nomeEsperado = `${MESES[competencia.mes - 1]} de ${competencia.ano}`.toLowerCase();
  if (String(mapa.nome || "").trim().toLowerCase() !== nomeEsperado) {
    throw new Error(`Nome do mapa ("${mapa.nome}") não corresponde a ${competencia.rotulo}.`);
  }
  const descricoesUf = {};
  for (const d of mapa.descricao || []) {
    if (Number(d.tipo_area) === 1 && Number(d.mapa_id) === Number(mapa.id) && d.descricao) {
      descricoesUf[String(d.area)] = textoLimpo(d.descricao);
    }
  }
  const acumulados = {};
  for (const a of mapa.area || []) {
    if (Number(a.tipo_area) !== 1 || Number(a.mapa_id) !== Number(mapa.id) || !/^S[0-4]$/.test(a.categoria)) continue;
    (acumulados[String(a.area_id)] ??= {})[a.categoria] = Number(a.area);
  }
  const areasUf = {};
  for (const [codigo, acumulado] of Object.entries(acumulados)) {
    const percentuais = percentuaisArea(acumulado);
    if (percentuais) areasUf[codigo] = percentuais;
  }
  return {
    mapaId: mapa.id,
    nome: mapa.nome,
    dataElaboracao: mapa.data_criacao || null,
    descricoesUf,
    areasUf,
  };
}

async function consultarApi(comp, { fetchFn, contexto = "" }) {
  const buffer = await baixar(urlApi(comp), { fetchFn, limite: LIMITE_JSON, tipo: "API mapa-monitor", contexto });
  let json;
  try { json = JSON.parse(buffer.toString("utf8")); }
  catch { throw new Error("Resposta da API do Monitor de Secas não é JSON válido."); }
  return interpretarApi(json, comp);
}

// --- Validação do PNG --------------------------------------------------------

const ASSINATURA_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CANAIS_PNG = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

function pngValido(buffer) {
  return Buffer.isBuffer(buffer) && buffer.length > 24 && buffer.subarray(0, 8).equals(ASSINATURA_PNG);
}

/**
 * Confere que o PNG chegou inteiro: assinatura, CRC de todos os blocos, IEND
 * no fim e dados de imagem que descompactam no tamanho exato declarado.
 */
function validarPngCompleto(buffer) {
  if (!pngValido(buffer)) throw new Error("O arquivo não é um PNG válido.");
  let pos = 8;
  let ihdr = null;
  const idat = [];
  let fim = false;
  while (pos + 12 <= buffer.length) {
    const tamanho = buffer.readUInt32BE(pos);
    const tipo = buffer.toString("latin1", pos + 4, pos + 8);
    if (pos + 12 + tamanho > buffer.length) throw new Error(`PNG truncado no bloco ${tipo}.`);
    const dados = buffer.subarray(pos + 8, pos + 8 + tamanho);
    if (zlib.crc32(buffer.subarray(pos + 4, pos + 8 + tamanho)) !== buffer.readUInt32BE(pos + 8 + tamanho)) {
      throw new Error(`PNG corrompido (CRC inválido no bloco ${tipo}).`);
    }
    if (tipo === "IHDR") ihdr = { largura: dados.readUInt32BE(0), altura: dados.readUInt32BE(4), bits: dados[8], cor: dados[9], entrelacado: dados[12] };
    else if (tipo === "IDAT") idat.push(dados);
    pos += 12 + tamanho;
    if (tipo === "IEND") { fim = true; break; }
  }
  if (!ihdr || !idat.length || !fim) throw new Error("PNG incompleto (sem IHDR, IDAT ou IEND).");
  const canais = CANAIS_PNG[ihdr.cor];
  if (!canais) throw new Error(`PNG com tipo de cor inesperado (${ihdr.cor}).`);
  let bruto;
  try { bruto = zlib.inflateSync(Buffer.concat(idat)); }
  catch (erro) { throw new Error(`Dados de imagem do PNG não descompactam: ${erro.message}`); }
  if (ihdr.entrelacado === 0) {
    const esperado = ihdr.altura * (1 + Math.ceil((ihdr.largura * canais * ihdr.bits) / 8));
    if (bruto.length !== esperado) throw new Error(`PNG incompleto: ${bruto.length} de ${esperado} bytes de imagem.`);
  }
  return { largura: ihdr.largura, altura: ihdr.altura };
}

const sha256 = (buffer) => crypto.createHash("sha256").update(buffer).digest("hex");
const md5 = (buffer) => crypto.createHash("md5").update(buffer).digest("hex");

// --- Armazenamento -----------------------------------------------------------
//
// <pasta>/verificacao.json          última verificação bem-sucedida da fonte
// <pasta>/AAAA-MM/dados.json         textos, áreas e índice de mapas por UF
// <pasta>/AAAA-MM/ufs/<UF>.png|json  mapa estadual validado e seus metadados
//
// Tudo é gravado em arquivo temporário e renomeado só depois de validado; uma
// coleta com falha nunca sobrescreve a cópia anterior.

function gravarAtomico(arquivo, conteudo) {
  fs.mkdirSync(path.dirname(arquivo), { recursive: true });
  const tmp = `${arquivo}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  fs.writeFileSync(tmp, conteudo);
  fs.renameSync(tmp, arquivo);
}

function lerJson(arquivo) {
  try { return JSON.parse(fs.readFileSync(arquivo, "utf8")); }
  catch (erro) {
    if (erro.code !== "ENOENT") console.warn(`[MONITOR-SECAS] Arquivo ignorado (${arquivo}): ${erro.message}`);
    return null;
  }
}

function lerVerificacao(pasta) {
  const v = lerJson(path.join(pasta, "verificacao.json"));
  if (v?.versao !== VERSAO_CACHE || !Number.isFinite(Date.parse(v.verificadoEm))) return null;
  try { return { ...v, competencia: competenciaDeChave(v.competencia?.chave) }; }
  catch { return null; }
}

function lerMeta(comp, pasta) {
  const meta = lerJson(path.join(pasta, comp.chave, "dados.json"));
  if (meta?.versao !== VERSAO_CACHE || meta.competencia?.chave !== comp.chave ||
      meta.competencia?.mes !== comp.mes || meta.competencia?.ano !== comp.ano) return null;
  return meta;
}

function lerMapaUf(comp, uf, pasta) {
  const dir = path.join(pasta, comp.chave, "ufs");
  const info = lerJson(path.join(dir, `${uf}.json`));
  if (info?.versao !== VERSAO_CACHE || info.uf !== uf || info.competencia?.chave !== comp.chave || info.chave !== chaveMapaUf(comp, uf)) return null;
  try {
    const png = fs.readFileSync(path.join(dir, `${uf}.png`));
    return pngValido(png) && sha256(png) === info.sha256 ? info : null;
  } catch {
    return null;
  }
}

function competenciasArmazenadas(pasta) {
  try {
    return fs.readdirSync(pasta).filter((n) => /^\d{4}-\d{2}$/.test(n)).sort().reverse()
      .map((chave) => { try { return competenciaDeChave(chave); } catch { return null; } }).filter(Boolean);
  } catch {
    return [];
  }
}

/** Última publicação com mapa e texto válidos armazenados para a UF. */
function ultimaCopiaValidaUf(uf, pasta) {
  for (const comp of competenciasArmazenadas(pasta)) {
    const meta = lerMeta(comp, pasta);
    const mapa = meta && lerMapaUf(comp, uf, pasta);
    if (mapa) return { competencia: comp, meta, mapa };
  }
  return null;
}

// --- Coleta ------------------------------------------------------------------

// Descobre a publicação mais recente com mapa final na API E mapas estaduais
// no bucket, do mesmo mês. Grava os metadados do mês só depois de validados.
async function descobrirPublicacao({ fetchFn = fetch, pasta = PASTA_CACHE, gravar = true } = {}) {
  const meses = await listarMesesPublicados({ fetchFn });
  if (!meses.length) throw new Error("A listagem do bucket da ANA não trouxe nenhum mês com produtos estaduais.");
  const falhas = [];
  for (const mes of meses.slice(0, MESES_TENTADOS)) {
    const comp = competenciaDeChave(`${mes.slice(0, 4)}-${mes.slice(4)}`);
    try {
      const meta = await coletarMeta(comp, { fetchFn, pasta, gravar });
      return { competencia: comp, meta };
    } catch (erro) {
      falhas.push(`${comp.chave}: ${erro.message}`);
      console.warn(`[MONITOR-SECAS] período=${comp.chave} descartado na descoberta: ${erro.message}`);
    }
  }
  throw new Error(`Nenhuma publicação recente completa (API + mapas estaduais). ${falhas.join(" | ")}`);
}

async function coletarMeta(comp, { fetchFn, pasta, gravar = true }) {
  const contexto = ` período=${comp.chave}`;
  const api = await consultarApi(comp, { fetchFn, contexto });
  const mapasUf = await listarMapasUf(comp, { fetchFn });
  if (!Object.keys(mapasUf).length) throw new Error(`Bucket sem mapas estaduais para ${comp.rotulo}.`);
  const meta = {
    versao: VERSAO_CACHE,
    competencia: comp,
    ...api,
    mapasUf,
    coletadoEm: new Date().toISOString(),
    urls: { api: urlApi(comp), listagem: urlListagem(prefixoMapasUf(comp)), pagina: urlPaginaMapa(comp) },
  };
  if (gravar) gravarAtomico(path.join(pasta, comp.chave, "dados.json"), JSON.stringify(meta, null, 2));
  console.log(`[MONITOR-SECAS]${contexto} metadados validados: mapa id ${api.mapaId}, elaborado em ${api.dataElaboracao}, ${Object.keys(mapasUf).length} mapas estaduais no bucket.`);
  return meta;
}

async function coletarMapaUf(comp, meta, uf, { fetchFn, pasta }) {
  const contexto = ` UF=${uf} período=${comp.chave}`;
  const arquivo = meta.mapasUf?.[uf];
  if (!arquivo) throw new Error(`A ANA não publicou o mapa estadual de ${uf} para ${comp.rotulo} (${chaveMapaUf(comp, uf)} ausente na listagem).`);
  const url = urlMapaUf(comp, uf);
  const png = await baixar(url, { fetchFn, limite: LIMITE_PNG, tipo: "Mapa estadual PNG", contexto });
  const { largura, altura } = validarPngCompleto(png);
  if (largura < DIMENSAO_MINIMA || altura < DIMENSAO_MINIMA) throw new Error(`Mapa estadual com dimensões inesperadas (${largura}×${altura}).`);
  if (Number.isFinite(arquivo.tamanho) && png.length !== arquivo.tamanho) {
    throw new Error(`Download incompleto: ${png.length} de ${arquivo.tamanho} bytes.`);
  }
  // ETag simples do S3 é o MD5 do objeto (uploads multipart têm "-N").
  if (/^[0-9a-f]{32}$/.test(arquivo.etag || "") && md5(png) !== arquivo.etag) {
    throw new Error("Conteúdo do mapa difere do publicado no bucket (MD5 ≠ ETag).");
  }
  const info = {
    versao: VERSAO_CACHE,
    uf,
    nomeUf: UFS[uf][1],
    competencia: comp,
    chave: chaveMapaUf(comp, uf),
    url,
    bytes: png.length,
    largura,
    altura,
    sha256: sha256(png),
    etag: arquivo.etag || null,
    publicadoEm: arquivo.modificadoEm || null,
    coletadoEm: new Date().toISOString(),
  };
  const dir = path.join(pasta, comp.chave, "ufs");
  gravarAtomico(path.join(dir, `${uf}.png`), png);
  gravarAtomico(path.join(dir, `${uf}.json`), JSON.stringify(info, null, 2));
  mapasEmMemoria.delete(`${pasta}|${comp.chave}|${uf}`);
  console.log(`[MONITOR-SECAS]${contexto} mapa estadual validado e armazenado (${largura}×${altura}, ${png.length} bytes) fonte=${url}`);
  return info;
}

// Uma única coleta em andamento por chave (bases da mesma UF em paralelo
// reaproveitam o mesmo download).
const emAndamento = new Map();
function unica(chave, fn) {
  if (!emAndamento.has(chave)) emAndamento.set(chave, fn().finally(() => emAndamento.delete(chave)));
  return emAndamento.get(chave);
}

function montarResultado({ comp, meta, mapa, uf, status, verificadoEm, aviso }) {
  const [codigo, nomeUf] = UFS[uf];
  return {
    status,
    uf,
    nomeUf,
    competencia: comp,
    mensagem: status === "operacional"
      ? `Mapa estadual coletado da fonte oficial em ${mapa.coletadoEm}.`
      : `Cópia validada de ${comp.rotulo}, coletada em ${mapa.coletadoEm}.`,
    aviso: aviso || null,
    mapaId: meta.mapaId,
    dataElaboracao: meta.dataElaboracao,
    coletadoEm: mapa.coletadoEm,
    verificadoEm: verificadoEm || null,
    mapaUf: { chave: mapa.chave, url: mapa.url, sha256: mapa.sha256, largura: mapa.largura, altura: mapa.altura },
    urls: {
      portal: PORTAL_URL,
      classificacao: CLASSIFICACAO_URL,
      pagina: urlPaginaUf(comp, uf),
      api: urlApi(comp),
      listagem: urlListagem(prefixoMapasUf(comp)),
      mapa: mapa.url,
    },
    resumosUf: [{
      uf,
      nome: nomeUf,
      texto: meta.descricoesUf?.[String(codigo)] || null,
      percentuais: meta.areasUf?.[String(codigo)] || null,
    }],
  };
}

function indisponivel(uf, mensagem, comp = null) {
  return {
    status: "indisponivel",
    uf,
    nomeUf: UFS[uf]?.[1] || null,
    competencia: comp,
    mensagem,
    urls: { portal: PORTAL_URL, classificacao: CLASSIFICACAO_URL, ...(UFS[uf] && comp ? { pagina: urlPaginaUf(comp, uf) } : {}) },
  };
}

// O PDF roda sem rede: o mapa entra como data: URI lido da cópia validada.
// O caminho sai só da chave AAAA-MM e da sigla validadas, nunca do report.
const mapasEmMemoria = new Map();
function mapaUfDataUri(competencia, uf, pasta = PASTA_CACHE) {
  const chave = competencia?.chave;
  if (typeof chave !== "string" || !/^\d{4}-\d{2}$/.test(chave) || !UFS[uf]) return null;
  const idCache = `${pasta}|${chave}|${uf}`;
  if (mapasEmMemoria.has(idCache)) return mapasEmMemoria.get(idCache);
  let comp;
  try { comp = competenciaDeChave(chave); } catch { return null; }
  const info = lerMapaUf(comp, uf, pasta);
  if (!info) return null;
  const png = fs.readFileSync(path.join(pasta, chave, "ufs", `${uf}.png`));
  const uri = `data:image/png;base64,${png.toString("base64")}`;
  mapasEmMemoria.set(idCache, uri);
  return uri;
}

/**
 * Monitor de Secas da UF informada, na publicação mais recente disponível.
 * Nunca lança. Em falha usa a última cópia válida da mesma UF (status
 * "nao_confirmado"); sem cópia, devolve status "indisponivel".
 */
async function obterMonitorSecas({
  uf,
  competencia,
  fetchFn = fetch,
  pasta = PASTA_CACHE,
  agora = new Date(),
  intervaloMs = intervaloVerificacaoMs(),
} = {}) {
  const sigla = String(uf || "").toUpperCase();
  if (!UFS[sigla]) {
    console.error(`[MONITOR-SECAS][ERRO] UF=${uf || "—"} sem mapeamento para o Monitor de Secas.`);
    return indisponivel(sigla, "UF da base sem correspondência no Monitor de Secas.");
  }

  let fixa = competencia || null;
  if (!fixa) {
    try { fixa = competenciaConfigurada(); }
    catch (erro) { console.error(`[MONITOR-SECAS][ERRO] ${erro.message} Usando a publicação mais recente da fonte.`); }
  }

  let comp = fixa;
  let verificadoEm = null;
  let falha = null;
  if (!fixa) {
    const anterior = lerVerificacao(pasta);
    const vencida = !anterior || agora.getTime() - Date.parse(anterior.verificadoEm) >= intervaloMs;
    if (vencida) {
      try {
        const achado = await unica(`${pasta}|verificacao`, () => descobrirPublicacao({ fetchFn, pasta }));
        comp = achado.competencia;
        verificadoEm = agora.toISOString();
        gravarAtomico(path.join(pasta, "verificacao.json"), JSON.stringify({ versao: VERSAO_CACHE, verificadoEm, competencia: comp, fonte: urlListagem(PREFIXO_PRODUTOS, { delimitador: true }) }, null, 2));
        console.log(`[MONITOR-SECAS] Publicação mais recente confirmada: ${comp.rotulo} (próxima verificação em ${intervaloMs / 3_600_000} h).`);
      } catch (erro) {
        falha = erro;
        registrarFalha(`MONITOR-SECAS:${sigla}`, erro);
        console.error(`[MONITOR-SECAS][ERRO] UF=${sigla} período=${anterior?.competencia?.chave || "desconhecido"} fonte=${urlListagem(PREFIXO_PRODUTOS, { delimitador: true })} motivo=Verificação de novas publicações falhou: ${erro.message}`);
        comp = anterior?.competencia || null;
        verificadoEm = anterior?.verificadoEm || null;
      }
    } else {
      comp = anterior.competencia;
      verificadoEm = anterior.verificadoEm;
    }
  }

  if (comp) {
    try {
      const meta = lerMeta(comp, pasta) || await unica(`${pasta}|${comp.chave}|meta`, () => coletarMeta(comp, { fetchFn, pasta }));
      let mapa = lerMapaUf(comp, sigla, pasta);
      let novo = false;
      if (!mapa) {
        mapa = await unica(`${pasta}|${comp.chave}|${sigla}`, () => coletarMapaUf(comp, meta, sigla, { fetchFn, pasta }));
        novo = true;
      } else {
        console.log(`[MONITOR-SECAS] UF=${sigla} período=${comp.chave} usando cópia validada (coletada em ${mapa.coletadoEm}).`);
      }
      return montarResultado({
        comp, meta, mapa, uf: sigla, verificadoEm,
        status: falha ? "nao_confirmado" : novo ? "operacional" : "cache",
        aviso: falha ? `Não foi possível confirmar se há publicação mais recente nesta emissão; exibida a última publicação válida armazenada (${comp.rotulo}).` : null,
      });
    } catch (erro) {
      falha = erro;
      registrarFalha(`MONITOR-SECAS:${sigla}`, erro);
      console.error(`[MONITOR-SECAS][ERRO] UF=${sigla} período=${comp.chave} fonte=${urlMapaUf(comp, sigla)} motivo=${erro.message}`);
    }
  }

  const ultima = ultimaCopiaValidaUf(sigla, pasta);
  if (ultima && (!fixa || ultima.competencia.chave === fixa.chave)) {
    console.warn(`[MONITOR-SECAS] UF=${sigla} período=${ultima.competencia.chave} usando última cópia válida; atualização não confirmada.`);
    return montarResultado({
      comp: ultima.competencia, meta: ultima.meta, mapa: ultima.mapa, uf: sigla, verificadoEm,
      status: "nao_confirmado",
      aviso: `Não foi possível confirmar a atualização nesta emissão; exibida a última publicação válida armazenada (${ultima.competencia.rotulo}).`,
    });
  }
  console.error(`[MONITOR-SECAS][ERRO] UF=${sigla} período=${comp?.chave || "desconhecido"} sem cópia válida armazenada — seção indisponível.`);
  return indisponivel(sigla, "Monitor de Secas temporariamente indisponível para este estado.", comp);
}

module.exports = {
  obterMonitorSecas,
  mapaUfDataUri,
  competenciaConfigurada,
  competenciaDeChave,
  descobrirPublicacao,
  interpretarApi,
  interpretarListagemS3,
  percentuaisArea,
  validarPngCompleto,
  intervaloVerificacaoMs,
  urlApi,
  urlListagem,
  urlPaginaMapa,
  urlPaginaUf,
  urlMapaUf,
  chaveMapaUf,
  CATEGORIAS,
  UFS,
  PORTAL_URL,
  CLASSIFICACAO_URL,
  PREFIXO_PRODUTOS,
  PASTA_CACHE,
};
