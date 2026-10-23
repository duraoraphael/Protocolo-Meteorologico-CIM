const test = require("node:test");
const assert = require("node:assert/strict");

const { executarVerificacao, camposFaltando, situacaoDoErro, SITUACAO } = require("../src/logic/verificacaoFontes");
const { renderVerificacaoHtml, destinatariosVerificacao, enviarVerificacaoFontes } = require("../src/email/sendVerificacaoFontes");
const { executarVerificacaoFontes } = require("../src/scheduler");
const { getCidade } = require("../src/config/cities");
const climaSaude = require("../src/sources/climaSaudeService");
const { criarServicoCorRio } = require("../src/sources/corRio");

const RIO = getCidade("rio_de_janeiro");
const PERIODO = { resumo: "Poucas nuvens", tempMax: 31, tempMin: 20 };
const semEspera = async () => {};

function json(corpo, status = 200) {
  return new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } });
}

function fetchCorRio(url) {
  if (url.includes("estagio_cidade")) return Promise.resolve(json({ estagio: "Estágio 1", inicio: "2026-10-13T10:00:00" }));
  if (url.includes("calor_api")) return Promise.resolve(json("calor 1"));
  return Promise.resolve(json([]));
}

// ANA simulada: listagem do bucket (meses e mapas estaduais) + API mensal.
function fetchAna(comp) {
  const aaaamm = `${comp.ano}${String(comp.mes).padStart(2, "0")}`;
  const xml = (corpo) => new Response(`<ListBucketResult><IsTruncated>false</IsTruncated>${corpo}</ListBucketResult>`, { status: 200 });
  return async (url) => {
    const u = new URL(url);
    if (u.hostname.startsWith("ana-monitor-secas-files")) {
      const prefixo = u.searchParams.get("prefix");
      if (prefixo === "uploads/produtos/srm_persist/") return xml(`<CommonPrefixes><Prefix>${prefixo}${aaaamm}/</Prefix></CommonPrefixes>`);
      return xml(`<Contents><Key>${prefixo}ms_rio_de_janeiro_${aaaamm}.png</Key><ETag>"x"</ETag><Size>10</Size></Contents>`);
    }
    const mes = Number(u.searchParams.get("mes"));
    const ano = Number(u.searchParams.get("ano"));
    if (mes !== comp.mes || ano !== comp.ano) return json({ data: { list: [] } });
    return json({ data: { list: [{ id: 1, mes, ano, final: true, nome: comp.rotulo.replace("/", " de ") }] } });
  };
}

// Fontes saudáveis; cada teste troca só a que quer quebrar.
function fontesOk(extra = {}) {
  const { competenciaDeChave } = require("../src/sources/monitorSecas");
  return {
    avisosInmet: async () => ({ avisos: [] }),
    previsaoInmet: async () => ({ data: "13/10/2026", periodos: { manha: PERIODO, tarde: PERIODO, noite: PERIODO } }),
    observacaoInmet: async () => ({ observacao: { medidoEm: "2026-10-13T12:00:00.000Z", estacao: { codigo: "A636" }, temperaturaMinC: 22, temperaturaMaxC: 37, chuvaUltimaHoraMm: 0.8, ventoVelocidadeKmh: 12, ventoDirecaoGraus: 180, rajadaKmh: 31 } }),
    openMeteo: async () => ({ tempMin: 20, tempMax: 31, umidadeMin: 45, umidadeMax: 90, precipitacaoTotalMm: 2, probabilidadeChuvaMax: 60, uvMax: 8, periodos: { manha: { velocidadeMediaKmh: 12, direcao: "E" } } }),
    marine: async () => ({ dados: { alturaMaxDiaM: 1.2, periodos: [{ periodoOndaS: 8 }] }, erro: null }),
    rajadasTetraTech: async () => ({ picosDiarios: [{ rajadaPrevistaKmH: 42 }] }),
    climaSaude: async () => ({ status: "operacional", dados: { dataConsulta: "2026-10-13", municipio: "Rio de Janeiro", uf: "RJ", ehf: { classificacao: "Sem excesso" }, riscoCombinado: "Normal" } }),
    oceanop: async (ponto) => ({ previsoes: [{ local: ponto.id }] }),
    corRio: (opcoes) => criarServicoCorRio({ ...opcoes, fetchImpl: fetchCorRio, esperarFn: semEspera }),
    fetch: fetchAna(competenciaDeChave("2026-08")),
    ...extra,
  };
}

function itemDe(resultado, fonte) {
  return resultado.itens.find((i) => i.fonte === fonte);
}

test("todas as fontes saudáveis: nenhum problema; integrações sem configuração não contam como problema", async () => {
  const r = await executarVerificacao({ cidades: [RIO], env: {}, fontes: fontesOk() });
  assert.deepEqual(r.problemas, []);
  assert.equal(itemDe(r, "Oceanop").situacao, SITUACAO.OK);
  assert.equal(itemDe(r, "Open-Meteo").situacao, SITUACAO.OK);
  assert.equal(itemDe(r, "Open-Meteo Marine").situacao, SITUACAO.OK);
  assert.equal(itemDe(r, "Tetra Tech — rajada").situacao, SITUACAO.OK);
});

test("Clima e Saúde com layout alterado é classificado como formato alterado, não como fora do ar", async () => {
  const fetchFn = async () => new Response("<html><body><h1>Nova página</h1></body></html>", { status: 200 });
  const consultar = (cidade, opcoes) => climaSaude.consultar(cidade, {
    ...opcoes, fetchFn, tentativas: 1, carregar: () => ({}), salvar: () => {},
  });
  const r = await executarVerificacao({ cidades: [RIO], env: {}, fontes: fontesOk({ climaSaude: consultar }) });
  const item = itemDe(r, "Clima e Saúde");
  assert.equal(item.situacao, SITUACAO.FORMATO_ALTERADO);
  assert.match(item.detalhe, /layout mudou/);
});

test("Clima e Saúde fora do ar é indisponível e informa se há última coleta válida", async () => {
  const fetchFn = async () => new Response("erro", { status: 503 });
  const consultar = (cidade, opcoes) => climaSaude.consultar(cidade, {
    ...opcoes, fetchFn, tentativas: 1, salvar: () => {},
    carregar: () => ({ [cidade.chave]: { consultadoEm: "2026-10-13T08:00:00.000Z" } }),
  });
  const r = await executarVerificacao({ cidades: [RIO], env: {}, fontes: fontesOk({ climaSaude: consultar }) });
  const item = itemDe(r, "Clima e Saúde");
  assert.equal(item.situacao, SITUACAO.INDISPONIVEL);
  assert.match(item.detalhe, /última coleta válida de 13\/10\/2026 05:00/);
});

test("COR-Rio com resposta fora do formato aponta a parte afetada", async () => {
  const fetchImpl = (url) => (url.includes("calor_api") ? Promise.resolve(json({ inesperado: true })) : fetchCorRio(url));
  const corRio = (opcoes) => criarServicoCorRio({ ...opcoes, fetchImpl, esperarFn: semEspera });
  const r = await executarVerificacao({ cidades: [RIO], env: {}, fontes: fontesOk({ corRio }) });
  assert.equal(itemDe(r, "COR-Rio (estágio de calor)").situacao, SITUACAO.FORMATO_ALTERADO);
  assert.equal(itemDe(r, "COR-Rio (estágio operacional)").situacao, SITUACAO.OK);
});

test("INMET Observação sem temperatura, chuva ou rajada gera campos ausentes", async () => {
  const observacaoInmet = async () => ({ observacao: { medidoEm: "2026-10-13T12:00:00.000Z", estacao: { codigo: "A636" }, temperaturaMinC: null, temperaturaMaxC: null, chuvaUltimaHoraMm: null, ventoVelocidadeKmh: 12, ventoDirecaoGraus: 180, rajadaKmh: null } });
  const r = await executarVerificacao({ cidades: [RIO], env: {}, fontes: fontesOk({ observacaoInmet }) });
  const item = itemDe(r, "INMET Observação");
  assert.equal(item.situacao, SITUACAO.CAMPOS_AUSENTES);
  assert.match(item.detalhe, /temperatura mínima observada/);
  assert.match(item.detalhe, /chuva horária observada/);
  assert.match(item.detalhe, /rajada medida pela estação/);
});

test("falha de DNS no OCEANOP vira indisponível sem acionar Climatempo", async () => {
  const dns = Object.assign(new Error("OCEANOP: falha de resolução DNS"), { tipo: "dns" });
  const r = await executarVerificacao({ cidades: [RIO], env: {}, fontes: fontesOk({ oceanop: async () => { throw dns; } }) });
  assert.equal(itemDe(r, "Oceanop").situacao, SITUACAO.INDISPONIVEL);
  assert.equal(r.itens.some((item) => /Climatempo/i.test(item.fonte)), false);
});

test("ANA informa a publicação mais recente e avisa quando a competência fixada é outra", async () => {
  const { competenciaDeChave } = require("../src/sources/monitorSecas");
  const fetch = fetchAna(competenciaDeChave("2026-08"));
  const anterior = process.env.MONITOR_SECAS_COMPETENCIA;
  try {
    delete process.env.MONITOR_SECAS_COMPETENCIA;
    let item = itemDe(await executarVerificacao({ cidades: [RIO], env: {}, fontes: fontesOk({ fetch }) }), "ANA Monitor de Secas");
    assert.equal(item.situacao, SITUACAO.OK);
    assert.match(item.detalhe, /Publicação mais recente: Agosto\/2026 \(mapa final na API e 1 mapas estaduais no bucket\)/);
    assert.doesNotMatch(item.detalhe, /MONITOR_SECAS_COMPETENCIA/);

    process.env.MONITOR_SECAS_COMPETENCIA = "2026-07";
    item = itemDe(await executarVerificacao({ cidades: [RIO], env: {}, fontes: fontesOk({ fetch }) }), "ANA Monitor de Secas");
    assert.equal(item.situacao, SITUACAO.OK);
    assert.match(item.detalhe, /MONITOR_SECAS_COMPETENCIA=2026-07 fixa outra referência/);
  } finally {
    if (anterior === undefined) delete process.env.MONITOR_SECAS_COMPETENCIA;
    else process.env.MONITOR_SECAS_COMPETENCIA = anterior;
  }
});

test("utilitários: campos faltando e classificação de erro", () => {
  assert.deepEqual(camposFaltando({ a: { b: 0 }, c: "" }, { "a.b": "B", c: "C", "d.e": "E" }), ["C", "E"]);
  assert.equal(situacaoDoErro(Object.assign(new Error("x"), { name: "ParserError" })), SITUACAO.FORMATO_ALTERADO);
  assert.equal(situacaoDoErro(Object.assign(new Error("x"), { tipo: "timeout" })), SITUACAO.INDISPONIVEL);
});

test("e-mail técnico: escapa conteúdo, só aceita endereços válidos e não envia sem destinatário", async () => {
  const resultado = {
    verificadoEm: "2026-10-13T07:30:00.000Z",
    itens: [{ fonte: "Clima e Saúde", escopo: "Rio", situacao: "formato_alterado", detalhe: "<script>x</script>" }],
    problemas: [{}],
  };
  const html = renderVerificacaoHtml(resultado);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /Formato alterado/);
  assert.deepEqual(destinatariosVerificacao({ EMAIL_ALERTA_FONTES: "a@b.com, invalido, c@d.com.br" }), ["a@b.com", "c@d.com.br"]);
  assert.deepEqual(await enviarVerificacaoFontes(resultado, { env: {} }), { enviado: false, motivo: "EMAIL_ALERTA_FONTES não configurado" });
});

test("agendador só aciona o aviso quando há problema e não derruba o processo em falha", async () => {
  let avisos = 0;
  const avisar = async () => { avisos += 1; return { enviado: false, motivo: "teste" }; };
  await executarVerificacaoFontes({ verificar: async () => ({ itens: [{}], problemas: [] }), avisar });
  assert.equal(avisos, 0);
  await executarVerificacaoFontes({
    verificar: async () => ({ itens: [{}], problemas: [{ situacao: "indisponivel", fonte: "X", escopo: "Y", detalhe: "Z" }] }),
    avisar,
  });
  assert.equal(avisos, 1);
  assert.equal(await executarVerificacaoFontes({ verificar: async () => { throw new Error("boom"); }, avisar }), null);
});
