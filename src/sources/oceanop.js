const ENDPOINT = 'https://oceanop-api-disp.petrobras.com.br/api/v1/previsao/JsonPrevisaoAreaAsync';

// Units and timezone are not specified by the supplied Oceanop contract.
// Do not convert these values into the existing dashboard's km/h or current weather.
const CAMPOS = [
 ['Temperatura','Temperatura'], ['Condicao_Clima','Condição do clima'],
 ['DirecaoVento','Direção do vento'], ['VelocidadeVento','Vento'],
 ['VelocidadeVento_10M_Rajada','Rajada a 10 m'], ['VelocidadeVento_50M_Rajada','Rajada a 50 m'],
 ...[20,30,40,50,80,100].map(h=>['VelocidadeVento_'+h+'M','Vento a '+h+' m']),
 ['Precipitacao','Precipitação'], ['Visibilidade','Visibilidade'], ['PressaoNivelMar','Pressão ao nível do mar'],
 ['Cobertura_Nuvem_Baixa','Cobertura de nuvens baixas'], ['Cobertura_Nuvem_Media','Cobertura de nuvens médias'], ['Cobertura_Nuvem_Alta','Cobertura de nuvens altas'],
 ['AlturaOnda','Altura de onda'], ['AlturaMaximaOnda','Altura máxima de onda'], ['DirecaoOnda','Direção de onda'], ['PeriodoOnda','Período de onda'], ['PeriodoPicoOnda','Período de pico de onda'],
 ['Direcao_VentoOnda','Direção de vento/onda'], ['Direcao_AlturaVentoOnda','Direcao_AlturaVentoOnda (campo da fonte)'], ['Periodo_VentoOnda','Período de vento/onda'],
 ['DirecaoOndulacao','Direção da ondulação'], ['AlturaOndulacao','Altura da ondulação'], ['PeriodoOndulacao','Período da ondulação'],
 ['Latitude','Latitude informada'], ['Longitude','Longitude informada'], ['Confiabilidaae','Confiabilidade'], ['IndiceProbabilidadeTrovao','Índice de probabilidade de trovão'],
];
const TEXTUAIS = new Set(['Confiabilidaae','Condicao_Clima']);
function texto(valor) { return typeof valor === 'string' ? valor.trim().slice(0,500) : ''; }
function numero(valor) {
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : null;
  if (typeof valor !== 'string' || !/^[+-]?\d+(?:[.,]\d+)?$/.test(valor.trim())) return null;
  const n = Number(valor.trim().replace(',','.'));
  return Number.isFinite(n) ? n : null;
}
function validarConsulta(local) {
  if (typeof local !== 'string' || !local.trim() || local.length > 100 || /[\x00-\x1f\x7f]/.test(local)) {
    const erro = new Error('Informe o local Oceanop, com até 100 caracteres.');
    erro.status = 400; throw erro;
  }
  return {local:local.trim()};
}
function normalizarResposta(json) {
  if (!json || json.success !== true || !Array.isArray(json.data) || json.data.length > 10000) {
    throw new Error('Oceanop retornou uma resposta fora do formato esperado.');
  }
  return json.data.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('Oceanop retornou um registro inválido.');
    const valores = Object.fromEntries(CAMPOS.map(([chave]) => [chave, TEXTUAIS.has(chave) ? texto(item[chave]) || null : numero(item[chave])]));
    return { local:texto(item.Local), inicio:texto(item.DataInicial), fim:texto(item.DataFinal), escritoEm:texto(item.DataEscrita), valores };
  });
}
async function buscarOceanop(local, fetchImpl = fetch) {
  const consulta = validarConsulta(local);
  const url = new URL(ENDPOINT);
  url.searchParams.set('local',consulta.local);
  let resposta;
  try {
    resposta = await fetchImpl(url, {headers:{Accept:'application/json'},signal:AbortSignal.timeout(15000),redirect:'error'});
  } catch (erro) {
    if (erro.cause?.code === 'ENOTFOUND') throw new Error('Endereço Oceanop não resolvido. Verifique o endereço e o acesso do servidor à rede/VPN Petrobras.');
    if (erro.name === 'TimeoutError' || erro.name === 'AbortError') throw new Error('Oceanop não respondeu em 15 segundos. Tente novamente.');
    throw new Error('Não foi possível conectar ao Oceanop. Verifique a rede/VPN e os requisitos de acesso do serviço.');
  }
  if (!resposta.ok) {
    if ([401,403].includes(resposta.status)) throw new Error('Oceanop exige autorização. Confirme com o administrador o método de autenticação para o servidor.');
    if (resposta.status === 404) throw new Error('Endpoint Oceanop não encontrado (HTTP 404). Confirme o endereço com o administrador.');
    if (resposta.status === 429) throw new Error('Limite de consultas do Oceanop atingido. Aguarde antes de tentar novamente.');
    throw new Error(`Oceanop indisponível (HTTP ${resposta.status}). Tente novamente mais tarde.`);
  }
  let json;
  try { json = await resposta.json(); } catch { throw new Error('Oceanop não retornou JSON. Confirme os requisitos de autenticação e acesso à rede.'); }
  return { fonte:'Oceanop / Petrobras', consulta, consultadoEm:new Date().toISOString(), campos:CAMPOS.map(([chave,rotulo])=>({chave,rotulo})), previsoes:normalizarResposta(json) };
}
module.exports = { buscarOceanop, normalizarResposta, validarConsulta, numero };
