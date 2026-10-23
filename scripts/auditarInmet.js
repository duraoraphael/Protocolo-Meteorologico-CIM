const tls = require('node:tls');
const { Agent } = require('undici');
const { CIDADES } = require('../src/config/cities');
const { buscarObservacaoInmet, normalizarCatalogo, URL_CATALOGO } = require('../src/sources/inmetObservations');
const { buscarPrevisaoInmet } = require('../src/sources/inmet');
const { DISTANCIA_MAXIMA_TERMO_KM } = require('../src/logic/weatherSourcePolicy');

function distanciaKm(a, b) {
  const rad = (n) => n * Math.PI / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLon = rad(b.longitude - a.longitude);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return Math.round(6371 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x)) * 10) / 10;
}

async function main() {
  const ca = tls.getCACertificates?.('system') || [];
  const dispatcher = ca.length ? new Agent({ connect: { ca } }) : undefined;
  const fetchImpl = (url, options) => fetch(url, { ...options, dispatcher, signal: AbortSignal.timeout(15000) });
  let catalogo = [];
  let erroCatalogo = null;
  try {
    const resposta = await fetchImpl(URL_CATALOGO);
    if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`);
    catalogo = normalizarCatalogo(await resposta.json());
  } catch (erro) { erroCatalogo = erro.message; }
  const resultados = await Promise.all(Object.values(CIDADES).map(async (cidade) => {
    const [resultado, previsao] = await Promise.all([buscarObservacaoInmet(cidade, {
      fetchImpl,
      carregar: () => ({ versao: 1, bases: {} }),
      salvar: () => {},
      logger: null,
    }), buscarPrevisaoInmet(cidade.codigoIbge, { fetchImpl, logger: null }).catch((erro) => ({ erro: erro.message }))]);
    const alternativas = catalogo
      .filter((item) => item.entidade === 'INMET' && item.tipo === 'Automatica' && item.situacao === 'Operante' && Number.isFinite(item.latitude) && Number.isFinite(item.longitude))
      .map((item) => ({ codigo: item.codigo, nome: item.nome, uf: item.uf, distanciaKm: distanciaKm(cidade, item) }))
      .sort((a, b) => a.distanciaKm - b.distanciaKm)
      .slice(0, 5);
    const obs = resultado.observacao;
    return {
      cidade: cidade.chave, status: resultado.status, erro: resultado.erro || null,
      estacao: obs?.estacao || null, medidoEm: obs?.medidoEm || null,
      estacaoRepresentativa: Boolean(obs && obs.estacao.uf === cidade.uf && obs.estacao.distanciaKm <= DISTANCIA_MAXIMA_TERMO_KM),
      temperatura: obs ? { minima: obs.temperaturaMinC, maxima: obs.temperaturaMaxC, atual: obs.temperaturaAtualC } : null,
      umidade: obs ? { minima: obs.umidadeMinPct, maxima: obs.umidadeMaxPct, atual: obs.umidadeAtualPct } : null,
      previsaoInmet: previsao.erro ? { erro: previsao.erro } : {
        status: 'operacional', data: previsao.data,
        dias: previsao.dias.map((dia) => ({ data: dia.data, tempMin: dia.tempMin, tempMax: dia.tempMax, umidadeMin: dia.umidadeMin, umidadeMax: dia.umidadeMax })),
      },
      coberturaTemperatura: resultado.agregado.coberturaTemperatura,
      coberturaUmidade: resultado.agregado.coberturaUmidade,
      alternativas,
    };
  }));
  console.log(JSON.stringify({ consultadoEm: new Date().toISOString(), catalogo: { estacoes: catalogo.length, erro: erroCatalogo }, resultados }, null, 2));
}

main().catch((erro) => { console.error(erro); process.exitCode = 1; });
