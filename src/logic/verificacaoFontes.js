// Verificação preventiva das fontes externas, executada antes dos informativos
// das 05h e 15h. Não gera PDF, não envia informativo e não altera o estado do
// agendador: só consulta cada fonte e confere se os campos que o informativo
// usa vieram preenchidos.
//
// Cada item recebe uma situação:
//   ok                — respondeu com os campos esperados
//   campos_ausentes   — respondeu, mas sem campos que o informativo usa
//   formato_alterado  — respondeu em formato não reconhecido (layout/contrato mudou)
//   indisponivel      — não respondeu (rede, DNS, timeout, HTTP de erro)
//   bloqueada         — o próprio sistema bloqueou (ex.: licença Open-Meteo em produção)
//   nao_configurada   — integração sem configuração; informativo, não gera alerta
const { CIDADES, getCidade } = require("../config/cities");
const { buscarOpenMeteo } = require("../sources/openMeteo");
const { buscarQualidadeAr } = require("../sources/airQuality");
const { buscarMar } = require("../sources/marine");
const { buscarPrevisaoInmet, buscarAvisosInmet } = require("../sources/inmet");
const { criarServicoCorRio } = require("../sources/corRio");
const climaSaude = require("../sources/climaSaudeService");
const { competenciaConfigurada, interpretarApi, urlApi } = require("../sources/monitorSecas");
const { tipoErro } = require("../sources/httpJsonClient");
const { credenciaisConfiguradas, destinoConfigurado } = require("../integrations/sharepointGed");
const oceanopAreas = require("../config/oceanopAreas");

const SITUACAO = Object.freeze({
  OK: "ok",
  CAMPOS_AUSENTES: "campos_ausentes",
  FORMATO_ALTERADO: "formato_alterado",
  INDISPONIVEL: "indisponivel",
  BLOQUEADA: "bloqueada",
  NAO_CONFIGURADA: "nao_configurada",
});

const ROTULOS = Object.freeze({
  ok: "OK",
  campos_ausentes: "Campos ausentes",
  formato_alterado: "Formato alterado",
  indisponivel: "Indisponível",
  bloqueada: "Bloqueada",
  nao_configurada: "Não configurada",
});

const PROBLEMAS = new Set([
  SITUACAO.CAMPOS_AUSENTES,
  SITUACAO.FORMATO_ALTERADO,
  SITUACAO.INDISPONIVEL,
  SITUACAO.BLOQUEADA,
]);

const TIPOS_FORMATO = new Set(["parser", "invalid_json", "empty_response"]);
const OPCOES_HTTP = Object.freeze({ timeoutMs: 15000, tentativas: 2 });

function situacaoDoErro(erro) {
  if (erro?.code === "OPEN_METEO_COMMERCIAL_LICENSE_REQUIRED") return SITUACAO.BLOQUEADA;
  return TIPOS_FORMATO.has(erro?.tipo || tipoErro(erro)) ? SITUACAO.FORMATO_ALTERADO : SITUACAO.INDISPONIVEL;
}

function item(fonte, escopo, situacao, detalhe) {
  return { fonte, escopo, situacao, detalhe };
}

/** Rótulos dos caminhos ("a.b.c") cujo valor veio nulo, indefinido ou vazio. */
function camposFaltando(objeto, campos) {
  return Object.entries(campos)
    .filter(([caminho]) => {
      const valor = caminho.split(".").reduce((atual, chave) => atual?.[chave], objeto);
      return valor === null || valor === undefined || valor === "";
    })
    .map(([, rotulo]) => rotulo);
}

/** Executa a consulta e confere os campos; qualquer exceção vira um item com situação. */
async function verificar(fonte, escopo, consulta, campos) {
  try {
    const dados = await consulta();
    const faltando = camposFaltando(dados, campos);
    return faltando.length
      ? item(fonte, escopo, SITUACAO.CAMPOS_AUSENTES, `Sem ${faltando.join(", ")}.`)
      : item(fonte, escopo, SITUACAO.OK, "Respondeu com os campos esperados.");
  } catch (erro) {
    return item(fonte, escopo, situacaoDoErro(erro), erro?.message || String(erro));
  }
}

// Rajada e chuva em mm não entram: o INMET não publica esses campos e o
// informativo já os completa com a Open-Meteo.
const CAMPOS_INMET = Object.fromEntries(["manha", "tarde", "noite"].flatMap((periodo) => [
  [`periodos.${periodo}.resumo`, `resumo (${periodo})`],
  [`periodos.${periodo}.tempMax`, `temperatura máxima (${periodo})`],
  [`periodos.${periodo}.tempMin`, `temperatura mínima (${periodo})`],
]));

function verificarClimaSaude(cidade, consultar) {
  const escopo = cidade.nome;
  if (!cidade.climaSaudeUrl) return Promise.resolve(item("Clima e Saúde", escopo, SITUACAO.NAO_CONFIGURADA, "Base sem página municipal cadastrada."));
  return consultar(cidade, OPCOES_HTTP).then((r) => {
    if (r.status === "operacional") {
      const faltando = camposFaltando(r.dados, { "ehf.classificacao": "classificação EHF", riscoCombinado: "risco combinado" });
      return faltando.length
        ? item("Clima e Saúde", escopo, SITUACAO.CAMPOS_AUSENTES, `Sem ${faltando.join(", ")}.`)
        : item("Clima e Saúde", escopo, SITUACAO.OK, `EHF de ${r.dados.dataConsulta} lido da página.`);
    }
    const situacao = TIPOS_FORMATO.has(r.tipoFalha) ? SITUACAO.FORMATO_ALTERADO : SITUACAO.INDISPONIVEL;
    const motivo = situacao === SITUACAO.FORMATO_ALTERADO
      ? "A página respondeu, mas o layout mudou e o EHF não foi encontrado."
      : "A página não respondeu.";
    const reserva = r.status === "degradado" ? ` ${r.mensagem}` : " Sem coleta válida anterior.";
    return item("Clima e Saúde", escopo, situacao, `${motivo}${reserva}`);
  });
}

async function verificarCorRio(criarServico) {
  const servico = criarServico({
    carregar: () => ({}), salvar: () => {}, ttlMs: 0, tentativas: 2, timeoutMs: 15000,
    logger: { log() {}, warn() {}, error() {} },
  });
  const estado = await servico.obter();
  const partes = { estagio: "estágio operacional", calor: "estágio de calor", comunicados: "comunicados" };
  return Object.entries(partes).map(([chave, nome]) => {
    const parte = estado[chave];
    if (parte.status === "operacional") return item(`COR-Rio (${nome})`, "Rio de Janeiro", SITUACAO.OK, "Respondeu no formato esperado.");
    const situacao = TIPOS_FORMATO.has(parte.tipoFalha) ? SITUACAO.FORMATO_ALTERADO : SITUACAO.INDISPONIVEL;
    return item(`COR-Rio (${nome})`, "Rio de Janeiro", situacao, `Falha: ${parte.falha || "motivo não informado"}.`);
  });
}

async function verificarMonitorSecas(fetchFn) {
  const fonte = "ANA Monitor de Secas";
  let competencia;
  try { competencia = competenciaConfigurada(); }
  catch (erro) { return item(fonte, "Nacional", SITUACAO.BLOQUEADA, erro.message); }
  const consultar = async (comp) => {
    const resposta = await fetchFn(urlApi(comp), {
      signal: AbortSignal.timeout(15000),
      headers: { Accept: "application/json", Referer: "https://monitordesecas.ana.gov.br/" },
    });
    if (!resposta.ok) throw Object.assign(new Error(`HTTP ${resposta.status}`), { httpStatus: resposta.status });
    let json;
    try { json = await resposta.json(); }
    catch { throw Object.assign(new Error("Resposta não é JSON válido."), { name: "InvalidJsonError" }); }
    return interpretarApi(json, comp);
  };
  try {
    const mapa = await consultar(competencia);
    // O Monitor é mensal; avisa quando a ANA já publicou um mês mais novo que o configurado.
    const seguinte = new Date(Date.UTC(competencia.ano, competencia.mes, 1));
    const proxima = { mes: seguinte.getUTCMonth() + 1, ano: seguinte.getUTCFullYear() };
    proxima.chave = `${proxima.ano}-${String(proxima.mes).padStart(2, "0")}`;
    proxima.rotulo = proxima.chave;
    const novaDisponivel = await consultar(proxima).then(() => true, () => false);
    return item(fonte, "Nacional", SITUACAO.OK, `Mapa ${mapa.nome || competencia.rotulo} disponível.` +
      (novaDisponivel ? ` A ANA já publicou ${proxima.chave}; ajuste MONITOR_SECAS_COMPETENCIA=${proxima.chave} para usar o mapa mais recente.` : ""));
  } catch (erro) {
    const situacao = /não publicou mapa|não é a versão final/i.test(erro.message) ? SITUACAO.CAMPOS_AUSENTES : situacaoDoErro(erro);
    return item(fonte, "Nacional", situacao, erro.message);
  }
}

function verificarConfiguracoes(env) {
  const itens = [];
  const producao = String(env.NODE_ENV || "").toLowerCase() === "production";
  const chave = String(env.OPEN_METEO_API_KEY || "").trim();
  if (chave) itens.push(item("Licença Open-Meteo", "Configuração", SITUACAO.OK, "Chave comercial configurada (hosts customer-*)."));
  else if (producao) itens.push(item("Licença Open-Meteo", "Configuração", SITUACAO.BLOQUEADA, "NODE_ENV=production sem OPEN_METEO_API_KEY: Open-Meteo bloqueada até a licença comercial ser configurada."));
  else itens.push(item("Licença Open-Meteo", "Configuração", SITUACAO.NAO_CONFIGURADA, "Sem OPEN_METEO_API_KEY: usando API gratuita (uso não comercial). Produção ficará bloqueada."));

  itens.push(Object.keys(oceanopAreas).length
    ? item("Oceanop", "Configuração", SITUACAO.NAO_CONFIGURADA, "Áreas cadastradas; consulta real só dentro da rede/VPN Petrobras (não testada aqui).")
    : item("Oceanop", "Configuração", SITUACAO.NAO_CONFIGURADA, "Nenhum identificador de área em src/config/oceanopAreas.js."));

  itens.push(destinoConfigurado()
    ? item("GED SharePoint", "Configuração", SITUACAO.OK, "Credenciais Azure e biblioteca configuradas.")
    : item("GED SharePoint", "Configuração", SITUACAO.NAO_CONFIGURADA,
      credenciaisConfiguradas() ? "Credenciais Azure presentes, mas falta SHAREPOINT_DRIVE_ID." : "Faltam credenciais Azure (AZURE_TENANT_ID, AZURE_CLIENT_ID, segredo) e SHAREPOINT_DRIVE_ID."));
  return itens;
}

/**
 * Consulta todas as fontes. As dependências podem ser substituídas nos testes.
 * Fontes nacionais/globais são consultadas uma vez; INMET e Clima e Saúde,
 * por base.
 */
async function executarVerificacao({
  cidades = Object.values(CIDADES),
  env = process.env,
  agora = () => new Date(),
  fontes = {},
} = {}) {
  const f = {
    openMeteo: buscarOpenMeteo,
    qualidadeAr: buscarQualidadeAr,
    mar: buscarMar,
    previsaoInmet: buscarPrevisaoInmet,
    avisosInmet: buscarAvisosInmet,
    climaSaude: climaSaude.consultar,
    corRio: criarServicoCorRio,
    fetch: globalThis.fetch,
    ...fontes,
  };
  const rio = getCidade("rio_de_janeiro");
  const costeira = getCidade("linhares");
  const pontoMar = costeira.pontoMar || costeira;
  const fuso = rio.fusoHorario || "America/Sao_Paulo";
  const opcoes = { fuso, timeoutMs: OPCOES_HTTP.timeoutMs, logger: { log() {}, warn() {}, error() {} } };

  const gerais = await Promise.all([
    verificar("Open-Meteo Weather", "Rio de Janeiro", () => f.openMeteo(rio.latitude, rio.longitude, opcoes), {
      "atual.temperaturaC": "temperatura atual", tempMin: "temperatura mínima", tempMax: "temperatura máxima",
      precipitacaoTotalMm: "chuva acumulada", rajadaMaxKmh: "rajada",
    }),
    verificar("Open-Meteo Air Quality", "Rio de Janeiro", () => f.qualidadeAr(rio.latitude, rio.longitude, opcoes), {
      uvMax: "índice UV", pm25Medio: "PM2,5",
    }),
    verificar("Open-Meteo Marine", costeira.nome, () => f.mar(pontoMar.latitude, pontoMar.longitude, opcoes), {
      alturaMaxDiaM: "altura de onda", temperaturaMarC: "temperatura do mar",
    }),
    verificar("INMET Avisos", "Nacional", () => f.avisosInmet(rio.codigoIbge, opcoes), { avisos: "lista de avisos" }),
    verificarCorRio(f.corRio).catch((erro) => [item("COR-Rio", "Rio de Janeiro", situacaoDoErro(erro), erro.message)]),
    verificarMonitorSecas(f.fetch),
  ]);

  // Por base em sequência: evita disparar dezenas de requisições simultâneas
  // aos portais do governo.
  const porBase = [];
  for (const cidade of cidades) {
    const [inmet, clima] = await Promise.all([
      verificar("INMET Previsão", cidade.nome, () => f.previsaoInmet(cidade.codigoIbge, opcoes), CAMPOS_INMET),
      verificarClimaSaude(cidade, f.climaSaude).catch((erro) => item("Clima e Saúde", cidade.nome, situacaoDoErro(erro), erro.message)),
    ]);
    porBase.push(inmet, clima);
  }

  const itens = [...gerais.flat(), ...porBase, ...verificarConfiguracoes(env)];
  const problemas = itens.filter((i) => PROBLEMAS.has(i.situacao));
  return { verificadoEm: agora().toISOString(), itens, problemas };
}

function formatarTexto({ verificadoEm, itens, problemas }) {
  const quando = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short",
  }).format(new Date(verificadoEm));
  const linhas = [`Verificação das fontes — ${quando} (Brasília)`, ""];
  for (const i of itens) {
    linhas.push(`[${ROTULOS[i.situacao]}] ${i.fonte} — ${i.escopo}: ${i.detalhe}`);
  }
  linhas.push("", problemas.length ? `${problemas.length} problema(s) encontrado(s).` : "Nenhum problema encontrado.");
  return linhas.join("\n");
}

module.exports = {
  SITUACAO,
  ROTULOS,
  PROBLEMAS,
  executarVerificacao,
  formatarTexto,
  camposFaltando,
  situacaoDoErro,
};
