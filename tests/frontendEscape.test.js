// V-01: o painel não pode inserir nome/e-mail/mensagens do servidor como HTML.
const test = require("node:test");
const assert = require("node:assert/strict");
const { carregarPainel } = require("./helpers/fakeDom");

const NOME_XSS = "<img src=x onerror=alert(document.domain)>";
const EMAIL_XSS = '"><svg/onload=alert(1)>@x.co';

const semHtmlAtivo = (html) => {
  assert.ok(!/<(img|svg)/i.test(html), `HTML ativo encontrado: ${html}`);
  assert.ok(!html.includes(NOME_XSS) && !html.includes(EMAIL_XSS), `payload cru encontrado: ${html}`);
};

test("Dashboard.escape neutraliza os 5 caracteres especiais", () => {
  const painel = carregarPainel();
  const esc = painel.executar("Dashboard.escape");
  assert.equal(esc(`<a href="x" title='y'>&</a>`), "&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;");
});
test("chips de destinatários escapam nome e e-mail", () => {
  const painel = carregarPainel();
  painel.contexto.renderListaDestinatariosPainel([{ nome: NOME_XSS, email: EMAIL_XSS }]);
  const html = painel.elemento("lista-destinatarios-painel").innerHTML;
  semHtmlAtivo(html);
  assert.match(html, /&lt;img src=x onerror=alert\(document\.domain\)&gt;/);
});

test("mensagem de erro do servidor é escapada", async () => {
  const painel = carregarPainel({
    responder: (url) => (url.startsWith("/api/responsaveis") ? { ok: false, erro: NOME_XSS } : {}),
  });
  painel.executar('cidadeAtivaChave = "rio_de_janeiro";');
  await painel.contexto.carregarDestinatariosPainel();
  const html = painel.elemento("lista-destinatarios-painel").innerHTML;
  semHtmlAtivo(html);
  assert.match(html, /Erro ao carregar: &lt;img/);
});

test("Monitoramento e fontes exibe o estado de todas as APIs", () => {
  const painel = carregarPainel();
  const details = painel.executar("Dashboard.details");
  const html = details({
    cidade: { chave: "rio_de_janeiro" },
    horaConsulta: "16:30",
    monitoramentoApis: [
      { id: "open-meteo", nome: "Open-Meteo — Meteorologia", status: "operacional", detalhe: "Dados recebidos" },
      { id: "open-meteo-air", nome: "Open-Meteo Air Quality", status: "indisponivel", detalhe: "HTTP 429" },
      { id: "open-meteo-marine", nome: "Open-Meteo Marine", status: "degradado", detalhe: "Consulta atual indisponível. Utilizando última coleta válida de 01/10/2026 06:00." },
      { id: "oceanop", nome: "Oceanop / Petrobras", status: "nao_configurada", detalhe: "Local não vinculado" },
    ],
    avisosInmet: [], avisosColeta: [], divergencias: [], fontesPorCampo: {}, fontesAutomatizadas: [],
  }, "monitoramento");
  assert.match(html, /Status de todas as APIs/);
  assert.match(html, /Open-Meteo — Meteorologia/);
  assert.match(html, /Operacional/);
  assert.match(html, /Open-Meteo Air Quality/);
  assert.match(html, /Indisponível/);
  assert.match(html, /Open-Meteo Marine/);
  assert.match(html, /Degradado/);
  assert.match(html, /01\/10\/2026 06:00/);
  assert.match(html, /Oceanop \/ Petrobras/);
  assert.match(html, /Não configurada/);
});

test("painel distingue chuva diária da última hora oficial", () => {
  const painel = carregarPainel();
  const home = painel.executar("Dashboard.home");
  const html = home({
    cidade: { chave: "rio_de_janeiro", nome: "Rio de Janeiro", uf: "RJ" },
    precipitacaoDiariaMm: 8.4,
    precipitacaoHoraMm: 1.2,
    precipitacaoHoraReferencia: "14:00–15:00",
    coberturaObservacoesInmet: { amostras: 15, horasEsperadas: 16, parcial: true },
    chuvaPorHora: [{ intervalo: "14:00–15:00", precipitacaoMm: 1.2 }],
    ventoPorPeriodo: [],
    fontesPorCampo: {
      precipitacaoDiariaMm: "INMET — estação automática — observado",
      precipitacaoHoraMm: "INMET — estação automática — observado",
    },
    monitoramentoApis: [], severidade: { eventos: [] }, avisosInmet: [],
  });
  assert.match(html, /Chuva acumulada\/dia/);
  assert.match(html, /Chuva acumulada\/Hora/);
  assert.match(html, /Hora de referência: 14:00–15:00/);
  assert.match(html, />8\.4 <small>mm<\/small>/);
  assert.match(html, />1\.2 <small>mm<\/small>/);
});

test("painel aplica INMET a chuva/vento/rajada e Open-Meteo a UV/mar", () => {
  const painel = carregarPainel();
  const home = painel.executar("Dashboard.home");
  const html = home({
    cidade: { chave: "rio_de_janeiro", nome: "Rio de Janeiro", uf: "RJ" },
    ventoPorPeriodo: [{ periodo: "Tarde", direcao: "S-SW", intensidade: "Fraco/Moderado com Rajadas", rajadaMaxKmh: null }],
    precipitacaoDiariaMm: null,
    precipitacaoHoraMm: null,
    precipitacaoUltimas24hMm: null,
    indiceUv: { maximoPrevisto: 8.4, classificacao: "Muito alto", fonte: "Open-Meteo Air Quality / CAMS" },
    qualidadeAr: { uvMax: 8.4, horaPicoUv: "12:00", uvClassificacao: { nivel: "Muito alto" } },
    mar: { alturaMaxDiaM: 0.5, estadoMarDia: "Leve", periodos: [] },
    fontesPorCampo: {
      "periodos.tarde.rajadaMaxKmh": "Indisponível",
      precipitacaoDiariaMm: "Indisponível",
      precipitacaoHoraMm: "Indisponível",
      precipitacaoUltimas24hMm: "Indisponível",
      "ar.uvMax": "Open-Meteo Air Quality / CAMS",
      "mar.alturaMaxDiaM": "Open-Meteo Marine",
    },
    monitoramentoApis: [{ id: "open-meteo-marine", status: "operacional" }],
    severidade: { eventos: [] }, avisosInmet: [],
  });

  assert.match(html, /Rajada prevista[\s\S]*Dado indisponível[\s\S]*INMET prioritário · Open-Meteo complementar/);
  assert.match(html, /Chuva acumulada\/dia[\s\S]*INMET — estação automática/);
  assert.match(html, /Índice UV[\s\S]*8\.4[\s\S]*Open-Meteo Air Quality \/ CAMS/);
  assert.match(html, /Mar — altura máx\. de onda[\s\S]*0\.5 <small>m<\/small>[\s\S]*Open-Meteo Marine/);
  assert.doesNotMatch(html, /O portal Clima e Saúde não publica índice UV/);
});

test("painel usa rajada OCEANOP consolidada e identifica horário/fonte", () => {
  const painel = carregarPainel();
  const home = painel.executar("Dashboard.home");
  const html = home({
    cidade: { chave: "macae", nome: "Macaé", uf: "RJ" },
    rajadaMaxKmh: 43.2,
    rajadaPrevistaReferencia: { periodoReferencia: "20/10/2026 12:00:00 a 20/10/2026 12:59:59" },
    ventoPorPeriodo: [
      { periodo: "Tarde", rajadaMaxKmh: 43.2 },
      { periodo: "Noite", rajadaMaxKmh: 80 },
    ],
    fontesPorCampo: { rajadaMaxKmh: "Petrobras — OCEANOP" },
    monitoramentoApis: [], severidade: { eventos: [] }, avisosInmet: [],
  });
  assert.match(html, /Rajada prevista[\s\S]*43\.20 <small>km\/h<\/small>/);
  assert.match(html, /Petrobras — OCEANOP/);
  assert.match(html, /20\/10\/2026 12:00:00/);
});

test("painel usa o pico diário Tetra Tech e mantém a fonte", () => {
  const painel = carregarPainel();
  const html = painel.executar("Dashboard.home")({
    cidade: { chave: "santos", nome: "Santos", uf: "SP" },
    rajadaMaxKmh: 51.856,
    rajadaPrevistaReferencia: { periodoReferencia: "pico diário de 2026-10-20" },
    ventoPorPeriodo: [],
    fontesPorCampo: { rajadaMaxKmh: "Tetra Tech/OCEANOP" },
    monitoramentoApis: [], severidade: { eventos: [] }, avisosInmet: [],
  });
  assert.match(html, /Rajada prevista[\s\S]*51\.86 <small>km\/h<\/small>/);
  assert.match(html, /Tetra Tech\/OCEANOP/);
  assert.match(html, /pico diário de 2026-10-20/);
});
