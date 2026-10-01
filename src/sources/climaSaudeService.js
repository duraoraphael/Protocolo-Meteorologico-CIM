// Integração exclusivamente server-side com as páginas públicas municipais.
// O portal entrega os dados de "Comparar" e GeoSES no HTML inicial (SSR).
const fs = require('node:fs');
const path = require('node:path');
const tls = require('node:tls');
const { Agent } = require('undici');
const cheerio = require('cheerio');
const { formatarDataBrasilia, registrarFalha } = require('./sourceHealth');

const ARQUIVO = path.join(__dirname, '..', '..', 'data', 'clima-saude.json');
const FONTE = 'Clima e Saúde — Ministério da Saúde';
// Escopo exclusivo desta fonte: confia nas CAs corporativas do Windows sem
// desligar a validação TLS nem alterar SMTP ou as outras integrações.
let agenteSistema;
function dispatcherSistema() {
  if (!agenteSistema) {
    const ca = tls.getCACertificates?.('system') || [];
    agenteSistema = ca.length ? new Agent({ connect: { ca } }) : null;
  }
  return agenteSistema;
}
const NIVEIS = Object.freeze({
  'sem excesso': { grau: 'NORMAL', protocolo: null, gravidade: 'normal' },
  baixo: { grau: 'ATENÇÃO', protocolo: 'P1', gravidade: 'atencao' },
  severo: { grau: 'ALERTA', protocolo: 'P2', gravidade: 'alto' },
  extremo: { grau: 'EMERGÊNCIA', protocolo: 'P3', gravidade: 'severo' },
});
const RECOMENDACOES = Object.freeze({
  P1: [
    'Reforçar hidratação.',
    'Realizar pausas em sombra ou ambiente climatizado.',
    'Realizar ajuste de horário das atividades com exposição, preferindo períodos mais cedo ou mais tarde.',
  ],
  P2: [
    'Impor pausas adicionais e rodízio em atividades essenciais.',
    'Paralisar atividades não essenciais.',
    'Limitar tarefas pesadas.',
    'Ampliar vigilância.',
    'Disponibilizar água e local de recuperação.',
    'Disponibilizar protetor solar e intensificar o uso.',
    'Preparar equipe de saúde para aumento de demanda de atendimento.',
  ],
  P3: [
    'Cessar trabalho externo.',
    'Remover pessoas para ambiente climatizado.',
    'Assistência médica imediata e remoção conforme PRE, se necessário.',
  ],
});

function normalizar(texto) {
  return String(texto || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
}
function numero(texto) {
  const valor = String(texto || '').match(/-?\d+(?:[.,]\d+)?/);
  return valor ? Number(valor[0].replace(',', '.')) : null;
}
function nivelEhf(classificacao) {
  return NIVEIS[normalizar(classificacao)] || null;
}
function recomendacoesCalor(nivel) {
  if (!nivel?.protocolo) return [];
  return [...RECOMENDACOES.P1, ...(nivel.protocolo === 'P2' || nivel.protocolo === 'P3' ? RECOMENDACOES.P2 : []), ...(nivel.protocolo === 'P3' ? RECOMENDACOES.P3 : [])];
}

function interpretarHtml(html, { url, consultadoEm = new Date().toISOString() } = {}) {
  const $ = cheerio.load(html);
  // Não interpreta scripts de hidratação: os campos úteis estão no HTML SSR.
  $('script, style, svg').remove();
  const municipio = $('h1').first().text().trim() || null;
  const uf = $('h1').first().parent().find('p').first().text().match(/\b[A-Z]{2}\b/)?.[0] || null;
  const ehfBadge = $('[aria-label^="EHF:"]').first().attr('aria-label')?.replace(/^EHF:\s*/, '').trim() || null;
  const riscoCombinado = $('[aria-label^="Risco Combinado:"]').first().attr('aria-label')?.replace(/^Risco Combinado:\s*/, '').trim() || null;
  const rotuloEhf = $('span').filter((_, el) => $(el).text().trim() === 'EHF').first();
  const linhaEhf = rotuloEhf.parent();
  const spansEhf = linhaEhf.children('span');
  const valorEhf = numero(spansEhf.eq(1).text());
  const classificacao = ehfBadge || spansEhf.filter((_, el) => Boolean(nivelEhf($(el).text()))).first().text().trim() || null;
  const linhaTemperatura = linhaEhf.next().text().replace(/\s+/g, ' ');
  const geosesRotulo = $('p').filter((_, el) => /Vulnerabilidade social\s*\(GeoSES\)/i.test($(el).text())).first();
  const geosesTexto = geosesRotulo.parent().find('span').first().text();
  const dataConsulta = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(consultadoEm));
  const previsaoDias = $('[aria-label]').map((_, el) => $(el).attr('aria-label'))
    .get().map((rotulo) => rotulo.match(/^(\d{4}-\d{2}-\d{2}):\s*(Sem excesso|Baixo|Severo|Extremo),\s*(-?\d+(?:[.,]\d+)?)°/i))
    .filter((partes) => partes && partes[1] >= dataConsulta).map((partes) => ({ data: partes[1], classificacao: partes[2], tempMax: numero(partes[3]) }));
  if (!municipio || !uf || !nivelEhf(classificacao) || rotuloEhf.length === 0) {
    throw new Error('HTML municipal sem município, UF ou classificação EHF reconhecível.');
  }
  const nivel = nivelEhf(classificacao);
  return {
    source: FONTE, municipio, uf, dataConsulta,
    ehf: { valor: valorEhf, classificacao }, riscoCombinado,
    temperatura: {
      media: numero(linhaTemperatura.match(/Média\s+(-?\d+(?:[.,]\d+)?)/i)?.[1]),
      maxima: numero(linhaTemperatura.match(/(?:Hoje|Máx)\s+(-?\d+(?:[.,]\d+)?)/i)?.[1]),
      minima: numero(linhaTemperatura.match(/mín\s+(-?\d+(?:[.,]\d+)?)/i)?.[1]),
    },
    geoses: { valor: numero(geosesTexto), classificacao: geosesTexto.match(/\(([^)]+)\)/)?.[1] || null },
    previsaoDias, consultadoEm, urlFonte: url || null,
    nivel, recomendacoes: recomendacoesCalor(nivel),
  };
}

function validarUrl(url) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'clima.saude.gov.br' || parsed.port || parsed.username || parsed.password || !/^\/[a-z]{2}\/[a-z0-9-]+$/.test(parsed.pathname)) {
    throw new Error('URL Clima e Saúde inválida ou fora do domínio permitido.');
  }
  return parsed.href;
}
function lerCache() {
  try { return JSON.parse(fs.readFileSync(ARQUIVO, 'utf8')); }
  catch (erro) { if (erro.code === 'ENOENT') return {}; throw erro; }
}
function gravarCache(estado) {
  fs.mkdirSync(path.dirname(ARQUIVO), { recursive: true });
  const tmp = `${ARQUIVO}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(estado, null, 2), 'utf8');
  fs.renameSync(tmp, ARQUIVO);
}
function lerArmazenado(cidade, { carregar = lerCache } = {}) {
  if (!cidade.climaSaudeUrl) return { status: 'nao_configurada', mensagem: 'Clima e Saúde: não configurado para esta base.', dados: null };
  let dados = null;
  try { dados = carregar()[cidade.chave] || null; }
  catch (erro) { console.error(`[CLIMA-SAÚDE][ERRO] cache: ${erro.message}`); }
  return dados
    ? {
      status: 'armazenado',
      mensagem: `Última coleta válida: ${formatarDataBrasilia(dados.consultadoEm) || 'horário indisponível'}.`,
      dados,
      lastSuccessAt: dados.consultadoEm || null,
    }
    : { status: 'indisponivel', mensagem: 'Clima e Saúde: dados indisponíveis nesta atualização.', dados: null };
}
async function consultar(cidade, { fetchFn = fetch, carregar = lerCache, salvar = gravarCache, tentativas = 2, timeoutMs = 8000 } = {}) {
  if (!cidade.climaSaudeUrl) return lerArmazenado(cidade, { carregar });
  let url;
  try { url = validarUrl(cidade.climaSaudeUrl); }
  catch (erro) { return { status: 'indisponivel', mensagem: erro.message, dados: null }; }
  console.log(`[CLIMA-SAÚDE] Consultando ${cidade.nome}/${cidade.uf}`);
  for (let i = 0; i < tentativas; i++) {
    try {
      const resposta = await fetchFn(url, {
        signal: AbortSignal.timeout(timeoutMs), redirect: 'error',
        ...(fetchFn === globalThis.fetch && dispatcherSistema() ? { dispatcher: dispatcherSistema() } : {}),
        headers: { 'User-Agent': 'Protocolo-Meteorologico-CIM/1.0 (consulta publica institucional)', Accept: 'text/html' },
      });
      console.log(`[CLIMA-SAÚDE] HTTP ${resposta.status}`);
      if (resposta.status !== 200) throw new Error(`HTTP ${resposta.status}`);
      const html = await resposta.text();
      if (Buffer.byteLength(html, 'utf8') > 2_000_000) throw new Error('HTML maior que o limite de 2 MB.');
      const dados = interpretarHtml(html, { url });
      const esperado = cidade.climaSaudeMunicipio || cidade.nome;
      if (normalizar(dados.municipio) !== normalizar(esperado) || dados.uf !== cidade.uf) throw new Error('Município/UF da página não corresponde à base.');
      const estado = carregar();
      estado[cidade.chave] = dados;
      salvar(estado);
      console.log(`[CLIMA-SAÚDE] EHF=${dados.ehf.classificacao}; Risco=${dados.riscoCombinado ?? 'indisponível'}; dados armazenados.`);
      return { status: 'operacional', mensagem: 'Dados atualizados.', dados };
    } catch (erro) {
      registrarFalha(`CLIMA-SAÚDE:${cidade.chave}`, erro);
    }
  }
  let ultimoValido = null;
  try { ultimoValido = carregar()[cidade.chave] || null; } catch (erro) { console.error(`[CLIMA-SAÚDE][ERRO] cache: ${erro.message}`); }
  if (ultimoValido) {
    return {
      status: 'degradado',
      mensagem: `Consulta atual indisponível. Utilizando última coleta válida de ${formatarDataBrasilia(ultimoValido.consultadoEm) || 'horário indisponível'}.`,
      dados: ultimoValido,
      ultimoValido,
      lastSuccessAt: ultimoValido.consultadoEm || null,
    };
  }
  return {
    status: 'indisponivel',
    mensagem: 'Clima e Saúde: dados indisponíveis nesta atualização.',
    dados: null,
    ultimoValido: null,
  };
}

module.exports = { interpretarHtml, nivelEhf, recomendacoesCalor, consultar, lerArmazenado, validarUrl, ARQUIVO };
