const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");
const crypto = require("node:crypto");

const ms = require("../src/sources/monitorSecas");
const { renderPdfHtml } = require("../src/render/pdfTemplate");
const { CIDADES } = require("../src/config/cities");

const AGOSTO = ms.competenciaDeChave("2026-08");
const BUCKET = "https://ana-monitor-secas-files.s3.sa-east-1.amazonaws.com";

// PNG válido (escala de cinza, 1 bit) com as dimensões pedidas — os testes não
// dependem de rede. `marca` muda o conteúdo para diferenciar UFs e meses.
function pngTeste(largura = 900, altura = 1200, marca = 0) {
  const bloco = (tipo, dados) => {
    const corpo = Buffer.concat([Buffer.from(tipo, "latin1"), dados]);
    const tamanho = Buffer.alloc(4); tamanho.writeUInt32BE(dados.length);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(corpo));
    return Buffer.concat([tamanho, corpo, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(largura, 0); ihdr.writeUInt32BE(altura, 4); ihdr[8] = 1; ihdr[9] = 0;
  const linha = 1 + Math.ceil(largura / 8);
  const bruto = Buffer.alloc(altura * linha);
  bruto[1] = marca & 0xff;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    bloco("IHDR", ihdr), bloco("IDAT", zlib.deflateSync(bruto)), bloco("IEND", Buffer.alloc(0)),
  ]);
}

const TEXTOS = {
  33: "No Rio de Janeiro, em decorrência das chuvas acima da normalidade, a seca fraca (S0) recuou no centro e leste, enquanto a seca moderada (S1) recuou no oeste e nordeste. Os impactos são de curto e longo prazo (CL) no sudoeste e de curto prazo (C) nas demais áreas.",
  13: "No Amazonas, a seca moderada (S1) avançou no noroeste. Uma pequena porção de seca, na divisa com o Acre, passou de fraca (S0) para grave (S2). Os impactos são de curto prazo (C).",
  32: "No Espírito Santo, devido à piora nos indicadores, o norte do estado registrou avanço da seca moderada (S1), que agora cobre todo o território capixaba. Os impactos são de curto prazo (C).",
  28: "Em Sergipe, chuvas abaixo da média favoreceram o avanço da seca moderada (S1) no Sertão e da seca fraca (S0) no nordeste, como no Rio Grande do Norte. Os impactos são de curto prazo (C).",
  41: "No Paraná, as chuvas acima da média favoreceram o desaparecimento da seca fraca (S0), deixando todo estado sem seca relativa (SSR).",
};
// Áreas acumuladas em centésimos de % (formato real da API).
const AREAS = {
  33: { S0: 6424, S1: 2731, S2: 0, S3: 0, S4: 0 },
  32: { S0: 10000, S1: 10000, S2: 0, S3: 0, S4: 0 },
  41: { S0: 0, S1: 0, S2: 0, S3: 0, S4: 0 },
};
const NOMES_MES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

function respostaApi(comp, sobrescrever = {}) {
  const id = 300 + comp.mes;
  return {
    data: {
      list: [{
        id, nome: `${NOMES_MES[comp.mes - 1]} de ${comp.ano}`, mes: comp.mes, ano: comp.ano, final: true,
        path: "uploads/mapas/146_agosto2026.png", data_criacao: `${comp.ano}-${String(comp.mes + 1).padStart(2, "0")}-16T14:47:49`,
        descricao: [
          ...Object.entries(TEXTOS).map(([area, descricao]) => ({ mapa_id: id, tipo_area: 1, area: Number(area), descricao })),
          { mapa_id: id, tipo_area: 8, area: 3, descricao: "Texto regional, não estadual." },
        ],
        area: Object.entries(AREAS).flatMap(([areaId, cats]) =>
          Object.entries(cats).map(([categoria, area]) => ({ categoria, area, tipo_area: 1, area_id: Number(areaId), mapa_id: id }))),
        ...sobrescrever,
      }],
    },
  };
}

function xmlListagem({ prefixo, prefixos = [], arquivos = [] }) {
  return `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Name>ana-monitor-secas-files</Name><Prefix>${prefixo}</Prefix><IsTruncated>false</IsTruncated>` +
    arquivos.map((a) => `<Contents><Key>${a.chave}</Key><LastModified>2026-09-16T14:54:35.000Z</LastModified><ETag>&quot;${a.etag}&quot;</ETag><Size>${a.tamanho}</Size></Contents>`).join("") +
    prefixos.map((p) => `<CommonPrefixes><Prefix>${p}</Prefix></CommonPrefixes>`).join("") + "</ListBucketResult>";
}

/**
 * Fonte simulada: `meses` = { "2026-08": { api: true|false, ufs: ["RJ", ...] } }.
 * Os PNGs publicados ficam em `fonte.pngs[chave S3]`; `adulterar` troca o
 * conteúdo entregue sem mudar o ETag listado.
 */
function fonteFalsa(meses, { adulterar = new Set(), fora = false } = {}) {
  const chamadas = [];
  const pngs = {};
  for (const [chave, cfg] of Object.entries(meses)) {
    const comp = ms.competenciaDeChave(chave);
    for (const [i, uf] of (cfg.ufs || []).entries()) pngs[ms.chaveMapaUf(comp, uf)] = pngTeste(900, 1200, comp.mes * 40 + i);
  }
  const fn = async (url) => {
    chamadas.push(url);
    if (fora) throw new TypeError("fetch failed");
    const u = new URL(url);
    if (url.startsWith(`${BUCKET}/?`)) {
      const prefixo = u.searchParams.get("prefix");
      if (prefixo === ms.PREFIXO_PRODUTOS) {
        const prefixos = Object.keys(meses).map((c) => `${ms.PREFIXO_PRODUTOS}${c.replace("-", "")}/`);
        return new Response(xmlListagem({ prefixo, prefixos }), { status: 200 });
      }
      const arquivos = Object.entries(pngs).filter(([chave]) => chave.startsWith(prefixo))
        .map(([chave, png]) => ({ chave, tamanho: png.length, etag: crypto.createHash("md5").update(png).digest("hex") }));
      return new Response(xmlListagem({ prefixo, arquivos }), { status: 200 });
    }
    if (url.startsWith("https://apimsbr.ana.gov.br/")) {
      const chave = `${u.searchParams.get("ano")}-${String(u.searchParams.get("mes")).padStart(2, "0")}`;
      if (!meses[chave]?.api) return new Response(JSON.stringify({ data: { list: [] } }), { status: 200 });
      return new Response(JSON.stringify(respostaApi(ms.competenciaDeChave(chave))), { status: 200 });
    }
    const chaveS3 = url.slice(BUCKET.length + 1);
    if (pngs[chaveS3]) {
      const png = adulterar.has(chaveS3) ? pngTeste(900, 1200, 255) : pngs[chaveS3];
      return new Response(png, { status: 200 });
    }
    return new Response("", { status: 404 });
  };
  fn.chamadas = chamadas;
  fn.pngs = pngs;
  return fn;
}

function silenciar(t) {
  const { warn, error, log } = console;
  console.warn = () => {};
  console.error = () => {};
  console.log = () => {};
  t.after(() => Object.assign(console, { warn, error, log }));
}

function pastaTemporaria(t) {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), "ms-"));
  t.after(() => fs.rmSync(pasta, { recursive: true, force: true }));
  return pasta;
}

// O template lê o mapa da pasta padrão; nos testes aponta para a temporária.
function usarPasta(t, pasta) {
  const original = ms.mapaUfDataUri;
  t.after(() => { ms.mapaUfDataUri = original; });
  ms.mapaUfDataUri = (comp, uf) => original(comp, uf, pasta);
}

const AGOSTO_TODAS = { "2026-07": { api: true, ufs: ["RJ", "ES"] }, "2026-08": { api: true, ufs: Object.keys(ms.UFS) } };

test("competência: AAAA-MM validado; sem configuração o modo é automático", () => {
  assert.deepEqual(AGOSTO, { mes: 8, ano: 2026, chave: "2026-08", rotulo: "Agosto/2026" });
  assert.equal(ms.competenciaConfigurada(""), null);
  assert.deepEqual(ms.competenciaConfigurada("2026-08"), AGOSTO);
  assert.throws(() => ms.competenciaConfigurada("2026-13"));
  assert.throws(() => ms.competenciaConfigurada("agosto"));
  assert.equal(ms.intervaloVerificacaoMs("2"), 2 * 3_600_000);
  assert.equal(ms.intervaloVerificacaoMs(""), 12 * 3_600_000);
});

test("as 12 bases estão associadas à UF correta e cada UF tem mapa estadual no portal", () => {
  const esperado = {
    rio_de_janeiro: "RJ", macae: "RJ", cabiunas: "RJ", brasilia: "DF", manaus: "AM", santos: "SP",
    aracaju: "SE", natal: "RN", oiapoque: "AP", vitoria: "ES", araucaria: "PR", salvador: "BA",
  };
  assert.deepEqual(Object.fromEntries(Object.entries(CIDADES).map(([chave, c]) => [chave, c.uf])), esperado);
  const nomes = { RJ: "Rio de Janeiro", DF: "Distrito Federal", AM: "Amazonas", SP: "São Paulo", SE: "Sergipe", RN: "Rio Grande do Norte", AP: "Amapá", ES: "Espírito Santo", PR: "Paraná", BA: "Bahia" };
  for (const [uf, nome] of Object.entries(nomes)) assert.equal(ms.UFS[uf][1], nome);
  // Alias da tabela de UFs do próprio portal.
  assert.equal(ms.chaveMapaUf(AGOSTO, "RJ"), "uploads/produtos/srm_persist/202608/ms/ms_rio_de_janeiro_202608.png");
  assert.equal(ms.chaveMapaUf(AGOSTO, "DF"), "uploads/produtos/srm_persist/202608/ms/ms_distrito_federal_202608.png");
  assert.equal(ms.chaveMapaUf(AGOSTO, "ES"), "uploads/produtos/srm_persist/202608/ms/ms_espirito_santo_202608.png");
  assert.equal(ms.chaveMapaUf(AGOSTO, "SP"), "uploads/produtos/srm_persist/202608/ms/ms_sao_paulo_202608.png");
  assert.equal(ms.urlPaginaUf(AGOSTO, "BA"), "https://monitordesecas.ana.gov.br/srm/municipio/BA?data=08/2026");
});

test("interpretarApi: só o mês pedido e final; texto e áreas apenas da UF (tipo_area 1)", () => {
  const api = ms.interpretarApi(respostaApi(AGOSTO), AGOSTO);
  assert.equal(api.dataElaboracao, "2026-09-16T14:47:49");
  assert.equal(api.descricoesUf["32"], TEXTOS[32]);
  assert.equal(api.descricoesUf["3"], undefined, "texto regional não vira texto estadual");
  // Leitura idêntica à do portal: área/100 = % acumulado; categoria = diferença.
  assert.deepEqual(api.areasUf["33"], { si: 35.76, s0: 36.93, s1: 27.31, s2: 0, s3: 0, s4: 0 });
  assert.deepEqual(api.areasUf["32"], { si: 0, s0: 0, s1: 100, s2: 0, s3: 0, s4: 0 });
  assert.equal(api.areasUf["13"], undefined, "sem dado de área não se inventa percentual");

  assert.throws(() => ms.interpretarApi(respostaApi(AGOSTO, { mes: 9, nome: "Setembro de 2026" }), AGOSTO), /em vez de 8\/2026/);
  assert.throws(() => ms.interpretarApi(respostaApi(AGOSTO, { final: false }), AGOSTO), /versão final/);
  assert.throws(() => ms.interpretarApi(respostaApi(AGOSTO, { nome: "Julho de 2026" }), AGOSTO), /não corresponde/);
  assert.throws(() => ms.interpretarApi({ data: { list: [] } }, AGOSTO), /não publicou/);
  assert.equal(ms.percentuaisArea({ S0: 100, S1: 500, S2: 0, S3: 0, S4: 0 }), null, "acumulado incoerente é descartado");
  assert.equal(ms.percentuaisArea({ S0: 100, S1: 0 }), null, "categoria faltando é descartada");
});

test("listagem do bucket: prefixos de mês e arquivos com tamanho e ETag", () => {
  const xml = xmlListagem({ prefixo: "x", prefixos: ["uploads/produtos/srm_persist/202608/"], arquivos: [{ chave: "a.png", tamanho: 10, etag: "abc" }] });
  const r = ms.interpretarListagemS3(xml);
  assert.deepEqual(r.prefixos, ["uploads/produtos/srm_persist/202608/"]);
  assert.deepEqual(r.arquivos[0], { chave: "a.png", tamanho: 10, etag: "abc", modificadoEm: "2026-09-16T14:54:35.000Z" });
  assert.throws(() => ms.interpretarListagemS3("<html>erro</html>"), /fora do formato/);
});

test("PNG: aceita imagem íntegra e rejeita truncada ou corrompida", () => {
  const png = pngTeste();
  assert.deepEqual(ms.validarPngCompleto(png), { largura: 900, altura: 1200 });
  assert.throws(() => ms.validarPngCompleto(png.subarray(0, png.length - 20)), /truncado|incompleto/i);
  const corrompido = Buffer.from(png); corrompido[40] ^= 0xff;
  assert.throws(() => ms.validarPngCompleto(corrompido), /CRC|descompact/i);
  assert.throws(() => ms.validarPngCompleto(Buffer.from("<html>")), /não é um PNG/);
});

test("descoberta: mês mais novo com API final E mapas estaduais; mapa e texto do mesmo mês", async (t) => {
  silenciar(t);
  // Setembro já tem pasta no bucket, mas a API ainda não publicou o mapa final.
  const fetchFn = fonteFalsa({ ...AGOSTO_TODAS, "2026-09": { api: false, ufs: ["RJ"] } });
  const r = await ms.descobrirPublicacao({ fetchFn, gravar: false });
  assert.equal(r.competencia.chave, "2026-08");
  assert.equal(r.meta.competencia.chave, "2026-08");
  assert.equal(Object.keys(r.meta.mapasUf).length, 27);
});

test("coleta só a UF pedida, reutiliza entre bases da mesma UF e respeita o intervalo de verificação", async (t) => {
  silenciar(t);
  const pasta = pastaTemporaria(t);
  const fetchFn = fonteFalsa(AGOSTO_TODAS);
  const agora = new Date("2026-10-15T12:00:00Z");

  const rj = await ms.obterMonitorSecas({ uf: "RJ", fetchFn, pasta, agora, intervaloMs: 3_600_000 });
  assert.equal(rj.status, "operacional");
  assert.equal(rj.competencia.chave, "2026-08");
  assert.equal(rj.uf, "RJ");
  assert.equal(rj.mapaUf.chave, ms.chaveMapaUf(AGOSTO, "RJ"));
  assert.deepEqual(rj.resumosUf, [{ uf: "RJ", nome: "Rio de Janeiro", texto: TEXTOS[33], percentuais: { si: 35.76, s0: 36.93, s1: 27.31, s2: 0, s3: 0, s4: 0 } }]);
  assert.deepEqual(fs.readdirSync(path.join(pasta, "2026-08", "ufs")).sort(), ["RJ.json", "RJ.png"], "só a UF pedida é baixada");
  assert.ok(fs.readFileSync(path.join(pasta, "2026-08", "ufs", "RJ.png")).equals(fetchFn.pngs[ms.chaveMapaUf(AGOSTO, "RJ")]));

  // Outra base do RJ: mesma publicação, sem nenhuma requisição.
  const antes = fetchFn.chamadas.length;
  const macae = await ms.obterMonitorSecas({ uf: "RJ", fetchFn, pasta, agora, intervaloMs: 3_600_000 });
  assert.equal(macae.status, "cache");
  assert.equal(macae.mapaUf.sha256, rj.mapaUf.sha256);
  assert.equal(fetchFn.chamadas.length, antes);

  // ES dentro do intervalo: não verifica de novo, baixa só o PNG do ES.
  const es = await ms.obterMonitorSecas({ uf: "ES", fetchFn, pasta, agora, intervaloMs: 3_600_000 });
  assert.equal(es.status, "operacional");
  assert.deepEqual(fetchFn.chamadas.slice(antes), [ms.urlMapaUf(AGOSTO, "ES")]);
});

test("nova publicação é adotada após o intervalo; a anterior fica guardada", async (t) => {
  silenciar(t);
  const pasta = pastaTemporaria(t);
  await ms.obterMonitorSecas({ uf: "RJ", fetchFn: fonteFalsa(AGOSTO_TODAS), pasta, agora: new Date("2026-10-15T12:00:00Z"), intervaloMs: 3_600_000 });
  const comSetembro = fonteFalsa({ ...AGOSTO_TODAS, "2026-09": { api: true, ufs: ["RJ"] } });
  const r = await ms.obterMonitorSecas({ uf: "RJ", fetchFn: comSetembro, pasta, agora: new Date("2026-10-15T14:00:00Z"), intervaloMs: 3_600_000 });
  assert.equal(r.status, "operacional");
  assert.equal(r.competencia.rotulo, "Setembro/2026");
  assert.ok(fs.existsSync(path.join(pasta, "2026-08", "ufs", "RJ.png")), "cópia de agosto preservada");
});

test("download que não confere com a listagem não substitui nada e usa a última cópia válida", async (t) => {
  silenciar(t);
  const pasta = pastaTemporaria(t);
  await ms.obterMonitorSecas({ uf: "RJ", fetchFn: fonteFalsa(AGOSTO_TODAS), pasta, agora: new Date("2026-10-15T12:00:00Z"), intervaloMs: 0 });

  const setembro = ms.competenciaDeChave("2026-09");
  const adulterada = fonteFalsa({ ...AGOSTO_TODAS, "2026-09": { api: true, ufs: ["RJ"] } }, { adulterar: new Set([ms.chaveMapaUf(setembro, "RJ")]) });
  const r = await ms.obterMonitorSecas({ uf: "RJ", fetchFn: adulterada, pasta, agora: new Date("2026-10-16T12:00:00Z"), intervaloMs: 0 });
  assert.equal(r.status, "nao_confirmado");
  assert.equal(r.competencia.chave, "2026-08", "mantém a referência da cópia válida");
  assert.match(r.aviso, /Não foi possível confirmar a atualização.*Agosto\/2026/);
  assert.equal(r.resumosUf[0].texto, TEXTOS[33], "texto do mesmo mês do mapa exibido");
  assert.equal(fs.existsSync(path.join(pasta, "2026-09", "ufs", "RJ.png")), false, "nada inválido é gravado");
});

test("fonte fora do ar: cópia válida com aviso; sem cópia, indisponível — sem lançar", async (t) => {
  silenciar(t);
  const pasta = pastaTemporaria(t);
  await ms.obterMonitorSecas({ uf: "RJ", fetchFn: fonteFalsa(AGOSTO_TODAS), pasta, intervaloMs: 0 });
  const fora = fonteFalsa({}, { fora: true });

  const rj = await ms.obterMonitorSecas({ uf: "RJ", fetchFn: fora, pasta, intervaloMs: 0 });
  assert.equal(rj.status, "nao_confirmado");
  assert.equal(rj.competencia.chave, "2026-08");
  assert.match(rj.aviso, /Não foi possível confirmar/);

  const ba = await ms.obterMonitorSecas({ uf: "BA", fetchFn: fora, pasta, intervaloMs: 0 });
  assert.equal(ba.status, "indisponivel");
  assert.equal(ba.mensagem, "Monitor de Secas temporariamente indisponível para este estado.");
  assert.equal(fs.existsSync(path.join(pasta, "2026-08", "ufs", "BA.png")), false);
});

test("UF sem mapa estadual publicado no mês não recebe mapa de outra UF nem o nacional", async (t) => {
  silenciar(t);
  const pasta = pastaTemporaria(t);
  const r = await ms.obterMonitorSecas({ uf: "SP", fetchFn: fonteFalsa({ "2026-08": { api: true, ufs: ["RJ"] } }), pasta, intervaloMs: 0 });
  assert.equal(r.status, "indisponivel");
  assert.equal(fs.existsSync(path.join(pasta, "2026-08", "ufs", "SP.png")), false);
});

function relatorio(cidade, monitorSecas) {
  return {
    cidade,
    dataFormatadaLonga: "1 de outubro de 2026", dataFormatadaCurta: "01/10/2026", horaConsulta: "08:00",
    tabelaTemperaturaUmidade: [], ventoPorPeriodo: [], chuvaPorPeriodo: [],
    severidade: { grau: "ALERTA", eventos: [{ tipo: "vento", grau: "ALERTA", titulo: "ALERTA — VENTO", recomendacoes: ["Suspender içamentos."] }] },
    fontesAutomatizadas: [{ nome: "Open-Meteo", uso: "Previsão" }],
    deslocamento: { pedestres: [], transporte: [], condutores: [] }, edificacao: [],
    previsaoProximosDias: { status: "ok", fuso: "America/Sao_Paulo", localidade: { nome: cidade.nome, uf: cidade.uf }, dias: [{ data: "2026-10-02", dataFormatada: "02/10/2026", diaSemana: "sexta-feira" }] },
    monitorSecas,
  };
}

// Só o HTML da seção de seca (do título até a seção seguinte).
function secaoSeca(html) {
  const inicio = html.indexOf("Monitor de Secas — ");
  return html.slice(inicio, html.indexOf("Previsão para os próximos 3 dias"));
}

test("PDF: cada base mostra só o mapa e a situação da sua UF, uma única vez e no lugar da seção", async (t) => {
  silenciar(t);
  const pasta = pastaTemporaria(t);
  usarPasta(t, pasta);
  const fetchFn = fonteFalsa(AGOSTO_TODAS);
  const nomes = {
    RJ: "Rio de Janeiro", AM: "Amazonas", ES: "Espírito Santo", PR: "Paraná",
    RN: "Rio Grande do Norte", AP: "Amapá",
  };
  for (const chave of ["rio_de_janeiro", "macae", "cabiunas", "manaus", "vitoria", "natal", "oiapoque", "araucaria"]) {
    const cidade = CIDADES[chave];
    const dados = await ms.obterMonitorSecas({ uf: cidade.uf, fetchFn, pasta, intervaloMs: 3_600_000 });
    const html = renderPdfHtml(relatorio(cidade, dados));
    const secao = secaoSeca(html);

    assert.equal((html.match(/<h4 class="subsecao ms-titulo">/g) || []).length, 1, `${chave}: seção única`);
    assert.ok(html.indexOf("Monitor de Secas — ") < html.indexOf("Previsão para os próximos 3 dias"), chave);
    assert.match(secao, new RegExp(`Monitor de Secas — ${nomes[cidade.uf]} / ${cidade.uf}</h4>`));
    assert.match(secao, /<strong>Referência:<\/strong> Agosto\/2026 — publicação mensal da ANA \(mapa final elaborado em 16\/09\/2026\)/);
    assert.match(secao, /não é previsão meteorológica diária/);
    const png = fetchFn.pngs[ms.chaveMapaUf(AGOSTO, cidade.uf)];
    assert.ok(secao.includes(`src="data:image/png;base64,${png.toString("base64")}"`), `${chave}: mapa estadual da própria UF embutido`);
    assert.match(secao, /Situação no estado/);
    assert.ok(secao.includes(`Não é uma classificação específica para a base ${cidade.nome}`), chave);
    assert.match(secao, /Fonte:<\/strong> ANA — Monitor de Secas\. Mapa estadual e texto da mesma publicação \(Agosto\/2026\)/);
    assert.ok(secao.includes(`https://monitordesecas.ana.gov.br/srm/municipio/${cidade.uf}?data=08/2026`));
    for (const [uf, nome] of Object.entries(nomes)) {
      if (uf !== cidade.uf) assert.doesNotMatch(secao, new RegExp(nome), `${chave} não pode citar ${nome}`);
    }
  }
});

test("PDF: áreas oficiais, movimentos, regiões e impactos só do que a fonte publica", async (t) => {
  silenciar(t);
  const pasta = pastaTemporaria(t);
  usarPasta(t, pasta);
  const fetchFn = fonteFalsa(AGOSTO_TODAS);

  const secaoRj = secaoSeca(renderPdfHtml(relatorio(CIDADES.macae, await ms.obterMonitorSecas({ uf: "RJ", fetchFn, pasta, intervaloMs: 3_600_000 }))));
  assert.match(secaoRj, /Área do estado por categoria — Agosto\/2026/);
  assert.match(secaoRj, /Sem Seca Relativa<\/td><td class="ms-area-pct">35,76%|Sem Seca Relativa<\/td><td class="ms-area-pct">35,8%/);
  assert.match(secaoRj, /S0 Seca Fraca<\/td><td class="ms-area-pct">36,9%/);
  assert.match(secaoRj, /S1 Seca Moderada<\/td><td class="ms-area-pct">27,3%/);
  const regioes = secaoRj.match(/Regiões citadas[\s\S]*?<\/div>/)[0];
  for (const r of ["centro", "leste", "oeste", "nordeste", "sudoeste"]) assert.match(regioes, new RegExp(`>${r}<`));
  assert.match(secaoRj, /Em relação ao mês anterior[\s\S]*?>Recuo</);
  assert.match(secaoRj, /Curto e longo prazo \(CL\)/);
  assert.match(secaoRj, /Evolução em relação ao mês anterior/);

  // AM: sem área publicada → categorias só pelo texto; "divisa com o Acre" é região.
  const secaoAm = secaoSeca(renderPdfHtml(relatorio(CIDADES.manaus, await ms.obterMonitorSecas({ uf: "AM", fetchFn, pasta, intervaloMs: 3_600_000 }))));
  assert.doesNotMatch(secaoAm, /Área do estado por categoria/);
  assert.match(secaoAm, /Intensidades citadas/);
  assert.match(secaoAm, /divisa com o Acre/);

  // PR: área toda sem seca; nenhum impacto citado.
  const secaoPr = secaoSeca(renderPdfHtml(relatorio(CIDADES.araucaria, await ms.obterMonitorSecas({ uf: "PR", fetchFn, pasta, intervaloMs: 3_600_000 }))));
  assert.match(secaoPr, /Sem Seca Relativa<\/td><td class="ms-area-pct">100%/);
  assert.doesNotMatch(secaoPr, /Tipos de impacto citados/);

  // BA: UF sem texto na fonte — informa a ausência sem concluir que não há seca.
  const secaoBa = secaoSeca(renderPdfHtml(relatorio(CIDADES.salvador, await ms.obterMonitorSecas({ uf: "BA", fetchFn, pasta, intervaloMs: 3_600_000 }))));
  assert.match(secaoBa, /Texto oficial da ANA não disponível.*A ausência de texto não indica ausência de seca/);
});

test("PDF: regiões citadas não confundem nomes de UF com direções", async (t) => {
  silenciar(t);
  const pasta = pastaTemporaria(t);
  usarPasta(t, pasta);
  const se = await ms.obterMonitorSecas({ uf: "SE", fetchFn: fonteFalsa(AGOSTO_TODAS), pasta, intervaloMs: 0 });
  const regioes = secaoSeca(renderPdfHtml(relatorio(CIDADES.aracaju, se))).match(/Regiões citadas[\s\S]*?<\/div>/)[0];
  assert.match(regioes, />Sertão</);
  assert.match(regioes, />nordeste</);
  assert.doesNotMatch(regioes, />norte</, "\"Rio Grande do Norte\" não é região do estado");
});

test("PDF: atualização não confirmada mostra o aviso e preserva a referência", async (t) => {
  silenciar(t);
  const pasta = pastaTemporaria(t);
  usarPasta(t, pasta);
  await ms.obterMonitorSecas({ uf: "RJ", fetchFn: fonteFalsa(AGOSTO_TODAS), pasta, intervaloMs: 0 });
  const dados = await ms.obterMonitorSecas({ uf: "RJ", fetchFn: fonteFalsa({}, { fora: true }), pasta, intervaloMs: 0 });
  const secao = secaoSeca(renderPdfHtml(relatorio(CIDADES.rio_de_janeiro, dados)));
  assert.match(secao, /Atualização não confirmada\.<\/strong> Não foi possível confirmar/);
  assert.match(secao, /<strong>Referência:<\/strong> Agosto\/2026/);
  assert.match(secao, /cópia validada armazenada/);
});

test("PDF: indisponível ou de outra UF não mostra mapa e não quebra o relatório", async (t) => {
  const html = renderPdfHtml(relatorio(CIDADES.rio_de_janeiro, {
    status: "indisponivel", uf: "RJ", competencia: null,
    mensagem: "Monitor de Secas temporariamente indisponível para este estado.",
    urls: { portal: ms.PORTAL_URL },
  }));
  const secao = secaoSeca(html);
  assert.match(secao, /Monitor de Secas — Rio de Janeiro \/ RJ<\/h4>/);
  assert.match(secao, /Monitor de Secas temporariamente indisponível para este estado\./);
  assert.doesNotMatch(secao, /<img/);
  assert.ok(html.indexOf("Previsão para os próximos 3 dias") > 0);

  silenciar(t);
  const pasta = pastaTemporaria(t);
  usarPasta(t, pasta);
  const es = await ms.obterMonitorSecas({ uf: "ES", fetchFn: fonteFalsa(AGOSTO_TODAS), pasta, intervaloMs: 0 });
  const trocado = secaoSeca(renderPdfHtml(relatorio(CIDADES.macae, es)));
  assert.match(trocado, /Monitor de Secas — Rio de Janeiro \/ RJ<\/h4>/);
  assert.doesNotMatch(trocado, /<img|Espírito Santo/, "dados de outra UF nunca entram no PDF");
});

test("PDF lista os sites oficiais de consulta da ANA, Clima Saúde, INMET e COR", () => {
  const html = renderPdfHtml(relatorio(CIDADES.rio_de_janeiro, {
    status: "indisponivel", uf: "RJ", competencia: AGOSTO,
    urls: { pagina: ms.urlPaginaUf(AGOSTO, "RJ") },
  }));
  assert.match(html, /https:\/\/monitordesecas\.ana\.gov\.br\//);
  assert.match(html, /https:\/\/monitordesecas\.ana\.gov\.br\/tabela-de-classificacao/);
  assert.match(html, /https:\/\/clima\.saude\.gov\.br\//);
  assert.match(html, /https:\/\/cor\.rio\//);
  assert.match(html, /https:\/\/previsao\.inmet\.gov\.br\/3304557/);
});
