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
const { buscarObservacaoInmet } = require("../sources/inmetObservations");
const { criarServicoCorRio } = require("../sources/corRio");
const climaSaude = require("../sources/climaSaudeService");
const { competenciaConfigurada, descobrirPublicacao } = require("../sources/monitorSecas");
const { tipoErro } = require("../sources/httpJsonClient");
const { credenciaisConfiguradas, destinoConfigurado } = require("../integrations/sharepointGed");
const oceanopAreas = require("../config/oceanopAreas");
const { buscarOceanop, validarConsulta } = require("../sources/oceanop");

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

// A previsão municipal é textual. Chuva e vento numéricos são verificados
// separadamente na observação da estação automática mais próxima.
const CAMPOS_INMET = Object.fromEntries(["manha", "tarde", "noite"].flatMap((periodo) => [
  [`periodos.${periodo}.resumo`, `resumo (${periodo})`],
]));

const CAMPOS_INMET_OBSERVACAO = {
  "observacao.medidoEm": "horário da medição",
  "observacao.estacao.codigo": "código da estação",
  "observacao.temperaturaMinC": "temperatura mínima observada",
  "observacao.temperaturaMaxC": "temperatura máxima observada",
  "observacao.chuvaUltimaHoraMm": "chuva horária observada",
  "observacao.ventoVelocidadeKmh": "velocidade do vento observada",
  "observacao.ventoDirecaoGraus": "direção do vento observada",
  "observacao.rajadaKmh": "rajada medida pela estação",
};

function verificarClimaSaude(cidade, consultar) {
  const escopo = cidade.nome;
  if (!cidade.climaSaudeUrl) return Promise.resolve(item("Clima e Saúde", escopo, SITUACAO.NAO_CONFIGURADA, "Base sem página municipal cadastrada."));
  return consultar(cidade, OPCOES_HTTP).then((r) => {
    if (r.status === "operacional") {
      const faltando = camposFaltando(r.dados, {
        dataConsulta: "data de referência",
        municipio: "município",
        uf: "UF",
        "ehf.classificacao": "classificação EHF",
        riscoCombinado: "risco combinado",
      });
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
  let fixa;
  try { fixa = competenciaConfigurada(); }
  catch (erro) { return item(fonte, "Nacional", SITUACAO.BLOQUEADA, erro.message); }
  try {
    // Mesma descoberta usada pelo informativo (listagem do bucket + API), sem
    // gravar nada: a verificação só consulta.
    const { competencia, meta } = await descobrirPublicacao({ fetchFn, gravar: false });
    const ufs = Object.keys(meta.mapasUf || {}).length;
    return item(fonte, "Nacional", SITUACAO.OK, `Publicação mais recente: ${competencia.rotulo} (mapa final na API e ${ufs} mapas estaduais no bucket).` +
      (fixa && fixa.chave !== competencia.chave ? ` MONITOR_SECAS_COMPETENCIA=${fixa.chave} fixa outra referência; remova a variável para usar a publicação mais recente.` : ""));
  } catch (erro) {
    const situacao = /não publicou mapa|não é a versão final|Nenhuma publicação recente|nenhum mês/i.test(erro.message) ? SITUACAO.CAMPOS_AUSENTES : situacaoDoErro(erro);
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

  const pontosOceanop = Object.values(oceanopAreas).filter((ponto) => ponto?.habilitado === true);
  if (!pontosOceanop.length) {
    itens.push(item("Oceanop", "Configuração", SITUACAO.NAO_CONFIGURADA, "Nenhum ponto autorizado em src/config/oceanopAreas.js."));
  } else {
    try {
      pontosOceanop.forEach(validarConsulta);
      itens.push(item("Oceanop", "Configuração", SITUACAO.OK, `${pontosOceanop.length} área(s) com identificador local homologado.`));
    } catch (erro) {
      itens.push(item("Oceanop", "Configuração", SITUACAO.BLOQUEADA, erro.message));
    }
  }

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
    observacaoInmet: buscarObservacaoInmet,
    avisosInmet: buscarAvisosInmet,
    climaSaude: climaSaude.consultar,
    corRio: criarServicoCorRio,
    oceanop: buscarOceanop,
    fetch: globalThis.fetch,
    ...fontes,
  };
  const rio = getCidade("rio_de_janeiro");
  const costeira = getCidade("natal");
  const pontoMar = costeira.pontoMar || costeira;
  const fuso = rio.fusoHorario || "America/Sao_Paulo";
  const opcoes = { fuso, timeoutMs: OPCOES_HTTP.timeoutMs, logger: { log() {}, warn() {}, error() {} } };
  const pontosOceanop = Object.values(oceanopAreas).filter((ponto) => ponto?.habilitado === true);

  const gerais = await Promise.all([
    verificar("Open-Meteo Air Quality", "Rio de Janeiro", () => f.qualidadeAr(rio.latitude, rio.longitude, opcoes), {
      pm25Medio: "PM2,5", uvMax: "índice UV",
    }),
    verificar("Open-Meteo Marine", costeira.nome, () => f.mar(pontoMar.latitude, pontoMar.longitude, opcoes), {
      alturaMaxDiaM: "altura de onda", temperaturaMarC: "temperatura do mar",
    }),
    verificar("INMET Avisos", "Nacional", () => f.avisosInmet(rio.codigoIbge, opcoes), { avisos: "lista de avisos" }),
    verificarCorRio(f.corRio).catch((erro) => [item("COR-Rio", "Rio de Janeiro", situacaoDoErro(erro), erro.message)]),
    verificarMonitorSecas(f.fetch),
    ...pontosOceanop.map((area) => verificar("Oceanop", area.referencia || "área homologada",
      () => f.oceanop(area, { ...opcoes, tentativas: 2 }), { "previsoes.0.local": "área retornada" })),
  ]);

  // Por base em sequência: evita disparar dezenas de requisições simultâneas
  // aos portais do governo.
  const porBase = [];
  for (const cidade of cidades) {
    const opcoesCidade = { ...opcoes, fuso: cidade.fusoHorario || "America/Sao_Paulo" };
    const [openMeteo, inmet, observacao, clima] = await Promise.all([
      verificar("Open-Meteo Weather", cidade.nome, () => f.openMeteo(cidade.latitude, cidade.longitude, opcoesCidade), {
        tempMin: "temperatura mínima", tempMax: "temperatura máxima",
        umidadeMin: "umidade mínima", umidadeMax: "umidade máxima",
        precipitacaoTotalMm: "precipitação prevista", rajadaMaxKmh: "rajada prevista",
      }),
      verificar("INMET Previsão", cidade.nome, () => f.previsaoInmet(cidade.codigoIbge, opcoes), CAMPOS_INMET),
      verificar("INMET Observação", cidade.nome, () => f.observacaoInmet(cidade, opcoes), CAMPOS_INMET_OBSERVACAO),
      verificarClimaSaude(cidade, f.climaSaude).catch((erro) => item("Clima e Saúde", cidade.nome, situacaoDoErro(erro), erro.message)),
    ]);
    porBase.push(openMeteo, inmet, observacao, clima);
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
