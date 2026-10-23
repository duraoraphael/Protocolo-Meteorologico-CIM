// Auditoria somente leitura: não gera PDF, não envia e-mail e não reinicia serviços.
require("../src/security/certificados");
const { CIDADES } = require("../src/config/cities");
const { buscarPrevisaoInmet, buscarAvisosInmet } = require("../src/sources/inmet");
const climaSaude = require("../src/sources/climaSaudeService");
const pontosOceanop = require("../src/config/oceanopPontos");
const { buscarOceanopPorCoordenadas } = require("../src/sources/oceanop");

const seguro = (erro) => ({ status: "FALHA", httpStatus: erro?.httpStatus || erro?.status || null, codigo: erro?.code || erro?.name || null, mensagem: erro?.message || String(erro) });
async function executar(tarefa, resumir = (valor) => valor) {
  try { return { status: "OK", ...resumir(await tarefa()) }; }
  catch (erro) { return seguro(erro); }
}

async function main() {
  const resultados = {};
  for (const [chave, cidade] of Object.entries(CIDADES)) {
    resultados[chave] = {
      base: `${cidade.nome}/${cidade.uf}`,
      coordenadas: [cidade.latitude, cidade.longitude],
      codigoIbge: cidade.codigoIbge,
      inmet: await executar(() => buscarPrevisaoInmet(cidade.codigoIbge), (r) => ({ data: r.data, periodos: Object.keys(r.periodos || {}), dias: r.dias?.length || 0 })),
      climaSaude: await executar(() => climaSaude.consultar(cidade, { carregar: () => ({}), salvar: () => {}, tentativas: 1, timeoutMs: 15000 }), (r) => ({ statusFonte: r.status, data: r.dados?.dataConsulta || null })),
      oceanop: await executar(() => buscarOceanopPorCoordenadas(pontosOceanop[chave], { tentativas: 1, timeoutMs: 15000 }), (r) => ({ endpoint: r.endpoint, registros: r.previsoes.length, locais: [...new Set(r.previsoes.map((p) => p.local))] })),
    };
  }
  const rio = CIDADES.rio_de_janeiro;
  resultados.inmetAvisos = await executar(() => buscarAvisosInmet(rio.codigoIbge), (r) => ({ quantidade: r.avisos?.length || 0 }));
  for (const [nome, url] of Object.entries({
    swaggerOceanop: "https://oceanop-api-disp.petrobras.com.br/swagger/v1/swagger.json",
    portalTtForecast: "https://petrobras.ttforecast.com.br/map",
    apiAreasTtForecast: "https://petrobras.ttforecast.com.br/api/v1/areas/json",
  })) {
    resultados[nome] = await executar(async () => {
      const resposta = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(15000) });
      return { statusHttp: resposta.status, contentType: resposta.headers.get("content-type") };
    });
  }
  console.log(JSON.stringify({ auditoria: "fontes-autorizadas-cim", concluidoEm: new Date().toISOString(), envioEmailExecutado: false, resultados }, null, 2));
}

main().catch((erro) => { console.error(JSON.stringify(seguro(erro))); process.exitCode = 1; });
