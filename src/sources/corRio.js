// Integração server-side com o COR-Rio (Centro de Operações e Resiliência da
// Prefeitura do Rio). Duas fontes oficiais, públicas e sem chave:
//
// - Estágio operacional: https://appcor.cor-rio.work/estagio_cidade — o mesmo
//   endpoint JSON que o widget de estágio da página https://cor.rio/ consulta.
//   Resposta: { estagio: "Estágio N", inicio: ISO (início do estágio), mensagem,
//   mensagem2, cor, id }. Só o texto "Estágio N" define o nível; nada é deduzido
//   de temperatura, chuva ou avisos do INMET.
// - Comunicados: API REST do WordPress do cor.rio (/wp-json/wp/v2/posts) nas
//   categorias "Estágios" (44) e "Prevenção e Operação" (46). A categoria
//   "Estágios" sozinha não basta: o COR nem sempre marca nela as mudanças de
//   estágio.
//
// Estágio e comunicados têm horários próprios e são guardados separadamente:
// cada um mantém a última coleta válida (memória + data/cor-rio.json) e o
// horário em que foi consultado com sucesso. Uma falha nunca apaga o dado
// anterior nem coloca um estágio padrão no lugar.
const fs = require("node:fs");
const path = require("node:path");
const cheerio = require("cheerio");
const { buscarJsonComRetentativa } = require("./httpJsonClient");
const { formatarDataBrasilia } = require("./sourceHealth");

const ARQUIVO = path.join(__dirname, "..", "..", "data", "cor-rio.json");
const FONTE = "COR-Rio — Centro de Operações e Resiliência (Prefeitura do Rio)";
const ABRANGENCIA = "Município do Rio de Janeiro";
const URL_ESTAGIO = "https://appcor.cor-rio.work/estagio_cidade";
const URL_ESTAGIO_PUBLICA = "https://cor.rio/estagios-operacionais-da-cidade/";
const CATEGORIAS_COMUNICADOS = Object.freeze([44, 46]);
// Categoria "Previsão do Tempo" do cor.rio: identifica os comunicados
// meteorológicos (usada pelo e-mail para escolher o comunicado do dia).
const CATEGORIA_PREVISAO_TEMPO = 29;
const URL_COMUNICADOS =
  `https://cor.rio/wp-json/wp/v2/posts?categories=${CATEGORIAS_COMUNICADOS.join(",")}` +
  "&per_page=10&orderby=date&order=desc&_fields=id,date_gmt,modified_gmt,link,title,excerpt,content,categories";
// Os posts não têm validade explícita: "vigente" = publicado ou atualizado
// nesta janela.
const JANELA_VIGENCIA_HORAS = 24;
// Vários painéis abertos não multiplicam as consultas à fonte.
const TTL_PADRAO_MS = 5 * 60 * 1000;
const HEADERS = { "User-Agent": "Protocolo-Meteorologico-CIM/1.0 (consulta publica institucional)", Accept: "application/json" };
const LIMITE_PARAGRAFOS = 400;
const LIMITE_CARACTERES = 60000;

function textoHtml(html) {
  return cheerio.load(`<div>${html || ""}</div>`)("div").first().text().replace(/\s+/g, " ").trim();
}

function isoGmt(valor) {
  if (typeof valor !== "string" || !valor) return null;
  const iso = /[zZ]|[+-]\d{2}:?\d{2}$/.test(valor) ? valor : `${valor}Z`;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function linkCorRio(valor) {
  try {
    const url = new URL(valor);
    if (url.protocol !== "https:" || url.hostname !== "cor.rio" || url.username || url.password || url.port) return null;
    return url.href;
  } catch {
    return null;
  }
}

function erroInterpretacao(mensagem) {
  const erro = new Error(mensagem);
  erro.name = "ParserError";
  return erro;
}

/** Interpreta a resposta de /estagio_cidade. Lança erro se o estágio não for 1–5. */
function interpretarEstagio(json) {
  const correspondencia = /^\s*est[aá]gio\s*([1-5])\s*$/i.exec(typeof json?.estagio === "string" ? json.estagio : "");
  if (!correspondencia) throw erroInterpretacao("COR-Rio (estágio): estágio ausente ou em formato não reconhecido");
  const nivel = Number(correspondencia[1]);
  const mensagens = [json.mensagem, json.mensagem2]
    .filter((m) => typeof m === "string")
    .map((m) => textoHtml(m).slice(0, 1000))
    .filter(Boolean);
  return {
    nivel,
    rotulo: `Estágio ${nivel}`,
    vigenteDesde: isoGmt(json.inicio),
    mensagens,
    urlPublica: URL_ESTAGIO_PUBLICA,
  };
}

function paragrafosConteudo(html) {
  const $ = cheerio.load(html || "");
  $("script, style, iframe, noscript, figure, img, svg, form").remove();
  const blocos = [];
  let total = 0;
  $("p, h1, h2, h3, h4, h5, h6, li").each((_, el) => {
    if (blocos.length >= LIMITE_PARAGRAFOS || total >= LIMITE_CARACTERES) return false;
    // listas aninhadas aparecem no <li> pai; parágrafos dentro de <li> idem
    if ($(el).parents("li").length) return undefined;
    $(el).find("br").replaceWith("\n");
    const texto = $(el).text().split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean).join("\n");
    if (!texto) return undefined;
    const negrito = $(el).find("strong, b").text().replace(/\s+/g, " ").trim();
    const destaque = /^h\d$/i.test(el.tagName) || (negrito && negrito === texto.replace(/\n/g, " "));
    const cortado = texto.slice(0, LIMITE_CARACTERES - total);
    total += cortado.length;
    blocos.push({ texto: cortado, ...(destaque ? { destaque: true } : {}), ...(el.tagName === "li" ? { item: true } : {}) });
    return undefined;
  });
  return blocos;
}

function normalizarTitulo(titulo) {
  return titulo.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/gi, " ").trim().toLowerCase();
}

/**
 * Interpreta a lista de posts do WordPress. Descarta itens sem id, título,
 * data ou link do próprio cor.rio; remove duplicados (mesmo id ou mesmo
 * título) mantendo a versão mais recente; ordena do mais novo para o mais antigo.
 */
function interpretarComunicados(json) {
  if (!Array.isArray(json)) throw erroInterpretacao("COR-Rio (comunicados): resposta não é uma lista de publicações");
  const porChave = new Map();
  for (const post of json) {
    const id = Number(post?.id);
    const titulo = textoHtml(post?.title?.rendered).slice(0, 300);
    const publicadoEm = isoGmt(post?.date_gmt);
    const link = linkCorRio(post?.link);
    if (!Number.isInteger(id) || id <= 0 || !titulo || !publicadoEm || !link) continue;
    const atualizadoEm = isoGmt(post?.modified_gmt);
    const item = {
      id: String(id),
      titulo,
      resumo: textoHtml(post?.excerpt?.rendered).replace(/\s*\[(?:…|&hellip;|\.\.\.)\]\s*$/, "…").slice(0, 600),
      paragrafos: paragrafosConteudo(post?.content?.rendered),
      publicadoEm,
      atualizadoEm: atualizadoEm && atualizadoEm > publicadoEm ? atualizadoEm : null,
      link,
      categorias: Array.isArray(post?.categories) ? post.categories.filter(Number.isInteger) : [],
      abrangencia: ABRANGENCIA,
    };
    const chaves = [`id:${item.id}`, `titulo:${normalizarTitulo(titulo)}`];
    const existente = chaves.map((c) => porChave.get(c)).find(Boolean);
    const recencia = (x) => x.atualizadoEm || x.publicadoEm;
    if (existente && recencia(existente) >= recencia(item)) continue;
    if (existente) for (const [c, v] of porChave) if (v === existente) porChave.delete(c);
    for (const c of chaves) porChave.set(c, item);
  }
  return [...new Set(porChave.values())].sort((a, b) => b.publicadoEm.localeCompare(a.publicadoEm));
}

function comunicadosVigentes(itens, agoraMs, janelaHoras = JANELA_VIGENCIA_HORAS) {
  const limite = agoraMs - janelaHoras * 60 * 60 * 1000;
  return (itens || []).filter((c) => Date.parse(c.atualizadoEm || c.publicadoEm) >= limite);
}

// Mensagem curta e sem detalhes internos para exibir no painel.
function motivoFalha(erro) {
  if (erro?.name === "ParserError") return "a fonte respondeu em formato não reconhecido";
  return {
    timeout: "a fonte não respondeu a tempo",
    http: `a fonte respondeu HTTP ${erro?.httpStatus ?? "inesperado"}`,
    dns: "não foi possível localizar o servidor da fonte",
    tls: "falha na conexão segura com a fonte",
    invalid_json: "a fonte respondeu em formato não reconhecido",
    empty_response: "a fonte respondeu vazio",
    parser: "a fonte respondeu em formato não reconhecido",
  }[erro?.tipo] || "falha de conexão com a fonte";
}

function lerArquivo() {
  try {
    return JSON.parse(fs.readFileSync(ARQUIVO, "utf8"));
  } catch (erro) {
    if (erro.code !== "ENOENT") console.error(`[COR-RIO][ERRO] cache: ${erro.message}`);
    return {};
  }
}
function gravarArquivo(estado) {
  fs.mkdirSync(path.dirname(ARQUIVO), { recursive: true });
  const tmp = `${ARQUIVO}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(estado, null, 2), "utf8");
  fs.renameSync(tmp, ARQUIVO);
}

function criarServicoCorRio({
  fetchImpl = (...args) => fetch(...args),
  agora = Date.now,
  ttlMs = TTL_PADRAO_MS,
  janelaHoras = JANELA_VIGENCIA_HORAS,
  carregar = lerArquivo,
  salvar = gravarArquivo,
  logger = console,
  tentativas = 2,
  timeoutMs = 10000,
  esperarFn,
} = {}) {
  const salvo = carregar() || {};
  // ultimaFalha guarda o motivo da tentativa mais recente que falhou; é limpa
  // a cada sucesso.
  const partes = {
    estagio: { dados: salvo.estagio?.dados || null, consultadoEm: salvo.estagio?.consultadoEm || null, ultimaTentativaEm: null, ultimaFalha: null },
    comunicados: { dados: Array.isArray(salvo.comunicados?.dados) ? salvo.comunicados.dados : null, consultadoEm: salvo.comunicados?.consultadoEm || null, ultimaTentativaEm: null, ultimaFalha: null },
  };
  let emAndamento = null;

  function persistir() {
    try {
      salvar({
        estagio: { dados: partes.estagio.dados, consultadoEm: partes.estagio.consultadoEm },
        comunicados: { dados: partes.comunicados.dados, consultadoEm: partes.comunicados.consultadoEm },
      });
    } catch (erro) {
      logger.error?.(`[COR-RIO][ERRO] não foi possível gravar o cache: ${erro.message}`);
    }
  }

  async function atualizarParte(nome, url, interpretar, nomeFonte) {
    const parte = partes[nome];
    parte.ultimaTentativaEm = new Date(agora()).toISOString();
    try {
      const json = await buscarJsonComRetentativa(url, {
        nomeFonte, fetchImpl, timeoutMs, tentativas, atrasoBaseMs: 1000,
        ...(esperarFn ? { esperarFn } : {}),
        requestInit: { headers: HEADERS, redirect: "error" },
      });
      parte.dados = interpretar(json);
      parte.consultadoEm = new Date(agora()).toISOString();
      parte.ultimaFalha = null;
      return true;
    } catch (erro) {
      parte.ultimaFalha = motivoFalha(erro);
      logger.error?.(`[COR-RIO] ${nomeFonte}: ${erro.message}. ${parte.dados ? "Mantida a última coleta válida." : "Sem coleta válida anterior."}`);
      return false;
    }
  }

  async function atualizar() {
    if (emAndamento) return emAndamento;
    emAndamento = Promise.all([
      atualizarParte("estagio", URL_ESTAGIO, interpretarEstagio, "COR-Rio (estágio)"),
      atualizarParte("comunicados", URL_COMUNICADOS, interpretarComunicados, "COR-Rio (comunicados)"),
    ])
      .then((resultados) => {
        if (resultados.some(Boolean)) persistir();
        const e = partes.estagio.dados;
        logger.log?.(`[COR-RIO] Consulta concluída: estágio ${resultados[0] ? e.nivel : "indisponível"}; comunicados ${resultados[1] ? partes.comunicados.dados.length : "indisponíveis"}.`);
      })
      .finally(() => { emAndamento = null; });
    return emAndamento;
  }

  function situacao(parte) {
    if (!parte.dados) return "indisponivel";
    return parte.ultimaFalha ? "desatualizado" : "operacional";
  }

  function estado() {
    const { estagio, comunicados } = partes;
    return {
      fonte: FONTE,
      abrangencia: ABRANGENCIA,
      urlPublica: "https://cor.rio/",
      estagio: {
        status: situacao(estagio),
        dados: estagio.dados,
        consultadoEm: estagio.consultadoEm,
        ultimaTentativaEm: estagio.ultimaTentativaEm,
        falha: estagio.ultimaFalha,
      },
      comunicados: {
        status: situacao(comunicados),
        itens: comunicadosVigentes(comunicados.dados, agora(), janelaHoras),
        janelaHoras,
        consultadoEm: comunicados.consultadoEm,
        ultimaTentativaEm: comunicados.ultimaTentativaEm,
        falha: comunicados.ultimaFalha,
      },
    };
  }

  /** Devolve o estado, consultando a fonte se a última tentativa passou do TTL. */
  async function obter() {
    const ultima = Math.max(
      Date.parse(partes.estagio.ultimaTentativaEm || "") || 0,
      Date.parse(partes.comunicados.ultimaTentativaEm || "") || 0
    );
    if (agora() - ultima >= ttlMs) await atualizar();
    return estado();
  }

  return { obter, atualizar, estado };
}

// Instância única do processo: painel (/api/cor-rio), PDF baixado e PDF
// anexado ao e-mail leem o mesmo cache e, portanto, a mesma consulta.
let servicoPadrao = null;
function servicoCorRioPadrao() {
  if (!servicoPadrao) servicoPadrao = criarServicoCorRio();
  return servicoPadrao;
}

function quando(iso) {
  return formatarDataBrasilia(iso) || "horário indisponível";
}

/**
 * Entradas de "Fontes Consultadas" conforme o resultado real desta geração:
 * só entra como coleta automática a parte que respondeu agora.
 */
function fontesCorRio(estado) {
  const automatizadas = [];
  const manuais = [];
  const partes = [
    ["estagio", "COR-Rio — estágio operacional", "Estágio operacional da cidade (endpoint público appcor.cor-rio.work, o mesmo do site cor.rio)"],
    ["comunicados", "COR-Rio — comunicados", "Comunicados das categorias Estágios e Prevenção e Operação (API pública do site cor.rio)"],
  ];
  for (const [chave, nome, uso] of partes) {
    const parte = estado?.[chave];
    if (parte?.status === "operacional") {
      automatizadas.push({ nome, uso: `${uso}, consultado automaticamente em ${quando(parte.consultadoEm)} (Brasília)` });
    } else if (parte?.status === "desatualizado") {
      manuais.push({ nome, uso: `A consulta automática falhou nesta geração; exibida a última consulta bem-sucedida, de ${quando(parte.consultadoEm)}. Confirmar em cor.rio` });
    } else {
      manuais.push({ nome, uso: "Consulta automática indisponível nesta geração e sem dado anterior; verificar manualmente em cor.rio" });
    }
  }
  return { automatizadas, manuais };
}

/**
 * Anexa ao relatório o estado do COR-Rio (mesmo formato de /api/cor-rio) e
 * atualiza as fontes. Só para bases com integracaoCorRio. Nunca lança: uma
 * falha vira estado "indisponível" e o restante do PDF segue normalmente.
 */
async function anexarCorRioAoRelatorio(report, cidade, { servico = servicoCorRioPadrao(), logger = console } = {}) {
  if (!cidade?.integracaoCorRio) return null;
  let estado;
  try {
    estado = await servico.obter();
  } catch (erro) {
    logger.error?.(`[COR-RIO] Falha inesperada ao preparar o relatório: ${erro.message}`);
    estado = {
      fonte: FONTE, abrangencia: ABRANGENCIA, urlPublica: "https://cor.rio/",
      estagio: { status: "indisponivel", dados: null, consultadoEm: null, falha: "falha inesperada na consulta" },
      comunicados: { status: "indisponivel", itens: [], janelaHoras: JANELA_VIGENCIA_HORAS, consultadoEm: null, falha: "falha inesperada na consulta" },
    };
  }
  report.corRio = estado;
  const { automatizadas, manuais } = fontesCorRio(estado);
  // substitui a antiga linha manual genérica "COR-Rio"
  report.fontesManuais = [...(report.fontesManuais || []).filter((f) => f.nome !== "COR-Rio"), ...manuais];
  report.fontesAutomatizadas = [...(report.fontesAutomatizadas || []), ...automatizadas];
  if (estado.estagio.status !== "operacional" || estado.comunicados.status !== "operacional") {
    report.avisosColeta = [...(report.avisosColeta || []), "COR-Rio: não foi possível atualizar todas as informações nesta geração (veja o card do COR-Rio)."];
  }
  return estado;
}

module.exports = {
  criarServicoCorRio,
  servicoCorRioPadrao,
  anexarCorRioAoRelatorio,
  fontesCorRio,
  interpretarEstagio,
  interpretarComunicados,
  comunicadosVigentes,
  URL_ESTAGIO,
  URL_COMUNICADOS,
  CATEGORIA_PREVISAO_TEMPO,
  JANELA_VIGENCIA_HORAS,
  ARQUIVO,
};
