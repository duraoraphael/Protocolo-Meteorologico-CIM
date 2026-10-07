const test = require("node:test");
const assert = require("node:assert/strict");
const cheerio = require("cheerio");

const { classificarCondicoesMeteorologicas } = require("../src/logic/inmetAlertRules");
const { nivelEhf, recomendacoesCalor } = require("../src/sources/climaSaudeService");
const { renderAlertEmailHtml } = require("../src/render/alertEmailTemplate");
const { renderStatusChangeCard } = require("../src/render/emailComponents");

function renderizar(alerta) {
  return renderAlertEmailHtml({
    cidade: { nome: "Macaé", uf: "RJ" },
    report: {
      dataFormatadaCurta: "05/10/2026",
      horaConsulta: "15:00",
      tempMin: 22,
      tempMax: 31,
      ventoPorPeriodo: [],
      condicaoGeral: "Parcialmente nublado",
    },
    alertas: [alerta],
  });
}

function conferirHtml({ nome, alerta, titulo, cor }) {
  const html = renderizar(alerta);
  const $ = cheerio.load(html);
  const tituloRenderizado = $('[data-alert-title="true"]').first();
  const recomendacoesRenderizadas = $('[data-alert-recommendation="true"]')
    .map((_, item) => $(item).text().trim())
    .get();
  const cadastradas = alerta.recomendacoes || [];

  assert.equal(tituloRenderizado.text().trim(), titulo, `${nome}: título`);
  assert.match(tituloRenderizado.attr("style"), new RegExp(cor, "i"), `${nome}: cor`);
  assert.equal(recomendacoesRenderizadas.length, cadastradas.length, `${nome}: quantidade`);
  assert.deepEqual(recomendacoesRenderizadas, cadastradas, `${nome}: conteúdo e ordem`);
  assert.equal(new Set(recomendacoesRenderizadas).size, recomendacoesRenderizadas.length, `${nome}: sem duplicação`);
}

test("gera os alertas operacionais com título, cor e 100% das recomendações cadastradas", () => {
  const vento = classificarCondicoesMeteorologicas({
    rajadaKmh: 40,
    chuvaHorariaMmH: 0,
    chuvaDiariaMm: 0,
  }).eventos.find((evento) => evento.assinatura === "vento");
  const chuva = classificarCondicoesMeteorologicas({
    rajadaKmh: 0,
    chuvaHorariaMmH: 30,
    chuvaDiariaMm: 50,
  }).eventos.find((evento) => evento.assinatura === "chuva");
  const calorAtencao = nivelEhf("Baixo");

  const casos = [
    {
      nome: "vento em alerta",
      titulo: "VENTO — ALERTA",
      cor: "#EF6C00",
      alerta: vento,
    },
    {
      nome: "calor em atenção",
      titulo: "CALOR / RISCO À SAÚDE — ATENÇÃO",
      cor: "#9A7600",
      alerta: {
        tipo: "Calor / risco à saúde",
        assinatura: "calor-ehf",
        grau: calorAtencao.grau,
        protocolo: calorAtencao.protocolo,
        detalhe: "EHF Baixo.",
        recomendacoes: recomendacoesCalor(calorAtencao),
      },
    },
    {
      nome: "chuva intensa em alerta",
      titulo: "CHUVA INTENSA — ALERTA",
      cor: "#EF6C00",
      alerta: chuva,
    },
  ];

  for (const caso of casos) conferirHtml(caso);
});

test("calor NORMAL não gera card no Alerta CIM", () => {
  const calorNormal = nivelEhf("Sem excesso");
  const html = renderizar({
    tipo: "Calor / risco à saúde",
    assinatura: "calor-ehf",
    grauAnterior: "ATENÇÃO",
    grau: calorNormal.grau,
    motivo: "normalizou",
    detalhe: "EHF Sem excesso.",
    recomendacoes: recomendacoesCalor(calorNormal),
  });
  assert.equal(html, "");
});

test("padroniza os demais nomes de parâmetro e exibe emergencial sem alterar o grau interno", () => {
  const casos = [
    ["Índice UV extremo", "ÍNDICE UV — ALERTA"],
    ["Qualidade do ar", "QUALIDADE DO AR — NORMAL"],
    ["Calor extremo", "CALOR / RISCO À SAÚDE — EMERGÊNCIA"],
  ];

  for (const [tipo, titulo] of casos) {
    const grau = titulo.endsWith("EMERGÊNCIA") ? "EMERGÊNCIA" : titulo.endsWith("NORMAL") ? "NORMAL" : "ALERTA";
    const $ = cheerio.load(renderStatusChangeCard({ tipo, grau }));
    assert.equal($('[data-alert-title="true"]').text().trim(), titulo);
  }
});
