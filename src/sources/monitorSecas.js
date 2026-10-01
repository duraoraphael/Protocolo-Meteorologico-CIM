// Monitor de Secas (ANA) — acompanhamento MENSAL da seca, não previsão.
//
// A página https://monitordesecas.ana.gov.br/mapa?mes=M&ano=AAAA é uma SPA
// (Angular) sem conteúdo no HTML inicial. Ela mesma carrega os dados da API
// pública apimsbr.ana.gov.br/rest/cms-msne/mapa-monitor e os arquivos do
// bucket público ana-monitor-secas-files (S3). Esta coleta faz exatamente as
// mesmas requisições anônimas que o navegador faz ao abrir a página — sem
// autenticação, sem contornar bloqueios.
//
// O que é coletado da competência pedida (nunca de outro mês):
// - mapa oficial em PNG (já traz título, legenda, impactos e "Elaborado em");
// - textos oficiais por UF (campo `descricao`, tipo_area 1 = UF, chave = código
//   IBGE da UF — mesmo filtro que a página usa em "mapas por estado").
//
// Cada informativo recebe só o resumo da UF do seu destino (ver `uf` em
// obterMonitorSecas). A fonte não publica texto por município.
const fs = require("node:fs");
const path = require("node:path");
const tls = require("node:tls");
const crypto = require("node:crypto");
const { Agent } = require("undici");
const { registrarFalha } = require("./sourceHealth");

const API_URL = "https://apimsbr.ana.gov.br/rest/cms-msne/mapa-monitor";
const ARQUIVOS_URL = "https://ana-monitor-secas-files.s3.sa-east-1.amazonaws.com/";
const PASTA_CACHE = path.join(__dirname, "..", "..", "data", "monitor-secas");
const COMPETENCIA_PADRAO = "2026-08";
const LIMITE_JSON = 2_000_000;
const LIMITE_PNG = 15_000_000;
const VERSAO_CACHE = 2;

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

// Código IBGE e nome de cada UF (a API indexa os textos pelo código IBGE).
const UFS = Object.freeze({
  RO: [11, "Rondônia"], AC: [12, "Acre"], AM: [13, "Amazonas"], RR: [14, "Roraima"], PA: [15, "Pará"],
  AP: [16, "Amapá"], TO: [17, "Tocantins"], MA: [21, "Maranhão"], PI: [22, "Piauí"], CE: [23, "Ceará"],
  RN: [24, "Rio Grande do Norte"], PB: [25, "Paraíba"], PE: [26, "Pernambuco"], AL: [27, "Alagoas"],
  SE: [28, "Sergipe"], BA: [29, "Bahia"], MG: [31, "Minas Gerais"], ES: [32, "Espírito Santo"],
  RJ: [33, "Rio de Janeiro"], SP: [35, "São Paulo"], PR: [41, "Paraná"], SC: [42, "Santa Catarina"],
  RS: [43, "Rio Grande do Sul"], MS: [50, "Mato Grosso do Sul"], MT: [51, "Mato Grosso"],
  GO: [52, "Goiás"], DF: [53, "Distrito Federal"],
});

// --- Competência -----------------------------------------------------------

function competenciaConfigurada(valor = process.env.MONITOR_SECAS_COMPETENCIA) {
  const texto = String(valor || COMPETENCIA_PADRAO).trim();
  const partes = texto.match(/^(\d{4})-(\d{2})$/);
  const ano = partes && Number(partes[1]);
  const mes = partes && Number(partes[2]);
  if (!partes || mes < 1 || mes > 12 || ano < 2014) {
    throw new Error(`MONITOR_SECAS_COMPETENCIA inválida: "${texto}" (use AAAA-MM).`);
  }
  return { mes, ano, chave: `${ano}-${String(mes).padStart(2, "0")}`, rotulo: `${MESES[mes - 1]}/${ano}` };
}

function urlPaginaMapa({ mes, ano }) {
  return `https://monitordesecas.ana.gov.br/mapa?mes=${mes}&ano=${ano}`;
}

function urlApi({ mes, ano }) {
  return `${API_URL}?mes=${mes}&ano=${ano}&final=true&response_format=apil5&use_fk=true&include_all_obj_fk=true&limit=1&orderBy=id,desc`;
}

// Só arquivos de uploads/mapas/ no bucket oficial — o caminho vem da API e
// não pode virar acesso a outro host ou diretório.
function urlArquivo(caminho) {
  if (typeof caminho !== "string" || !/^uploads\/mapas\/[A-Za-z0-9._-]+$/.test(caminho) || caminho.includes("..")) {
    throw new Error(`Caminho de arquivo inesperado na resposta da ANA: ${String(caminho).slice(0, 80)}`);
  }
  return ARQUIVOS_URL + caminho;
}

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

async function baixar(url, { fetchFn = fetch, limite, tipo, timeoutMs = 20000, tentativas = 2 } = {}) {
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
      console.log(`[MONITOR-SECAS] ${tipo || "Download"}: HTTP 200, ${buffer.length} bytes`);
      return buffer;
    } catch (erro) {
      ultimoErro = erro;
      console.warn(`[MONITOR-SECAS] Tentativa ${i}/${tentativas} falhou (${tipo || url}): ${erro.message}`);
      if (i < tentativas) await new Promise((resolve) => setTimeout(resolve, 1500 * i));
    }
  }
  throw ultimoErro;
}

// --- Texto oficial ---------------------------------------------------------

function textoLimpo(html) {
  return String(html || "")
    .replace(/<\/p>|<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+/g, " ")
    .split("\n").map((l) => l.trim()).filter(Boolean).join("\n");
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
  return {
    mapaId: mapa.id,
    nome: mapa.nome,
    dataElaboracao: mapa.data_criacao || null,
    caminhoMapa: mapa.path,
    descricoesUf,
  };
}

// --- Cache -----------------------------------------------------------------

function pngValido(buffer) {
  return buffer.length > 24 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function lerCache(competencia, pasta) {
  const dir = path.join(pasta, competencia.chave);
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(dir, "dados.json"), "utf8"));
    if (meta.versao !== VERSAO_CACHE || meta.competencia?.chave !== competencia.chave ||
        meta.competencia?.mes !== competencia.mes || meta.competencia?.ano !== competencia.ano) return null;
    const png = fs.readFileSync(path.join(dir, "mapa.png"));
    if (!pngValido(png) || sha256(png) !== meta.sha256Mapa) return null;
    return meta;
  } catch (erro) {
    if (erro.code !== "ENOENT") console.warn(`[MONITOR-SECAS] Cache de ${competencia.chave} ignorado: ${erro.message}`);
    return null;
  }
}

function gravarCache(competencia, { meta, png }, pasta) {
  const dir = path.join(pasta, competencia.chave);
  fs.mkdirSync(dir, { recursive: true });
  const gravar = (nome, conteudo) => {
    const tmp = path.join(dir, `${nome}.${process.pid}.tmp`);
    fs.writeFileSync(tmp, conteudo);
    fs.renameSync(tmp, path.join(dir, nome));
  };
  gravar("mapa.png", png);
  gravar("dados.json", JSON.stringify(meta, null, 2));
}

// --- Coleta ----------------------------------------------------------------

async function coletar(competencia, { fetchFn, pasta }) {
  console.log(`[MONITOR-SECAS] Coletando ${competencia.rotulo} da API oficial da ANA`);
  const jsonBuffer = await baixar(urlApi(competencia), { fetchFn, limite: LIMITE_JSON, tipo: "API mapa-monitor" });
  let json;
  try { json = JSON.parse(jsonBuffer.toString("utf8")); }
  catch { throw new Error("Resposta da API do Monitor de Secas não é JSON válido."); }
  const api = interpretarApi(json, competencia);

  const png = await baixar(urlArquivo(api.caminhoMapa), { fetchFn, limite: LIMITE_PNG, tipo: "Mapa PNG" });
  if (!pngValido(png)) throw new Error("O arquivo do mapa oficial não é um PNG válido.");

  const meta = {
    versao: VERSAO_CACHE,
    competencia,
    ...api,
    coletadoEm: new Date().toISOString(),
    sha256Mapa: sha256(png),
    urls: { pagina: urlPaginaMapa(competencia), api: urlApi(competencia), mapa: urlArquivo(api.caminhoMapa) },
  };
  gravarCache(competencia, { meta, png }, pasta);
  console.log(`[MONITOR-SECAS] ${competencia.rotulo} coletado e armazenado (mapa id ${api.mapaId}, elaborado em ${api.dataElaboracao}).`);
  return meta;
}

// Recorta para a UF do informativo: o report carrega só o resumo do destino.
function montarResultado(competencia, meta, status, uf) {
  const ufs = uf ? [uf] : Object.keys(UFS);
  return {
    status,
    competencia,
    mensagem: status === "cache"
      ? `Cópia validada de ${competencia.rotulo}, coletada em ${meta.coletadoEm}.`
      : `Coletado da fonte oficial em ${meta.coletadoEm}.`,
    mapaId: meta.mapaId,
    dataElaboracao: meta.dataElaboracao,
    coletadoEm: meta.coletadoEm,
    urls: meta.urls,
    resumosUf: ufs.filter((sigla) => UFS[sigla]).map((sigla) => ({
      uf: sigla,
      nome: UFS[sigla][1],
      texto: meta.descricoesUf[String(UFS[sigla][0])] || null,
    })),
  };
}

// O PDF roda sem rede: o mapa entra como data: URI lido do cache da
// competência. O caminho sai só da chave AAAA-MM validada, nunca do report.
const mapasEmMemoria = new Map();
function mapaDataUri(competencia, pasta = PASTA_CACHE) {
  const chave = competencia?.chave;
  if (typeof chave !== "string" || !/^\d{4}-\d{2}$/.test(chave)) return null;
  const idCache = `${pasta}|${chave}`;
  if (mapasEmMemoria.has(idCache)) return mapasEmMemoria.get(idCache);
  try {
    const png = fs.readFileSync(path.join(pasta, chave, "mapa.png"));
    if (!pngValido(png)) return null;
    const uri = `data:image/png;base64,${png.toString("base64")}`;
    mapasEmMemoria.set(idCache, uri);
    return uri;
  } catch {
    return null;
  }
}

/**
 * Devolve os dados do Monitor de Secas da competência configurada, recortados
 * para a UF informada. Usa a cópia validada em cache quando existe; senão
 * coleta da fonte. Nunca lança: em falha devolve `status: "indisponivel"`
 * para o PDF seguir sem a seção.
 */
async function obterMonitorSecas({ uf, competencia, fetchFn = fetch, pasta = PASTA_CACHE } = {}) {
  let comp;
  try {
    comp = competencia || competenciaConfigurada();
  } catch (erro) {
    console.error(`[MONITOR-SECAS][ERRO] ${erro.message}`);
    return { status: "indisponivel", competencia: null, mensagem: "Competência do Monitor de Secas mal configurada." };
  }
  try {
    const cache = lerCache(comp, pasta);
    if (cache) {
      console.log(`[MONITOR-SECAS] Usando cópia validada de ${comp.rotulo} (coletada em ${cache.coletadoEm}).`);
      return montarResultado(comp, cache, "cache", uf);
    }
    return montarResultado(comp, await coletar(comp, { fetchFn, pasta }), "operacional", uf);
  } catch (erro) {
    registrarFalha(`MONITOR-SECAS:${comp.chave}`, erro);
    console.error(`[MONITOR-SECAS][ERRO] ${comp.rotulo} indisponível: ${erro.message}`);
    return {
      status: "indisponivel",
      competencia: comp,
      mensagem: `Dados do Monitor de Secas de ${comp.rotulo} indisponíveis nesta emissão.`,
      urls: { pagina: urlPaginaMapa(comp) },
    };
  }
}

module.exports = {
  obterMonitorSecas,
  mapaDataUri,
  competenciaConfigurada,
  interpretarApi,
  urlArquivo,
  urlPaginaMapa,
  CATEGORIAS,
  PASTA_CACHE,
};
