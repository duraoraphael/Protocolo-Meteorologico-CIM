// Painel: ocorrências em destaque, conteúdo real dos avisos INMET,
// remoção de repetições e card compacto de Calor e Saúde.
const test = require("node:test");
const assert = require("node:assert/strict");

const { montarOcorrencias } = require("../src/logic/ocorrenciasPainel");
const {
  buscarAvisosInmet, deduplicarAvisosInmet, avisoAplicavel, dataAvisoEmMs, normalizarAviso,
} = require("../src/sources/inmet");
const { carregarPainel } = require("./helpers/fakeDom");

const RIO = "3304557";
const agoraIso = () => new Date().toISOString();
const ontemIso = () => new Date(Date.now() - 36 * 3600 * 1000).toISOString();

// Aviso no formato real de /avisos/ativos (campos conferidos em 01/10/2026).
function avisoBruto(sobrescrever = {}) {
  return {
    id_aviso: 28388, id_sequencia: 1, codigo: "urn:oid:2.49.0.0.76.0.2026.28388.1",
    descricao: "Tempestade", severidade: "Perigo Potencial",
    inicio: "2099-10-01 09:29", fim: "2099-10-01 23:59",
    estados: "Rio de Janeiro,São Paulo",
    municipios: "Rio de Janeiro - RJ (3304557),Santos - SP (3548500)",
    geocodes: `${RIO},3548500`,
    riscos: ["Chuva entre 20 e 30 mm/h ou até 50 mm/dia, ventos intensos (40-60 km/h), e queda de granizo."],
    instrucoes: ["Em caso de rajadas de vento: não se abrigue debaixo de árvores.", "Evite usar aparelhos eletrônicos ligados à tomada."],
    encerrado: false,
    ...sobrescrever,
  };
}

function report(sobrescrever = {}) {
  return {
    cidade: { chave: "rio_de_janeiro", nome: "Rio de Janeiro", uf: "RJ" },
    horaConsulta: "17:00",
    severidade: { grau: "NORMAL", eventos: [] },
    avisosInmet: [],
    avisosInmetStatus: "operacional",
    linkInmet: "https://previsao.inmet.gov.br/3304557",
    climaSaude: null,
    ventoPorPeriodo: [], chuvaPorPeriodo: [], mar: null, qualidadeAr: null,
    avisosColeta: [], divergencias: [], fontesPorCampo: {}, fontesAutomatizadas: [], monitoramentoApis: [],
    ...sobrescrever,
  };
}

const painel = () => carregarPainel();
const renderizar = (r) => {
  r.ocorrencias = montarOcorrencias(r);
  const p = painel();
  return { tela: p.executar("Dashboard.home")(r), detalhe: (id) => p.executar("Dashboard.details")(r, `ocorrencia:${id}`) };
};

test("aviso INMET mostra o conteúdo oficial no card e completo em Ver detalhes", () => {
  const r = report({ avisosInmet: [normalizarAviso(avisoBruto())] });
  const { tela, detalhe } = renderizar(r);
  const [oc] = r.ocorrencias;

  assert.equal(oc.grau, "ATENÇÃO", "Perigo Potencial segue grauAvisoInmet");
  assert.equal(oc.classificacaoOficial, "Perigo Potencial");
  assert.match(tela, /class="ocorrencia nivel-atencao"/);
  assert.match(tela, /Chuva entre 20 e 30 mm\/h ou até 50 mm\/dia/);
  assert.match(tela, /INMET: Perigo Potencial/);
  assert.match(tela, /Ver detalhes/);
  assert.doesNotMatch(tela + detalhe(oc.id), /consulte o (site|texto|aviso)/i);

  const html = detalhe(oc.id);
  assert.match(html, /Classificação oficial<\/dt><dd>Perigo Potencial/);
  assert.match(html, /Riscos descritos/);
  assert.match(html, /Orientações oficiais/);
  assert.match(html, /Evite usar aparelhos eletrônicos ligados à tomada\./);
  assert.match(html, /01\/10\/2099 09:29 até 01\/10\/2099 23:59/);
  assert.match(html, /Rio de Janeiro, São Paulo · 2 municípios, incluindo Rio de Janeiro/);
  assert.match(html, /Aviso nº 28388/);
  assert.match(html, /href="https:\/\/previsao\.inmet\.gov\.br\/3304557"[^>]*>previsão oficial INMET/);
});

test("aviso sem riscos nem orientações informa a indisponibilidade, sem inventar", () => {
  const r = report({ avisosInmet: [normalizarAviso(avisoBruto({ riscos: [], instrucoes: [] }))] });
  const { tela, detalhe } = renderizar(r);
  assert.match(tela, /Detalhes do aviso indisponíveis na fonte/);
  assert.match(detalhe(r.ocorrencias[0].id), /A fonte oficial não forneceu riscos nem orientações/);
});

test("mesmo aviso repetido vira um só; cópia sem identificador é comparada por conteúdo", () => {
  const original = normalizarAviso(avisoBruto());
  const novaVersao = normalizarAviso(avisoBruto({ id_sequencia: 2, codigo: "urn:oid:2.49.0.0.76.0.2026.28388.2", instrucoes: ["Nova orientação."] }));
  const { id, idAviso, ...semId } = original;
  const unicos = deduplicarAvisosInmet([original, { ...original }, novaVersao, semId, { ...semId }]);
  assert.equal(unicos.length, 1);
  assert.equal(unicos[0].sequencia, 2, "prevalece a versão mais recente");
  assert.deepEqual(unicos[0].instrucoes, [...original.instrucoes, "Nova orientação."], "orientações preservadas");
  assert.equal(unicos[0].copiasNaFonte, 5);
});

test("avisos distintos do mesmo fenômeno permanecem em cards separados", () => {
  const a = normalizarAviso(avisoBruto());
  const b = normalizarAviso(avisoBruto({ id_aviso: 28383, codigo: "urn:oid:2.49.0.0.76.0.2026.28383.1", severidade: "Perigo", inicio: "2099-10-01 00:01", riscos: ["Chuva entre 30 e 60 mm/h."] }));
  const avisos = deduplicarAvisosInmet([a, b]);
  assert.equal(avisos.length, 2);
  const r = report({ avisosInmet: avisos });
  const { tela } = renderizar(r);
  assert.deepEqual(r.ocorrencias.map((o) => `${o.grau}/${o.rotulo}`), ["ALERTA/Tempestade", "ATENÇÃO/Tempestade"]);
  assert.equal((tela.match(/class="ocorrencia /g) || []).length, 2);
});

test("aviso INMET que repete evento de outra fonte vira um card com as duas fontes e a diferença explícita", () => {
  const umidade = normalizarAviso(avisoBruto({ id_aviso: 28386, descricao: "Baixa Umidade", riscos: ["Umidade relativa do ar variando entre 30% e 20%."], instrucoes: ["Beba bastante líquido."] }));
  const evento = { tipo: "baixaUmidade", grau: "ALERTA", nivel: 3, janela: "tarde", titulo: "ALERTA — BAIXA UMIDADE", descricao: "Umidade relativa mínima baixa prevista (18%).", fonteDados: "Open-Meteo", recomendacoes: [] };
  const r = report({ avisosInmet: [umidade], severidade: { grau: "ALERTA", eventos: [evento] } });
  const { tela, detalhe } = renderizar(r);

  assert.equal(r.ocorrencias.length, 1);
  const [oc] = r.ocorrencias;
  assert.deepEqual(oc.fontes, ["Open-Meteo", "INMET — aviso oficial"]);
  assert.equal(oc.grau, "ALERTA", "destaque segue o maior grau, como no protocolo");
  assert.equal(oc.classificacoesDivergentes, true);
  assert.equal(oc.resumo, "Umidade relativa do ar variando entre 30% e 20%.", "resumo fiel ao aviso oficial");
  assert.match(tela, /Fonte: Open-Meteo \+ INMET/);
  assert.match(tela, /Classificações diferentes entre fontes/);
  const html = detalhe(oc.id);
  assert.match(html, /INMET \(Perigo Potencial\): ATENÇÃO · Protocolo CIM: ALERTA|Protocolo CIM: ALERTA · INMET \(Perigo Potencial\): ATENÇÃO/);
  assert.match(html, /Umidade relativa mínima baixa prevista \(18%\)/, "descrição do protocolo preservada");
  assert.match(html, /Beba bastante líquido\./, "orientação oficial preservada");
});

test("evento criado só pelo texto do aviso não gera card repetido", () => {
  const aviso = normalizarAviso(avisoBruto({ severidade: "Perigo" }));
  const raios = { tipo: "raios", grau: "EMERGÊNCIA", nivel: 5, janela: "x", fonteDados: "INMET — aviso oficial", avisoInmet: aviso, descricao: "Atividade elétrica indicada em aviso oficial do INMET; consulte o aviso completo abaixo." };
  const generico = { tipo: "avisoInmet", grau: "ALERTA", nivel: 4, avisoInmet: aviso, descricao: "x" };
  const r = report({ avisosInmet: [aviso], severidade: { grau: "EMERGÊNCIA", eventos: [raios, generico] } });
  const { tela } = renderizar(r);
  assert.equal(r.ocorrencias.length, 1);
  assert.equal(r.ocorrencias[0].grau, "EMERGÊNCIA", "classificação existente do protocolo preservada");
  assert.doesNotMatch(tela, /consulte o aviso completo/);
});

test("cards ordenados por gravidade; sem cards vazios; mensagem discreta quando não há eventos", () => {
  const ev = (tipo, grau, extra = {}) => ({ tipo, grau, nivel: 1, titulo: `${grau} — X`, descricao: tipo, fonteDados: "Open-Meteo", janela: "tarde", ...extra });
  const r = report({ severidade: { grau: "EMERGÊNCIA", eventos: [
    ev("uvAlto", "ATENÇÃO"), ev("marModerado", "ATENÇÃO"), ev("ventoForte", "ALERTA", { assinatura: "vento", valores: { rajadaKmh: 45 } }),
    ev("chuvaIntensa", "EMERGÊNCIA", { assinatura: "chuva", valores: { intensidadeHorariaMmH: 70 } }),
  ] } });
  const { tela } = renderizar(r);
  assert.deepEqual(r.ocorrencias.map((o) => o.grau), ["EMERGÊNCIA", "ALERTA", "ATENÇÃO", "ATENÇÃO"]);
  assert.equal(r.ocorrencias.at(-1).fenomeno, "uv", "UV por último dentro do mesmo nível");
  assert.match(tela, /class="ocorrencia nivel-emergencia"/);
  assert.match(tela, /<dt>Intensidade máx\.<\/dt><dd>70 mm\/h<\/dd>/);
  assert.doesNotMatch(tela, /nenhuma ocorrência/i);

  const vazio = renderizar(report()).tela;
  assert.match(vazio, /class="sem-ocorrencias"/);
  assert.doesNotMatch(vazio, /class="ocorrencia |Emergência — nenhuma/i);
});

test("falha na coleta de avisos INMET é informada, não tratada como ausência", () => {
  const { tela } = renderizar(report({ avisosInmetStatus: "indisponivel" }));
  assert.match(tela, /Avisos oficiais INMET indisponíveis nesta atualização/);
  const det = painel().executar("Dashboard.details")(report({ avisosInmetStatus: "indisponivel" }), "monitoramento");
  assert.match(det, /coleta de avisos oficiais do INMET falhou/);
  assert.doesNotMatch(det, /Nenhum aviso vigente/);
});

function clima(grau, { consultadoEm = agoraIso(), status = "operacional", classificacao = "Sem excesso" } = {}) {
  const protocolo = { "ATENÇÃO": "P1", ALERTA: "P2", "EMERGÊNCIA": "P3" }[grau] || null;
  return { status, dados: { source: "Clima e Saúde — Ministério da Saúde", ehf: { valor: 1, classificacao }, nivel: { grau, protocolo }, temperatura: { maxima: 34 }, riscoCombinado: "Sem Risco", recomendacoes: protocolo ? ["Reforçar hidratação."] : [], consultadoEm, previsaoDias: [{ data: "2026-10-02", classificacao: "Sem excesso", tempMax: 33 }] } };
}
const cardCalor = (tela) => tela.slice(tela.indexOf('<article class="card heat'), tela.indexOf("</article>", tela.indexOf('<article class="card heat')));

test("Calor e Saúde normal: card neutro com selo Normal, sem destaque e sem lista de dias", () => {
  const r = report({ climaSaude: clima("NORMAL") });
  const { tela } = renderizar(r);
  const card = cardCalor(tela);
  assert.match(card, /selo-normal">Normal/);
  assert.match(card, /Sem excesso de calor/);
  assert.match(card, /Máxima prevista 34 °C/);
  assert.match(card, /Clima e Saúde — Ministério da Saúde/);
  assert.doesNotMatch(tela, /2026-10-02|Previsão Clima e Saúde/);
  assert.equal(r.ocorrencias.length, 0);
});

test("Calor e Saúde em ATENÇÃO entra na área de destaque", () => {
  const r = report({ climaSaude: clima("ATENÇÃO", { classificacao: "Baixo" }) });
  const { tela, detalhe } = renderizar(r);
  assert.match(cardCalor(tela), /selo-atencao">ATENÇÃO · P1/);
  assert.equal(r.ocorrencias[0].fenomeno, "calor");
  assert.match(tela, /aria-label="ATENÇÃO — Calor e saúde"/);
  assert.match(detalhe(r.ocorrencias[0].id), /Reforçar hidratação\./);
});

test("Calor e Saúde ausente ou desatualizado nunca aparece como Normal", () => {
  const indisponivel = cardCalor(renderizar(report({ climaSaude: { status: "indisponivel", mensagem: "Clima e Saúde: dados indisponíveis nesta atualização.", dados: null } })).tela);
  assert.match(indisponivel, /Indisponível/);
  assert.doesNotMatch(indisponivel, /selo-normal|Sem excesso/);

  const antigo = cardCalor(renderizar(report({ climaSaude: clima("NORMAL", { status: "armazenado", consultadoEm: ontemIso() }) })).tela);
  assert.match(antigo, /Desatualizado/);
  assert.match(antigo, /última coleta válida/);
  assert.doesNotMatch(antigo, /selo-normal/);

  const doDia = cardCalor(renderizar(report({ climaSaude: clima("NORMAL", { status: "armazenado" }) })).tela);
  assert.match(doDia, /selo-normal">Normal/, "coleta válida do próprio dia continua atual");
});

test("validade: horário sem fuso do INMET é Brasília; avisos expirados ou encerrados saem", () => {
  assert.equal(dataAvisoEmMs("2026-10-01 09:29"), Date.parse("2026-10-01T09:29:00-03:00"));
  const agora = new Date("2026-10-01T20:00:00-03:00");
  assert.equal(avisoAplicavel({ fim: "2026-10-01 23:59" }, agora), true);
  assert.equal(avisoAplicavel({ fim: "2026-10-01 18:00" }, agora), false);
  assert.equal(avisoAplicavel({ fim: "2026-10-01 23:59", encerrado: true }, agora), false);
});

test("coleta filtra por área e validade e remove repetições do mesmo aviso", async () => {
  const resultado = await buscarAvisosInmet(RIO, {
    agora: new Date("2099-10-01T12:00:00-03:00"),
    logger: null,
    fetchImpl: async () => ({ ok: true, json: async () => ({ hoje: [
      avisoBruto(), avisoBruto(),
      avisoBruto({ id_aviso: 1, descricao: "Baixa Umidade", geocodes: "5300108" }),
      avisoBruto({ id_aviso: 2, fim: "2099-10-01 08:00" }),
      avisoBruto({ id_aviso: 3, descricao: "Vendaval", severidade: "Perigo" }),
    ] }) }),
  });
  assert.deepEqual(resultado.avisos.map((a) => `${a.idAviso}:${a.descricao}`), ["28388:Tempestade", "3:Vendaval"]);
});
