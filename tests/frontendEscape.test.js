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
});

test("painel distingue chuva diária da última hora sem fonte ou horário de referência", () => {
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
  assert.match(html, />8\.4 <small>mm<\/small>/);
  assert.match(html, />1\.2 <small>mm<\/small>/);
  assert.doesNotMatch(html, /Acumulado observado no dia|Acumulado na última hora/);
  assert.doesNotMatch(html, /INMET|14:00–15:00|Hora de referência/);
});

test("calor antigo não recebe selo NORMAL e ar mostra US AQI sem metadados", () => {
  const home = carregarPainel().executar("Dashboard.home");
  const html = home({
    cidade: { chave: "rio_de_janeiro", nome: "Rio de Janeiro", uf: "RJ" },
    climaSaude: { status: "armazenado", dados: {
      source: "Clima e Saúde — Ministério da Saúde", consultadoEm: "2020-01-01T12:00:00Z",
      nivel: { grau: "NORMAL" }, ehf: { classificacao: "Sem excesso" }, temperatura: { maxima: 32 },
    } },
    qualidadeAr: { usAqi: 73, classificacao: { nivel: "MODERADO", exibicao: "MODERADO" }, referenciaEm: "2026-10-25T22:00:00Z" },
    indiceUv: { valorAtual: 0, classificacao: "BAIXO", fonte: "Open-Meteo Air Quality" },
    fontesPorCampo: { "ar.usAqi": "Open-Meteo Air Quality / CAMS" },
    monitoramentoApis: [], severidade: { eventos: [] }, avisosInmet: [], ventoPorPeriodo: [],
  });
  assert.match(html, /Calor \/ risco à saúde[\s\S]*Dado desatualizado/);
  assert.doesNotMatch(html, /CALOR \/ RISCO À SAÚDE — NORMAL/);
  assert.match(html, /Qualidade do ar[\s\S]*MODERADO/);
  assert.doesNotMatch(html, /73 US AQI|US AQI ·/);
  assert.doesNotMatch(html, /Clima e Saúde — Ministério da Saúde|Open-Meteo Air Quality|25\/10\/2026|19:00 \(Brasília\)/);
});

test("qualidade do ar mostra somente NORMAL, MODERADO ou RUIM", () => {
  const home = carregarPainel().executar("Dashboard.home");
  for (const [usAqi, classificacao] of [[30, "NORMAL"], [73, "MODERADO"], [150, "RUIM"]]) {
    const html = home({
      cidade: { chave: "rio_de_janeiro", nome: "Rio de Janeiro", uf: "RJ" },
      qualidadeAr: { usAqi, classificacao: { nivel: classificacao, exibicao: classificacao } },
      monitoramentoApis: [], severidade: { eventos: [] }, avisosInmet: [], ventoPorPeriodo: [],
    });
    const inicio = html.indexOf('<article class="card air');
    const card = html.slice(inicio, html.indexOf("</article>", inicio));
    assert.match(card, new RegExp(`>${classificacao}</span>`));
    assert.doesNotMatch(card, new RegExp(`${usAqi}|US AQI|Classificação`));
  }
});

test("painel mostra indisponibilidade de UV/rajada sem exibir fontes", () => {
  const painel = carregarPainel();
  const home = painel.executar("Dashboard.home");
  const html = home({
    cidade: { chave: "rio_de_janeiro", nome: "Rio de Janeiro", uf: "RJ" },
    ventoPorPeriodo: [{ periodo: "Tarde", direcao: "S-SW", intensidade: "Fraco/Moderado com Rajadas", rajadaMaxKmh: null }],
    precipitacaoDiariaMm: null,
    precipitacaoHoraMm: null,
    precipitacaoUltimas24hMm: null,
    indiceUv: { maximoPrevisto: null, classificacao: null, fonte: "Informação indisponível" },
    qualidadeAr: null,
    mar: { fonte: "Open-Meteo Marine", alturaMaxDiaM: 0.5, estadoMarDia: "Leve", periodos: [] },
    fontesPorCampo: {
      "periodos.tarde.rajadaMaxKmh": "Indisponível",
      precipitacaoDiariaMm: "Indisponível",
      precipitacaoHoraMm: "Indisponível",
      precipitacaoUltimas24hMm: "Indisponível",
      "ar.uvMax": "Informação indisponível",
      "mar.alturaMaxDiaM": "Open-Meteo Marine",
    },
    monitoramentoApis: [{ id: "condicoes-maritimas", status: "operacional" }],
    severidade: { eventos: [] }, avisosInmet: [],
  });

  assert.match(html, /Rajada prevista[\s\S]*Dado indisponível/);
  assert.match(html, /Chuva acumulada\/dia/);
  assert.match(html, /Índice UV/);
  assert.match(html, /Mar — altura máx\. de onda[\s\S]*0\.5 <small>m<\/small>/);
  assert.doesNotMatch(html, /Acumulado observado no dia|class="detalhe"/);
  assert.doesNotMatch(html, /INMET|Open-Meteo Marine/);
  assert.doesNotMatch(html, /O portal Clima e Saúde não publica índice UV/);
});

test("painel usa rajada consolidada sem identificar horário ou fonte", () => {
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
    fontesPorCampo: { rajadaMaxKmh: "Open-Meteo — previsão meteorológica" },
    monitoramentoApis: [], severidade: { eventos: [] }, avisosInmet: [],
  });
  assert.match(html, /Rajada prevista[\s\S]*43 km\/h/);
  assert.doesNotMatch(html, /Open-Meteo — previsão meteorológica|20\/10\/2026 12:00:00/);
});

test("condições atuais do painel omitem fonte, estação e horário", () => {
  const painel = carregarPainel();
  const html = painel.executar("Dashboard.currentWeather")({
    cidade: { nome: "Manaus", uf: "AM" },
    atual: {
      temperaturaC: 33.8, umidadePct: 56, horario: "2026-10-25T22:00:00Z",
      statusObservacao: "degradado",
      estacao: { nome: "Manaus", codigo: "A101", distanciaKm: 4.9 },
    },
  });
  assert.match(html, /33\.8/);
  assert.match(html, /56%/);
  assert.doesNotMatch(html, /INMET|A101|19:00|Brasília/);
});

test("painel usa o pico diário sem exibir fonte nem data de referência", () => {
  const painel = carregarPainel();
  const html = painel.executar("Dashboard.home")({
    cidade: { chave: "santos", nome: "Santos", uf: "SP" },
    rajadaMaxKmh: 51.856,
    rajadaPrevistaReferencia: { periodoReferencia: "pico diário de 2026-10-20" },
    ventoPorPeriodo: [],
    fontesPorCampo: { rajadaMaxKmh: "Open-Meteo — previsão meteorológica" },
    monitoramentoApis: [], severidade: { eventos: [] }, avisosInmet: [],
  });
  assert.match(html, /Rajada prevista[\s\S]*52 km\/h/);
  assert.doesNotMatch(html, /Open-Meteo — previsão meteorológica|pico diário de 2026-10-20/);
});
