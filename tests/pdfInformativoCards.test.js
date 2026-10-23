const test = require("node:test");
const assert = require("node:assert/strict");
const cheerio = require("cheerio");
const { renderPdfHtml } = require("../src/render/pdfTemplate");

function report(extra = {}) {
  return {
    cidade: { nome: "Rio de Janeiro", uf: "RJ", fuso: "America/Sao_Paulo" },
    dataFormatadaLonga: "sexta-feira, 9 de outubro de 2026", dataFormatadaCurta: "09/10/2026",
    horaConsulta: "15:00", previsaoAte: "00h", horarioAgendado: "15:00", probabilidadeChuvaPrevista: 30,
    tabelaTemperaturaUmidade: [{ fonte: "INMET — previsão oficial", tempMin: 23.2, tempMax: 38, umidadeMin: null, umidadeMax: null }],
    ventoPorPeriodo: [{ periodo: "Noite", janela: "18h–00h", direcao: "E", intensidade: "Fracos", rajadaMaxKmh: null, referenciaInmet: "Previsão municipal INMET · intensidade oficial: Fracos" }],
    chuvaPorHora: [{ intervalo: "15:00–16:00", probabilidade: 30, precipitacaoMm: 1.2 }],
    chuvaPorPeriodo: [
      { periodo: "Manhã", janela: "05h–12h", probabilidade: 20, precipitacaoMm: 0.4, resumoInmet: "Nublado" },
      { periodo: "Tarde", janela: "12h–18h", probabilidade: 30, precipitacaoMm: 1.2, resumoInmet: "Chuva" },
      { periodo: "Noite", janela: "18h–00h", probabilidade: 10, precipitacaoMm: 0, resumoInmet: "Nublado" },
    ], mar: { periodos: [{ periodo: "Noite", estadoMar: "Leve", alturaMaxM: 0.7, periodoOndaS: 7, direcaoOnda: "SE", marulhoMaxM: 0.4 }], referenciaPonto: "costa" }, qualidadeAr: null,
    climaSaude: { status: "operacional", dados: { source: "Clima e Saúde — Ministério da Saúde", consultadoEm: "2026-10-09T12:00:00.000Z", ehf: { valor: 4.57, classificacao: "Sem excesso" }, riscoCombinado: "Sem risco" } },
    severidade: { grau: "NORMAL", eventos: [] }, avisosInmet: [], avisosInmetStatus: "operacional",
    divergencias: [], avisosColeta: [], fontesAutomatizadas: [], fontesManuais: [], fontesPorCampo: {},
    ...extra,
  };
}

test("cabeçalho usa a edição e a previsão na mesma linha", () => {
  for (const horarioAgendado of ["08:00", "09:00", "12:00", "15:00", "17:00", "20:00"]) {
    const horaExibida = horarioAgendado.replace(":00", "h");
    const $ = cheerio.load(renderPdfHtml(report({ horarioAgendado, horaConsulta: horarioAgendado })));
    const referencia = $(".referencia-edicao").text().replace(/\s+/g, " ");
    assert.match(referencia, new RegExp(`Hora da consulta: ${horaExibida} \\(Horário de Brasília\\) \\| Previsão até 00h`));
    assert.doesNotMatch(referencia, /(?:05|09|12|15|17|20):00/);
  }
});

test("PDF exibe rajada OCEANOP no resumo e na referência da previsão", () => {
  const $ = cheerio.load(renderPdfHtml(report({
    previsaoDias: [{ periodo: "Hoje (15h–00h)", condicao: "Nublado", tempMin: 20, tempMax: 28, umidadeMin: 60, umidadeMax: 90, chuvaMm: 0, rajadaKmh: 43.2 }],
    ventoPorPeriodo: [{
      periodo: "Tarde", janela: "12h–18h", direcao: "E", velocidadeMediaKmh: 10,
      rajadaMaxKmh: 43.2, referenciaInmet: "Petrobras — OCEANOP · Área A · 09/10/2026 15:00:00 a 09/10/2026 15:59:59",
    }],
    fontesPorCampo: { rajadaMaxKmh: "Petrobras — OCEANOP", "periodos.tarde.rajadaMaxKmh": "Petrobras — OCEANOP" },
  })));
  assert.match($.text(), /43 km\/h/);
  assert.match($.text(), /Petrobras — OCEANOP/);
  assert.match($.text(), /Área A/);
});

test("PDF exibe o pico diário Tetra Tech sem atribuí-lo a um período", () => {
  const $ = cheerio.load(renderPdfHtml(report({
    rajadaMaxKmh: 51.856,
    previsaoDias: [{ periodo: "Hoje", rajadaKmh: 51.856 }],
    fontesPorCampo: { rajadaMaxKmh: "Tetra Tech/OCEANOP" },
  })));
  assert.match($.text(), /52 km\/h/);
  assert.match($.text(), /Tetra Tech\/OCEANOP/);
  assert.doesNotMatch($(".tabela-vento-periodo").text(), /52 km\/h/);
});

test("condições de mar aparecem imediatamente após qualidade do ar e índice UV", () => {
  const html = renderPdfHtml(report({ qualidadeAr: { pm25Classificacao: {}, uvClassificacao: {} } }));
  const $ = cheerio.load(html);
  const titulos = $("h4.subsecao").map((_, h4) => $(h4).text()).get();
  const qualidade = titulos.indexOf("Qualidade do Ar e Índice UV");
  assert.ok(qualidade >= 0);
  assert.match(titulos[qualidade + 1], /^Condições de mar/);
});

test("condições de mar OCEANOP distinguem altura, máxima, período e pico sem alterar a tabela", () => {
  const $ = cheerio.load(renderPdfHtml(report({
    mar: {
      fonte: "Petrobras — OCEANOP",
      referenciaPonto: "PONTO-A",
      periodos: [{
        periodo: "Manhã", estadoMar: "Moderado", alturaOndaM: 1.1, alturaMaxM: 2.1,
        periodoOndaS: 9.7, periodoPicoOndaS: 11.2, direcaoOnda: "SE", marulhoMaxM: 0.8,
      }],
    },
    fontesPorCampo: { "mar.alturaMaxDiaM": "Petrobras — OCEANOP" },
  })));
  const bloco = $("h4.subsecao").filter((_, item) => $(item).text().startsWith("Condições de mar")).closest("section");
  assert.match(bloco.text(), /Petrobras — OCEANOP/);
  assert.match(bloco.text(), /1\.1 m \(máx\. 2\.1 m\)/);
  assert.match(bloco.text(), /9\.7 s \(pico 11\.2 s\)/);
  assert.equal(bloco.find("th").length, 6, "a integração não cria colunas nem altera o layout aprovado");
});

test("qualidade do ar mantém classificação e referências técnicas", () => {
  const $ = cheerio.load(renderPdfHtml(report({
    qualidadeAr: {
      aqiPm25: 42,
      pm25Classificacao: { nivel: "Moderada" },
      pm25Medio: 12,
      pm10Medio: 17,
      uvMax: 9,
      uvClassificacao: { nivel: "Muito alto" },
    },
  })));
  const primeiraLinha = $("h4.subsecao").filter((_, item) => $(item).text() === "Qualidade do Ar e Índice UV")
    .closest("section").find("tbody tr").first();
  assert.deepEqual(primeiraLinha.find("td").map((_, td) => $(td).text().trim()).get(), [
    "Qualidade do Ar",
    "42",
    "Moderada",
    "Classificação informada pela Open-Meteo/CAMS",
  ]);
  const bloco = $("h4.subsecao").filter((_, item) => $(item).text() === "Qualidade do Ar e Índice UV").closest("section").text();
  assert.match(bloco, /PM2,5|PM10|µg\/m³|Diretriz OMS/i);
});

test("qualidade do ar sem AQI oficial não atribui classificação CAMS", () => {
  const $ = cheerio.load(renderPdfHtml(report({
    qualidadeAr: { pm25Medio: 12, pm25Classificacao: { nivel: "Moderada" } },
  })));
  const primeiraLinha = $("h4.subsecao").filter((_, item) => $(item).text() === "Qualidade do Ar e Índice UV")
    .closest("section").find("tbody tr").first();
  assert.deepEqual(primeiraLinha.find("td").map((_, td) => $(td).text().trim()).get(), [
    "Qualidade do Ar", "—", "—", "Classificação indisponível",
  ]);
});

test("temperatura e umidade usam quatro colunas previstas e deixam a fonte na nota", () => {
  for (const horarioAgendado of ["08:00", "15:00"]) {
    const $ = cheerio.load(renderPdfHtml(report({
      horarioAgendado,
      tabelaTemperaturaUmidade: [{ fonte: "INMET — previsão oficial", natureza: "Previsão diária oficial", tempMin: 23.2, tempMax: 38, umidadeMin: 84, umidadeMax: 97 }],
    })));
    const tabela = $("table.tabela-temp-umidade");
    assert.equal(tabela.length, 1);
    assert.deepEqual(tabela.find("th").map((_, th) => $(th).text()).get(), ["Temp. Mínima", "Temp. Máxima", "Umidade Mínima", "Umidade Máxima"]);
    assert.deepEqual(tabela.find("tbody td").map((_, td) => $(td).text()).get(), ["23,2°C", "38°C", "84%", "97%"]);
    assert.doesNotMatch(tabela.text(), /Clima e Saúde|Open-Meteo/);
    const bloco = tabela.closest("section");
    assert.equal(bloco.find(".subtitulo-tabela").text(), "Indicadores consolidados do período consultado.");
    assert.equal(bloco.find(".fonte-tabela").text(), "Fonte de dados: INMET — previsão oficial.");
  }
});

test("PDFs de 08h e 15h preservam as três tabelas no modelo aprovado", () => {
  const ventoPorPeriodo = [
    { periodo: "Manhã", janela: "05h–12h", direcao: "NW-N", velocidadeMediaKmh: null, rajadaMaxKmh: null, referenciaInmet: "Previsão municipal INMET - intensidade oficial: Fraco/Moderado" },
    { periodo: "Tarde", janela: "12h–18h", direcao: "S-SW", velocidadeMediaKmh: null, rajadaMaxKmh: null, referenciaInmet: "Previsão municipal INMET - intensidade oficial: Fraco/Moderado com Rajadas" },
    { periodo: "Noite", janela: "18h–00h", direcao: "SW-S", velocidadeMediaKmh: null, rajadaMaxKmh: null, referenciaInmet: "Previsão municipal INMET - intensidade oficial: Fraco/Moderado com Rajadas" },
  ];

  for (const horarioAgendado of ["08:00", "15:00"]) {
    const $ = cheerio.load(renderPdfHtml(report({ horarioAgendado, ventoPorPeriodo })));
    const temperatura = $("table.tabela-temp-umidade");
    const vento = $("table.tabela-vento-periodo");
    const chuva = $("table.tabela-chuva-periodo");

    assert.equal(temperatura.find("thead th").length, 4);
    assert.equal(temperatura.find("tbody tr").length, 1);
    assert.equal(vento.find("thead th").length, 5);
    assert.equal(vento.find("tbody tr").length, 3);
    assert.equal(chuva.find("thead th").length, 4);
    assert.equal(chuva.find("tbody tr").length, 3);
    assert.deepEqual(vento.find("tbody tr td:first-child").map((_, td) => $(td).text().replace(/\s+/g, " ").trim()).get(), [
      "Manhã05h–12h", "Tarde12h–18h", "Noite18h–00h",
    ]);
    assert.equal(vento.find("thead th").eq(3).text(), "Rajada prevista (máx.)");
    assert.doesNotMatch(vento.text(), /Rajada observada/i);
    assert.deepEqual(vento.find("col").map((_, col) => $(col).attr("style")).get(), [
      "width:14%", "width:12%", "width:19%", "width:19%", "width:36%",
    ]);
    assert.deepEqual(chuva.find("col").map((_, col) => $(col).attr("style")).get(), [
      "width:16%", "width:18%", "width:25%", "width:41%",
    ]);
    assert.equal(vento.closest("section").find(".fonte-tabela").text(), "Fonte de dados: INMET. A intensidade qualitativa oficial não é convertida em velocidade numérica; campos não publicados aparecem como Não disponível.");
  }
});

test("previsão usa exatamente a condição geral consolidada", () => {
  const condicaoGeral = "Muitas nuvens com pancadas de chuva e trovoadas";
  const $ = cheerio.load(renderPdfHtml(report({
    condicaoGeral,
    fontesPorCampo: {
      condicaoGeral: "INMET — previsão oficial",
      tempMin: "INMET — previsão oficial",
      tempMax: "INMET — previsão oficial",
      umidadeMin: "INMET — previsão oficial",
      umidadeMax: "INMET — previsão oficial",
      precipitacaoTotalMm: "Open-Meteo — previsão complementar",
      rajadaMaxKmh: "Open-Meteo — previsão complementar",
    },
    previsaoDias: [{
      periodo: "Hoje",
      data: "2026-10-09",
      condicao: "Manhã: Nublado; Tarde: Chuva; Noite: Trovoadas",
      tempMin: 23,
      tempMax: 30,
      umidadeMin: 60,
      umidadeMax: 90,
      chuvaMm: 3.2,
      rajadaKmh: 28,
    }],
  })));
  const condicao = $("table.previsao-hoje tbody td.previsao-condicao");
  assert.equal(condicao.text(), condicaoGeral);
  assert.doesNotMatch(condicao.text(), /Manhã:|Tarde:|Noite:/);
  const fonte = $("table.previsao-hoje").closest("section").find(".fonte-tabela").text();
  assert.match(fonte, /condição — INMET — previsão oficial/);
  assert.match(fonte, /chuva — Open-Meteo — previsão complementar/);
  assert.match(fonte, /rajada — Open-Meteo — previsão complementar/);
});

test("previsão diária mostra probabilidade de chuva abaixo do acumulado sem alterar D+3", () => {
  const $ = cheerio.load(renderPdfHtml(report({
    previsaoDias: [{
      periodo: "Hoje (15h–00h)", data: "2026-10-09", tempMin: 23, tempMax: 30,
      umidadeMin: 60, umidadeMax: 90, chuvaMm: 1.2, rajadaKmh: 28,
    }],
  })));
  const chuvaHoje = $("table.previsao-hoje td.previsao-chuva");
  assert.match(chuvaHoje.text().replace(/\s+/g, " "), /1,2 mm Probabilidade de chuva: 30%/);
  assert.equal($("table.p3d th").filter((_, th) => /Probabilidade de chuva/i.test($(th).text())).length, 0);
});

test("vento e chuva por período exibem os números complementares e suas fontes", () => {
  const $ = cheerio.load(renderPdfHtml(report({
    ventoPorPeriodo: [
      { periodo: "Manhã", janela: "05h–12h", direcao: "NW-N", velocidadeMediaKmh: 12, rajadaMaxKmh: 21, referenciaInmet: "Previsão municipal INMET - intensidade oficial: Fraco/Moderado" },
      { periodo: "Tarde", janela: "12h–18h", direcao: "S-SW", velocidadeMediaKmh: 17, rajadaMaxKmh: 29, referenciaInmet: "Previsão municipal INMET - intensidade oficial: Fraco/Moderado com Rajadas" },
      { periodo: "Noite", janela: "18h–00h", direcao: "SW-S", velocidadeMediaKmh: 9, rajadaMaxKmh: 15, referenciaInmet: "Previsão municipal INMET - intensidade oficial: Fraco/Moderado" },
    ],
    fontesPorCampo: {
      "periodos.manha.direcao": "INMET — previsão oficial",
      "periodos.manha.velocidadeMediaKmh": "Open-Meteo — previsão complementar",
      "periodos.manha.rajadaMaxKmh": "Open-Meteo — previsão complementar",
      "periodos.manha.precipitacaoMm": "Open-Meteo — previsão complementar",
      "periodos.manha.probabilidadeChuva": "Open-Meteo — previsão complementar",
    },
  })));

  const vento = $("table.tabela-vento-periodo");
  assert.match(vento.text(), /12,0 km\/h/);
  assert.match(vento.text(), /29 km\/h/);
  assert.match(vento.closest("section").find(".fonte-tabela").text(), /INMET — previsão oficial \/ Open-Meteo — previsão complementar/);

  const chuva = $("table.tabela-chuva-periodo");
  assert.equal(chuva.find("thead th").eq(1).text(), "Probabilidade máxima");
  assert.match(chuva.text(), /30%/);
  assert.match(chuva.text(), /1,2 mm/);
  assert.match(chuva.closest("section").find(".fonte-tabela").text(), /Open-Meteo — previsão complementar/);
});

test("tabela de excesso de calor exibe apenas indicadores do Clima e Saúde", () => {
  const html = renderPdfHtml(report());
  const $ = cheerio.load(html);
  const tabela = $("table.tabela-calor");
  assert.deepEqual(tabela.find("th").map((_, th) => $(th).text()).get(), [
    "Período", "EHF", "Classificação", "Risco combinado",
  ]);
  assert.deepEqual(tabela.find("tbody td").map((_, td) => $(td).text()).get(), [
    "Dia", "4.57", "Sem excesso", "Sem risco",
  ]);
  assert.doesNotMatch(tabela.text(), /umidade relativa/i);
  assert.doesNotMatch(html, /não publicou umidade relativa/i);
  assert.match(html, /Fonte de dados: Clima e Saúde/);
});

test("chuva observada é removida somente da apresentação do PDF", () => {
  const html = renderPdfHtml(report());
  assert.doesNotMatch(html, /Chuva acumulada\/Hora/i);
  assert.doesNotMatch(html, /Chuva acumulada\/dia/i);
  assert.doesNotMatch(html, /15:00–16:00/);
  assert.match(html, /Chuva por período/);
});
