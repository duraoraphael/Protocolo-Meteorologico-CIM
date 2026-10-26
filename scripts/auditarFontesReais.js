// Auditoria somente leitura: não gera PDF, não envia e-mail e não reinicia serviços.
require("../src/security/certificados");
const { CIDADES } = require("../src/config/cities");
const { buscarPrevisaoInmet, buscarAvisosInmet } = require("../src/sources/inmet");
const { buscarOpenMeteo } = require("../src/sources/openMeteo");
const climaSaude = require("../src/sources/climaSaudeService");

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
      openMeteoForecast: await executar(() => buscarOpenMeteo(cidade.latitude, cidade.longitude, {
        fuso: cidade.fusoHorario || "America/Sao_Paulo",
        diasPrevisao: 4,
        logger: null,
      }), (r) => ({
        modelo: r.modelo,
        dataReferencia: r.dataReferencia,
        previsaoDias: r.previsaoDias.map((dia) => dia.data),
        rajadaMaxKmh: r.rajadaMaxKmh,
        chuvaPrevistaDiaMm: r.precipitacaoPrevistaDiaMm,
        chuvaPrevistaJanelaMm: r.precipitacaoTotalMm,
        probabilidadeJanelaPct: r.probabilidadeChuvaMax,
        probabilidadeDiariaPct: r.probabilidadeChuvaDiariaPct,
        modelosIndicadores: r.modelosIndicadores,
        cache: r.cache,
      })),
    };
  }
  const rio = CIDADES.rio_de_janeiro;
  resultados.inmetAvisos = await executar(() => buscarAvisosInmet(rio.codigoIbge), (r) => ({ quantidade: r.avisos?.length || 0 }));
  console.log(JSON.stringify({ auditoria: "fontes-autorizadas-cim", concluidoEm: new Date().toISOString(), envioEmailExecutado: false, resultados }, null, 2));
}

main().catch((erro) => { console.error(JSON.stringify(seguro(erro))); process.exitCode = 1; });
