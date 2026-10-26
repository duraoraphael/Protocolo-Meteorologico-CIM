// Confere o HTML efetivamente entregue ao navegador, o HTML usado para gerar
// o PDF e a prévia de e-mail. Não envia mensagens nem consulta APIs.
const cheerio = require("cheerio");
const { calorPorData, dataLocal } = require("../src/logic/calorPorData");

const limpar = (texto) => String(texto || "").replace(/\s+/g, " ").trim();
function celulas($, linha) { return $(linha).find("td, th").map((_, celula) => limpar($(celula).text())).get(); }
function valorCorreto(texto, esperado, unidade) {
  if (!Number.isFinite(esperado)) return /não disponível|indisponível|—/i.test(texto);
  const regex = new RegExp(`(\\d+(?:[.,]\\d+)?)\\s*${unidade.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`);
  const achado = regex.exec(texto);
  return Boolean(achado) && Math.abs(Number(achado[1].replace(",", ".")) - esperado) <= 0.11;
}

function conferirSaidasPeriodo(report, { painelHtml, pdfHtml, emailHtml }) {
  const $painel = cheerio.load(painelHtml);
  const $pdf = cheerio.load(pdfHtml);
  const $email = cheerio.load(emailHtml);
  const tabelaPainel = (titulo) => $painel("section.secao-periodos")
    .filter((_, secao) => limpar($painel(secao).find("h2").first().text()).includes(titulo))
    .find("tbody tr").toArray();
  const tabelas = {
    vento: [tabelaPainel("Vento por período"), $pdf(".tabela-vento-periodo tbody tr").toArray(),
      $email('[data-email-periodos="vento"] tr').toArray().slice(1)],
    chuva: [tabelaPainel("Chuva por período"), $pdf(".tabela-chuva-periodo tbody tr").toArray(),
      $email('[data-email-periodos="chuva"] tr').toArray().slice(1)],
  };
  const validacoes = [];
  for (const [tipo, periodos] of [["vento", report.ventoPorPeriodo || []], ["chuva", report.chuvaPorPeriodo || []]]) {
    for (const [saida, $, linhas, indice] of [["painel", $painel, tabelas[tipo][0], 0],
      ["pdf", $pdf, tabelas[tipo][1], 1], ["email", $email, tabelas[tipo][2], 2]]) {
      if (linhas.length !== periodos.length) throw new Error(`${saida}: ${tipo} tem ${linhas.length}/${periodos.length} períodos.`);
      for (let i = 0; i < periodos.length; i++) {
        const p = periodos[i];
        const c = celulas($, linhas[i]);
        const rotulo = `${p.periodo} ${p.janela || ""}`;
        if (!c[0].includes(p.periodo) || (p.janela && !c[0].includes(p.janela))) {
          throw new Error(`${saida}: janela divergente em ${tipo}/${rotulo}.`);
        }
        const valor = tipo === "vento" ? p.velocidadeMediaKmh : p.precipitacaoMm;
        const colunaValor = indice === 2 ? 1 : 2;
        const unidade = tipo === "vento" ? "km/h" : "mm";
        if (!valorCorreto(c[colunaValor], valor, unidade)) throw new Error(`${saida}: ${tipo}/${rotulo} perdeu valor ou unidade.`);
        if (tipo === "chuva") {
          const colunaProb = indice === 2 ? 2 : 1;
          if (!valorCorreto(c[colunaProb], p.probabilidade, "%")) throw new Error(`${saida}: ${tipo}/${rotulo} perdeu probabilidade.`);
          for (const fonte of [p.fontePrecipitacao, p.fonteProbabilidade].filter((f) => f && f !== "Indisponível")) {
            if (!c.at(-1).includes(fonte)) throw new Error(`${saida}: ${tipo}/${rotulo} perdeu fonte ${fonte}.`);
          }
        } else {
          if (p.fonteVento && p.fonteVento !== "Indisponível" && !c.at(-1).includes(p.fonteVento)) {
            throw new Error(`${saida}: ${tipo}/${rotulo} perdeu fonte do vento.`);
          }
          const colunaRajada = indice === 2 ? 2 : 3;
          const rajadaExibida = Number.isFinite(p.rajadaMaxKmh)
            ? indice === 2 ? p.rajadaMaxKmh : Math.round(p.rajadaMaxKmh) : null;
          if (!valorCorreto(c[colunaRajada], rajadaExibida, "km/h")) {
            throw new Error(`${saida}: ${tipo}/${rotulo} perdeu rajada ou unidade.`);
          }
          if (Number.isFinite(p.rajadaMaxKmh)) {
            if (p.fonteRajada && !c.at(-1).includes(p.fonteRajada)) {
              throw new Error(`${saida}: ${tipo}/${rotulo} perdeu fonte da rajada.`);
            }
            if (p.rajadaPrevistaEm && !c.at(-1).includes(p.rajadaPrevistaEm)) {
              throw new Error(`${saida}: ${tipo}/${rotulo} perdeu horário do pico de rajada.`);
            }
          }
        }
        const referencias = tipo === "chuva"
          ? [p.referenciaPrecipitacaoEm, p.referenciaProbabilidadeEm]
          : [p.referenciaEm];
        for (const referencia of referencias.filter(Boolean)) {
          if (!c.at(-1).includes(referencia)) {
            throw new Error(`${saida}: ${tipo}/${rotulo} perdeu horário de referência.`);
          }
        }
        validacoes.push({ saida, indicador: tipo, periodo: p.periodo, janelaLocal: p.janela, valido: true });
      }
    }
  }
  const cardPainel = (rotulo) => $painel("section.indicadores article.card")
    .filter((_, card) => limpar($painel(card).find("h2.rotulo").first().text()) === rotulo).first();
  const cardEmail = (rotulo) => $email('[data-email-metrics="true"] td')
    .filter((_, card) => limpar($email(card).find("div").first().text()) === rotulo).first();
  const secaoArPdf = $pdf("section.bloco-tabela")
    .filter((_, secao) => limpar($pdf(secao).find("h4.subsecao").first().text()).includes("Qualidade do Ar e Índice UV"))
    .first();
  if (!secaoArPdf.length) throw new Error("PDF: tabela de qualidade do ar e UV ausente.");
  const linhasArPdf = secaoArPdf.find("tbody tr").toArray();
  if (linhasArPdf.length !== 2) throw new Error("PDF: tabela de qualidade do ar e UV incompleta.");
  const valoresAtuais = [
    { indicador: "qualidadeAr", rotuloPainel: "Qualidade do ar", rotuloEmail: "QUALIDADE DO AR",
      valor: report.qualidadeAr?.usAqi, referencia: report.qualidadeAr?.referenciaEm,
      unidade: "US AQI", linhaPdf: linhasArPdf[0] },
    { indicador: "indiceUv", rotuloPainel: "Índice UV", rotuloEmail: null,
      valor: report.indiceUv?.status === "operacional" ? report.indiceUv.valorAtual : null,
      referencia: report.indiceUv?.referenciaEm, unidade: "Índice UV", linhaPdf: linhasArPdf[1] },
  ];
  const horarioBrasilia = (iso) => new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(new Date(iso)).replace(",", "");
  for (const item of valoresAtuais) {
    const painel = cardPainel(item.rotuloPainel);
    const email = item.rotuloEmail ? cardEmail(item.rotuloEmail) : $email('[data-email-uv="true"]').first();
    if (!painel.length || !email.length) throw new Error(`${item.indicador}: card ausente no painel ou e-mail.`);
    const partes = [
      { saida: "painel", valor: limpar(painel.find(".valor").first().text()), contexto: limpar(painel.text()) },
      { saida: "pdf", valor: celulas($pdf, item.linhaPdf)[1], contexto: limpar(secaoArPdf.text()) },
      { saida: "email", valor: item.rotuloEmail ? limpar(email.find(".email-metric-value").first().text()) : limpar(email.text()),
        contexto: limpar(email.text()) },
    ];
    for (const parte of partes) {
      const disponivel = Number.isFinite(item.valor);
      const valorOk = disponivel
        ? valorCorreto(parte.valor, item.valor, parte.saida === "painel" && item.indicador === "qualidadeAr" ? "US AQI" : "")
        : /não disponível|indisponível|—/i.test(parte.valor);
      if (!valorOk) throw new Error(`${parte.saida}: ${item.indicador} perdeu valor ou estado indisponível.`);
      if (disponivel) {
        if (!parte.contexto.includes("Open-Meteo")) throw new Error(`${parte.saida}: ${item.indicador} perdeu fonte.`);
        const referencia = parte.saida === "painel" ? horarioBrasilia(item.referencia) : item.referencia;
        if (!referencia || !parte.contexto.includes(referencia)) {
          throw new Error(`${parte.saida}: ${item.indicador} perdeu horário de referência.`);
        }
        if (item.indicador === "qualidadeAr" && !parte.contexto.includes(item.unidade)) {
          throw new Error(`${parte.saida}: ${item.indicador} perdeu unidade.`);
        }
      }
      validacoes.push({ saida: parte.saida, indicador: item.indicador, valido: true });
    }
  }
  const tabelaTemperatura = $pdf(".tabela-temp-umidade tbody tr").first();
  const previsoes = [
    { nome: "temperatura", painel: "Temperatura prevista", email: "PREVISÃO TEMP. MÍN/MÁX",
      valores: [report.tempMin, report.tempMax], unidade: "°C", indicePdf: 0 },
    { nome: "umidade", painel: "Umidade relativa prevista", email: "PREVISÃO UMIDADE MÍN/MÁX",
      valores: [report.umidadeMin, report.umidadeMax], unidade: "%", indicePdf: 2 },
  ];
  for (const item of previsoes) {
    const painel = cardPainel(item.painel);
    const email = cardEmail(item.email);
    const pdf = celulas($pdf, tabelaTemperatura);
    if (!painel.length || !email.length || pdf.length !== 4) throw new Error(`${item.nome}: card ou tabela ausente.`);
    for (let i = 0; i < 2; i++) {
      const esperado = item.valores[i];
      const rotulo = Number.isFinite(esperado) ? String(esperado).replace(".", ",") : null;
      const checarPar = (saida, elemento) => {
        const valor = limpar(elemento.find(".valor, .email-metric-value").first().text());
        if (rotulo ? !valor.includes(`${rotulo}${item.unidade === "°C" ? "°" : "%"}`)
          : !/indisponível|não disponível|—/i.test(valor)) {
          throw new Error(`${saida}: ${item.nome} não coincide com o snapshot.`);
        }
        if (rotulo && (!limpar(elemento.text()).includes("INMET")
          || (report.inmetPrevisao?.consultadoEm && !limpar(elemento.text()).includes(report.inmetPrevisao.consultadoEm)))) {
          throw new Error(`${saida}: ${item.nome} perdeu fonte ou horário INMET.`);
        }
      };
      checarPar("painel", painel);
      checarPar("email", email);
      if (!valorCorreto(pdf[item.indicePdf + i], esperado, item.unidade))
        throw new Error(`PDF: ${item.nome} não coincide com o snapshot.`);
      validacoes.push({ saida: "painel/pdf/email", indicador: item.nome, limite: i ? "max" : "min", valido: true });
    }
  }
  const calor = calorPorData(report.climaSaude, dataLocal(report.geradoEmISO, report.cidade?.fuso));
  const textosCalor = [
    limpar($painel("article.card.heat").first().text()),
    celulas($pdf, $pdf(".tabela-calor tbody tr").first())[3] || "",
    limpar(cardEmail("CALOR").text()),
  ];
  for (const [indice, valor] of textosCalor.entries()) {
    if (calor ? !valor.toLowerCase().includes(calor.rotulo.toLowerCase())
      : !/indisponível|não disponível|desatualizado/i.test(valor)) {
      throw new Error(`${["painel", "pdf", "email"][indice]}: nível de calor não coincide com EHF da data.`);
    }
    validacoes.push({ saida: ["painel", "pdf", "email"][indice], indicador: "calorEhf", valido: true });
  }
  if (calor) {
    const dataEhf = report.climaSaude.dados.dataConsulta;
    const consultaEhf = report.climaSaude.dados.consultadoEm;
    const secaoPdfCalor = $pdf(".tabela-calor").closest("section").text();
    if (!textosCalor[0].includes("Clima e Saúde") || !textosCalor[0].includes(dataEhf)
        || !secaoPdfCalor.includes("Clima e Saúde") || !secaoPdfCalor.includes(dataEhf)
        || !secaoPdfCalor.includes(consultaEhf)
        || !textosCalor[2].includes("Clima e Saúde") || !textosCalor[2].includes(dataEhf)
        || !textosCalor[2].includes(consultaEhf)) {
      throw new Error("Calor: fonte, data EHF ou horário de consulta divergem entre as saídas.");
    }
  }
  return validacoes;
}

module.exports = { conferirSaidasPeriodo };
