// Consulta técnica somente leitura. Não gera PDF, não grava cache e não envia e-mail.
const { getCidade } = require("../src/config/cities");
const { buscarOpenMeteo } = require("../src/sources/openMeteo");
const { buscarQualidadeAr } = require("../src/sources/airQuality");
const { buscarMar } = require("../src/sources/marine");
const { buscarPrevisaoInmet, buscarAvisosInmet } = require("../src/sources/inmet");
const { criarServicoCorRio } = require("../src/sources/corRio");
const climaSaude = require("../src/sources/climaSaudeService");
const { competenciaConfigurada, interpretarApi } = require("../src/sources/monitorSecas");
const oceanopAreas = require("../src/config/oceanopAreas");

const inicio = new Date();
const rio = getCidade("rio_de_janeiro");
const linhares = getCidade("linhares");
const capturas = {};

function fetchCapturado(nome) {
  return async (url, opcoes = {}) => {
    const resposta = await fetch(url, opcoes);
    let bruto = null;
    try { bruto = await resposta.clone().json(); } catch { /* HTML ou corpo vazio */ }
    capturas[nome] = {
      endpoint: new URL(url).origin + new URL(url).pathname,
      statusHttp: resposta.status,
      consultadoEm: new Date().toISOString(),
      bruto,
    };
    return resposta;
  };
}

function erroSeguro(erro) {
  return { status: "FALHA", codigo: erro?.code || erro?.name || null, mensagem: erro?.message || String(erro) };
}

async function executar(nome, tarefa, resumir) {
  try {
    const dados = await tarefa();
    return [nome, { status: "OK", ...resumir(dados, capturas[nome]) }];
  } catch (erro) {
    return [nome, erroSeguro(erro)];
  }
}

async function main() {
  const semEspera = async () => {};
  const pontoMar = linhares.pontoMar || linhares;
  const tarefas = [
    executar("openMeteo", () => buscarOpenMeteo(rio.latitude, rio.longitude, {
      fuso: rio.fusoHorario || "America/Sao_Paulo", fetchImpl: fetchCapturado("openMeteo"), timeoutMs: 10000, esperarFn: semEspera,
    }), (normalizado, captura) => ({
      endpoint: captura.endpoint, statusHttp: captura.statusHttp, localidade: `${rio.nome}/${rio.uf}`,
      coordenadasSolicitadas: [rio.latitude, rio.longitude], coordenadasGrade: [captura.bruto?.latitude, captura.bruto?.longitude],
      fuso: captura.bruto?.timezone, unidades: captura.bruto?.hourly_units,
      original: {
        horarioAtual: captura.bruto?.current?.time,
        temperaturaAtualC: captura.bruto?.current?.temperature_2m,
        temperaturaMinC: captura.bruto?.daily?.temperature_2m_min?.[0],
        temperaturaMaxC: captura.bruto?.daily?.temperature_2m_max?.[0],
        chuvaDiariaMm: captura.bruto?.daily?.precipitation_sum?.[0],
        rajadaDiariaKmh: captura.bruto?.daily?.wind_gusts_10m_max?.[0],
      },
      normalizado: {
        temperaturaAtualC: normalizado.atual?.temperaturaC,
        temperaturaMinC: normalizado.tempMin,
        temperaturaMaxC: normalizado.tempMax,
        chuvaJanelaMm: normalizado.precipitacaoTotalMm,
        rajadaJanelaKmh: normalizado.rajadaMaxKmh,
      },
    })),
    executar("airQuality", () => buscarQualidadeAr(rio.latitude, rio.longitude, {
      fuso: rio.fusoHorario || "America/Sao_Paulo", fetchImpl: fetchCapturado("airQuality"), timeoutMs: 10000, esperarFn: semEspera,
    }), (normalizado, captura) => ({
      endpoint: captura.endpoint, statusHttp: captura.statusHttp, localidade: `${rio.nome}/${rio.uf}`,
      fuso: captura.bruto?.timezone, unidades: captura.bruto?.hourly_units,
      intervaloOriginal: [captura.bruto?.hourly?.time?.[0], captura.bruto?.hourly?.time?.at?.(-1)],
      normalizado: { uvMax: normalizado.uvMax, pm25Medio: normalizado.pm25Medio, pm10Medio: normalizado.pm10Medio, europeanAqiPm25: normalizado.aqiPm25 },
    })),
    executar("marine", () => buscarMar(pontoMar.latitude, pontoMar.longitude, {
      fuso: linhares.fusoHorario || "America/Sao_Paulo", fetchImpl: fetchCapturado("marine"), timeoutMs: 10000, esperarFn: semEspera, logger: { warn() {} },
    }), (normalizado, captura) => ({
      endpoint: captura.endpoint, statusHttp: captura.statusHttp, localidade: `${linhares.nome}/${linhares.uf}`,
      coordenadasSolicitadas: [pontoMar.latitude, pontoMar.longitude], coordenadasGrade: [captura.bruto?.latitude, captura.bruto?.longitude],
      fuso: captura.bruto?.timezone, unidades: captura.bruto?.hourly_units,
      intervaloOriginal: [captura.bruto?.hourly?.time?.[0], captura.bruto?.hourly?.time?.at?.(-1)],
      normalizado: { alturaMaxDiaM: normalizado.alturaMaxDiaM, temperaturaMarC: normalizado.temperaturaMarC, estadoMarDia: normalizado.estadoMarDia },
    })),
    executar("inmetPrevisao", () => buscarPrevisaoInmet(rio.codigoIbge, {
      fetchImpl: fetchCapturado("inmetPrevisao"), timeoutMs: 10000, esperarFn: semEspera,
    }), (normalizado, captura) => ({
      endpoint: captura.endpoint, statusHttp: captura.statusHttp, localidade: `${rio.nome}/${rio.uf}`, codigoIbge: rio.codigoIbge,
      datasOriginais: Object.keys(captura.bruto?.[rio.codigoIbge] || {}),
      dataNormalizada: normalizado.data, periodos: normalizado.periodos,
    })),
    executar("inmetAvisos", () => buscarAvisosInmet(rio.codigoIbge, {
      fetchImpl: fetchCapturado("inmetAvisos"), timeoutMs: 10000, esperarFn: semEspera, logger: { warn() {} },
    }), (normalizado, captura) => ({
      endpoint: captura.endpoint, statusHttp: captura.statusHttp, localidade: `${rio.nome}/${rio.uf}`, codigoIbge: rio.codigoIbge,
      totalOriginalPais: Array.isArray(captura.bruto) ? captura.bruto.length : Object.keys(captura.bruto || {}).length,
      totalAplicavelMunicipio: normalizado.avisos.length,
      avisos: normalizado.avisos.map((aviso) => ({ id: aviso.id, fenomeno: aviso.descricao, severidade: aviso.severidade, inicio: aviso.inicio, fim: aviso.fim })),
    })),
    executar("climaSaude", () => climaSaude.consultar(rio, {
      fetchFn: fetchCapturado("climaSaude"), carregar: () => ({}), salvar: () => {}, tentativas: 1, timeoutMs: 10000,
    }), (resultado, captura) => ({
      endpoint: captura?.endpoint || new URL(rio.climaSaudeUrl).origin + new URL(rio.climaSaudeUrl).pathname,
      statusHttp: captura?.statusHttp || null, localidade: `${rio.nome}/${rio.uf}`, statusFonte: resultado.status,
      dataReferencia: resultado.dados?.dataConsulta || null,
      normalizado: resultado.dados ? { ehf: resultado.dados.ehf, riscoCombinado: resultado.dados.riscoCombinado, geoses: resultado.dados.geoses } : null,
    })),
    executar("corRio", async () => criarServicoCorRio({
      fetchImpl: fetchCapturado("corRio"), carregar: () => null, salvar: () => {}, ttlMs: 0, tentativas: 1, timeoutMs: 10000, esperarFn: semEspera, logger: { warn() {}, error() {} },
    }).obter(), (resultado) => ({
      endpoints: [
        "https://appcor.cor-rio.work/estagio_cidade",
        "https://appcor.cor-rio.work/calor_api",
        "https://cor.rio/wp-json/wp/v2/posts",
      ],
      localidade: "Rio de Janeiro/RJ", estados: {
        estagio: resultado.estagio?.status, calor: resultado.calor?.status, comunicados: resultado.comunicados?.status,
      },
      normalizado: { estagio: resultado.estagio?.dados?.rotulo || null, calor: resultado.calor?.dados?.rotulo || null, comunicados: resultado.comunicados?.itens?.length ?? null },
    })),
  ];

  const competencia = competenciaConfigurada();
  tarefas.push(executar("anaMonitorSecas", async () => {
    const url = `https://apimsbr.ana.gov.br/rest/cms-msne/mapa-monitor?mes=${competencia.mes}&ano=${competencia.ano}&final=true&response_format=apil5&use_fk=true&include_all_obj_fk=true&limit=1&orderBy=id,desc`;
    const resposta = await fetch(url, { signal: AbortSignal.timeout(10000), headers: { Accept: "application/json", Referer: "https://monitordesecas.ana.gov.br/" } });
    let bruto = null;
    try { bruto = await resposta.json(); } catch { /* registrado como payload inválido */ }
    if (!resposta.ok) throw new Error(`ANA Monitor de Secas: HTTP ${resposta.status}`);
    return { resposta, bruto, interpretado: interpretarApi(bruto, competencia) };
  }, ({ resposta, bruto, interpretado }) => ({
    endpoint: "https://apimsbr.ana.gov.br/rest/cms-msne/mapa-monitor", statusHttp: resposta.status,
    competencia: competencia.chave, formato: Array.isArray(bruto) ? "array" : typeof bruto,
    quantidadeRegistros: Array.isArray(bruto) ? bruto.length : Array.isArray(bruto?.data?.list) ? bruto.data.list.length : null,
    normalizado: { mapaId: interpretado.mapaId, nome: interpretado.nome, dataElaboracao: interpretado.dataElaboracao, ufsComDescricao: Object.keys(interpretado.descricoesUf).length },
  })));

  const resultados = Object.fromEntries(await Promise.all(tarefas));
  resultados.oceanop = Object.keys(oceanopAreas).length
    ? { status: "CONFIGURADO", bases: Object.keys(oceanopAreas), observacao: "Consulta real exige rede/VPN Petrobras." }
    : { status: "NÃO CONFIGURADO", observacao: "Nenhum identificador Oceanop confirmado em src/config/oceanopAreas.js." };

  console.log(JSON.stringify({
    auditoria: "fontes-reais-cim",
    iniciadoEm: inicio.toISOString(),
    concluidoEm: new Date().toISOString(),
    envioEmailExecutado: false,
    resultados,
  }, null, 2));
}

main().catch((erro) => {
  console.error(JSON.stringify({ status: "FALHA", ...erroSeguro(erro) }));
  process.exitCode = 1;
});
