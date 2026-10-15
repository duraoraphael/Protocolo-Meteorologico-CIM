// Verificação somente leitura do relatório consolidado. Não envia e-mail.
const { getCidade } = require("../src/config/cities");
const { montarRelatorio } = require("../src/logic/reportBuilder");
const { renderEmailHtml } = require("../src/render/emailTemplate");
const { renderPdfHtml } = require("../src/render/pdfTemplate");
const {
  montarPrevisaoProximosDiasInmet,
  obterPrevisaoProximosDias,
  mesclarPrevisaoProximosDias,
} = require("../src/sources/previsaoProximosDias");

(async () => {
  for (const horario of ["05:00", "15:00"]) {
    const relatorio = await montarRelatorio(getCidade("rio_de_janeiro"), {
      horarioAgendado: horario,
      atualizarClimaSaude: true,
    });
    const email = renderEmailHtml(relatorio);
    const pdf = renderPdfHtml(relatorio);
    const previsao3d = mesclarPrevisaoProximosDias(
      montarPrevisaoProximosDiasInmet(getCidade("rio_de_janeiro"), relatorio.inmetPrevisao, { agora: new Date(relatorio.geradoEmISO) }),
      await obterPrevisaoProximosDias(getCidade("rio_de_janeiro"), { agora: new Date(relatorio.geradoEmISO) })
    );
    console.log(JSON.stringify({
      horario,
      temperatura: [relatorio.tempMin, relatorio.tempMax],
      umidade: [relatorio.umidadeMin, relatorio.umidadeMax],
      rajadaPrevistaKmh: relatorio.rajadaMaxKmh,
      chuvaPrevistaMm: relatorio.precipitacaoTotalMm,
      uvMax: relatorio.qualidadeAr?.uvMax ?? null,
      calorEhf: relatorio.climaSaude?.dados?.ehf || null,
      avisosInmet: relatorio.avisosInmet.length,
      fontes: {
        temperatura: relatorio.fontesPorCampo.tempMax,
        rajada: relatorio.fontesPorCampo.rajadaMaxKmh,
        chuva: relatorio.fontesPorCampo.precipitacaoTotalMm,
        uv: relatorio.fontesPorCampo["ar.uvMax"],
      },
      renderizacao: {
        emailTemTemperatura: email.includes(String(relatorio.tempMax)),
        emailTemRajada: email.includes(String(relatorio.rajadaMaxKmh)),
        pdfTemTemperatura: pdf.includes(String(relatorio.tempMax)),
        pdfTemRajada: pdf.includes(String(relatorio.rajadaMaxKmh)),
      },
      diagnosticos: relatorio.diagnosticosFallback,
      previsao3d: {
        status: previsao3d.status,
        fontesCampo: previsao3d.fontesCampo,
        dias: previsao3d.dias,
      },
      envioEmailExecutado: false,
    }, null, 2));
  }
})().catch((erro) => {
  console.error(erro);
  process.exitCode = 1;
});
