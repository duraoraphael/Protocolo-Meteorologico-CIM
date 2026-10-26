// Auditoria somente de leitura das fontes exigidas para cada base.
// Execute com: node --use-system-ca scripts/auditarReconstrucaoApis.js
require("dotenv").config({ quiet: true });
const { CIDADES } = require("../src/config/cities");
const { buscarPrevisaoInmet } = require("../src/sources/inmet");
const { buscarObservacaoInmet } = require("../src/sources/inmetObservations");
const { buscarQualidadeAr } = require("../src/sources/airQuality");
const { buscarOpenMeteo } = require("../src/sources/openMeteo");
const { buscarMar } = require("../src/sources/marine");

const agora = new Date();
const erroSeguro = (erro) => ({ codigo: erro?.code || null, http: erro?.httpStatus || null,
  tipo: erro?.tipo || erro?.name || "erro", mensagem: String(erro?.message || erro).slice(0, 250) });
const tentar = async (fn) => { try { return { ok: true, dados: await fn() }; }
  catch (erro) { return { ok: false, erro: erroSeguro(erro) }; } };
const status = (valido, falha) => valido ? "VALIDADO" : falha ? "FALHA" : "NÃO VERIFICADO";

async function auditar(cidade) {
  let httpPrevisao = null;
  const [previsao, observacao, ar, mar, weather] = await Promise.all([
    tentar(() => buscarPrevisaoInmet(cidade.codigoIbge, { agora, fuso: cidade.fusoHorario || "America/Sao_Paulo", municipio: cidade.nome, uf: cidade.uf, logger: null,
      fetchImpl: async (...args) => { const resposta = await fetch(...args); httpPrevisao = resposta.status; return resposta; } })),
    tentar(() => buscarObservacaoInmet(cidade, { agora: () => agora, logger: null })),
    tentar(() => buscarQualidadeAr(cidade, { now: agora, usarCache: false })),
    cidade.costeira
      ? tentar(() => buscarMar(cidade.pontoMar.latitude, cidade.pontoMar.longitude, {
        fuso: cidade.fusoHorario || "America/Sao_Paulo", logger: null,
      }))
      : Promise.resolve({ ok: true, dados: null }),
    tentar(() => buscarOpenMeteo(cidade.latitude, cidade.longitude, {
      now: agora, fuso: cidade.fusoHorario || "America/Sao_Paulo", diasPrevisao: 4, logger: null,
    })),
  ]);
  const obs = observacao.ok ? observacao.dados?.observacao : null;
  const fresca = observacao.ok && observacao.dados?.status === "operacional";
  const resumos = previsao.ok ? Object.values(previsao.dados?.periodos || {}).map(p => p?.resumo).filter(Boolean) : [];
  const qa = ar.ok ? ar.dados : null;
  const diaInmet = previsao.ok ? previsao.dados?.dias?.find(d => d.dataBr === previsao.dados.data) : null;
  const periodosInmet = previsao.ok ? previsao.dados?.periodos || {} : {};
  const agregadoObservado = observacao.ok ? observacao.dados?.agregado : null;
  const meteo = weather.ok ? weather.dados : null;
  const statusWeather = (valor) => status(Number.isFinite(valor), weather.ok);
  const linha = {
    localidade: `${cidade.nome}/${cidade.uf}`, codigoIbge: cidade.codigoIbge,
    coordenadas: [cidade.latitude, cidade.longitude],
    estacaoInmet: obs?.estacao?.codigo || null,
    observacaoInmet: {
      endpoint: `https://apiprevmet3.inmet.gov.br/estacao/proxima/${cidade.codigoIbge}`,
      status: observacao.dados?.status || "indisponivel",
      medidoEm: obs?.medidoEm || null,
      estacao: obs?.estacao ? {
        codigo: obs.estacao.codigo, nome: obs.estacao.nome,
        latitude: obs.estacao.latitude, longitude: obs.estacao.longitude,
        distanciaKm: obs.estacao.distanciaKm,
      } : null,
      cobertura: observacao.dados?.agregado?.cobertura || null,
    },
    temperaturaPrevista: { status: status(Number.isFinite(diaInmet?.tempMin) && Number.isFinite(diaInmet?.tempMax), previsao.ok),
      minima: diaInmet?.tempMin ?? null, maxima: diaInmet?.tempMax ?? null, data: diaInmet?.data || null, fonte: "INMET previsão municipal" },
    umidadePrevista: { status: status(Number.isFinite(diaInmet?.umidadeMin) && Number.isFinite(diaInmet?.umidadeMax), previsao.ok),
      minima: diaInmet?.umidadeMin ?? null, maxima: diaInmet?.umidadeMax ?? null, data: diaInmet?.data || null, fonte: "INMET previsão municipal" },
    temperatura: { status: status(fresca && Number.isFinite(obs?.temperaturaAtualC), true), valor: fresca ? obs?.temperaturaAtualC ?? null : null, em: obs?.medidoEm || null },
    umidade: { status: status(fresca && Number.isFinite(obs?.umidadeAtualPct), true), valor: fresca ? obs?.umidadeAtualPct ?? null : null, em: obs?.medidoEm || null },
    condicaoGeral: { status: status(resumos.length > 0, true), valor: resumos[0] || null, data: previsao.dados?.data || null },
    ventoPeriodoInmet: Object.fromEntries(["manha", "tarde", "noite"].map((chave) => [chave, {
      status: status(Number.isFinite(periodosInmet[chave]?.velocidadeMediaKmh), previsao.ok),
      valorKmh: periodosInmet[chave]?.velocidadeMediaKmh ?? null,
      consultadoEm: previsao.dados?.consultadoEm || null,
    }])),
    chuvaPeriodoInmet: Object.fromEntries(["manha", "tarde", "noite"].map((chave) => [chave, {
      statusAcumulado: status(Number.isFinite(periodosInmet[chave]?.precipitacaoMm), previsao.ok),
      acumuladoMm: periodosInmet[chave]?.precipitacaoMm ?? null,
      statusProbabilidade: status(Number.isFinite(periodosInmet[chave]?.probabilidadeChuva), previsao.ok),
      probabilidadePct: periodosInmet[chave]?.probabilidadeChuva ?? null,
      consultadoEm: previsao.dados?.consultadoEm || null,
    }])),
    chuvaDiariaObservada: { status: status(fresca && Number.isFinite(agregadoObservado?.precipitacaoTotalMm), true),
      valorMm: fresca ? agregadoObservado?.precipitacaoTotalMm ?? null : null,
      cobertura: agregadoObservado?.cobertura || null },
    marine: cidade.costeira ? {
      status: mar.ok ? "VALIDADO" : "FALHA",
      alturaMaxDiaM: mar.dados?.alturaMaxDiaM ?? null,
    } : { status: "NÃO APLICÁVEL" },
    rajadaPrevista: { status: status(Number.isFinite(meteo?.rajadaMaxKmh), weather.ok),
      valorKmh: meteo?.rajadaMaxKmh ?? null, fonte: "Open-Meteo Forecast",
      modelosIndicadores: meteo?.modelosIndicadores || null },
    chuva: {
      previstaDia: { status: statusWeather(meteo?.precipitacaoPrevistaDiaMm), valorMm: meteo?.precipitacaoPrevistaDiaMm ?? null, janela: "00h–24h dia civil local" },
      previstaJanela: { status: statusWeather(meteo?.precipitacaoTotalMm), valorMm: meteo?.precipitacaoTotalMm ?? null, janela: meteo?.janelaHoje?.rotulo || null },
      probabilidadeMax: { status: statusWeather(meteo?.probabilidadeChuvaMax), valorPct: meteo?.probabilidadeChuvaMax ?? null, janela: meteo?.janelaHoje?.rotulo || null },
      acumuladaEstimada: { status: statusWeather(meteo?.precipitacaoAcumuladaEstimadaMm), valorMm: meteo?.precipitacaoAcumuladaEstimadaMm ?? null,
        janela: meteo?.precipitacaoAcumuladaEstimadaJanela || null, cobertura: meteo?.precipitacaoAcumuladaEstimadaCobertura || null },
    },
    uv: { status: status(Number.isFinite(qa?.uvAtual), ar.ok), valor: qa?.uvAtual ?? null, em: qa?.referenciaEm || null },
    ar: { status: status(Number.isFinite(qa?.usAqi), ar.ok), valor: qa?.usAqi ?? null, classificacao: qa?.classificacao?.nivel || null, em: qa?.referenciaEm || null },
    endpoints: { inmet: `https://apiprevmet3.inmet.gov.br/previsao/${cidade.codigoIbge}`, inmetHttp: httpPrevisao,
      openMeteo: "https://api.open-meteo.com/v1/forecast", ar: "https://customer-air-quality-api.open-meteo.com/v1/air-quality",
      mar: cidade.costeira ? "https://customer-marine-api.open-meteo.com/v1/marine" : null },
    falhas: Object.fromEntries(Object.entries({ previsao, observacao, ar, mar, weather })
      .filter(([, resultado]) => !resultado.ok).map(([fonte, resultado]) => [fonte, resultado.erro])),
  };
  process.stdout.write(`${linha.localidade}: INMET previsão ${linha.temperaturaPrevista.status}/${linha.umidadePrevista.status}/${linha.condicaoGeral.status}, Forecast ${linha.rajadaPrevista.status}, chuva ${linha.chuva.previstaDia.status}, UV/ar ${linha.uv.status}/${linha.ar.status}\n`);
  return linha;
}

async function main() {
  const cidades = Object.values(CIDADES);
  const linhas = [];
  for (const cidade of cidades) linhas.push(await auditar(cidade));
  const resultado = { executadoEm: agora.toISOString(), linhas };
  process.stdout.write(`${JSON.stringify(resultado, null, 2)}\n`);
}

main().catch((erro) => { console.error(erroSeguro(erro)); process.exitCode = 1; });
