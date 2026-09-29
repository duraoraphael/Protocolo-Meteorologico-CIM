const fs = require("fs");
const path = require("path");
const { getCidade } = require("./config/cities");
const { montarRelatorio } = require("./logic/reportBuilder");
const { gerarPdfBuffer } = require("./render/pdfGenerator");
const { enviarRelatorioPorEmail } = require("./email/sendReport");
const ged = require("./integrations/sharepointGed");
const { resumo, compararComManha } = require("./logic/scheduledReport");

const PASTA_SAIDA = path.join(__dirname, "..", "output");

const MENSAGENS_PUBLICAS_ETAPA = Object.freeze({
  weather: "Não foi possível obter os dados meteorológicos.",
  pdf: "Não foi possível gerar o PDF.",
  email: "O PDF foi gerado, mas o envio do e-mail falhou.",
});

class ErroPipelineRelatorio extends Error {
  constructor(etapa, mensagemPublica, erroOriginal) {
    super(erroOriginal?.message || mensagemPublica, { cause: erroOriginal });
    this.name = "ErroPipelineRelatorio";
    this.etapa = etapa;
    this.mensagemPublica = mensagemPublica;
  }
}

function erroDaEtapa(etapa, codigoLog, funcao, erroOriginal) {
  console.error(`[RELATORIO][ERRO][${codigoLog}]`, {
    mensagem: erroOriginal?.message || String(erroOriginal),
    stack: erroOriginal?.stack,
    funcao,
    etapa,
    erroOriginal,
  });
  return new ErroPipelineRelatorio(
    etapa,
    MENSAGENS_PUBLICAS_ETAPA[etapa] || "Não foi possível concluir o envio do relatório.",
    erroOriginal
  );
}

/**
 * Executa o fluxo completo: coleta dados -> monta relatório -> gera PDF ->
 * salva em /output -> (opcional) envia por e-mail.
 *
 * @param {object} opcoes
 * @param {string} [opcoes.cidadeChave] chave em src/config/cities.js
 * @param {boolean} [opcoes.enviarEmail=true]
 */
// Salva a cópia local do PDF em /output. Numa pasta sincronizada (OneDrive,
// por exemplo), o arquivo do dia anterior pode ficar brevemente bloqueado
// pelo processo de sincronização/antivírus logo após ser criado — isso NUNCA
// deve impedir o envio do e-mail (que já usa o buffer em memória, não o
// arquivo em disco). Tenta algumas vezes e, se o caminho principal continuar
// bloqueado, grava com um sufixo alternativo em vez de falhar.
async function salvarCopiaLocal(pdfBuffer, nomeBase) {
  const caminhoPrincipal = path.join(PASTA_SAIDA, `${nomeBase}.pdf`);
  if (!fs.existsSync(PASTA_SAIDA)) fs.mkdirSync(PASTA_SAIDA, { recursive: true });

  for (let tentativa = 0; tentativa < 3; tentativa++) {
    try {
      fs.writeFileSync(caminhoPrincipal, pdfBuffer);
      return { caminhoArquivo: caminhoPrincipal, aviso: null };
    } catch (erro) {
      if (erro.code !== "EBUSY" && erro.code !== "EPERM") throw erro;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  const caminhoAlternativo = path.join(
    PASTA_SAIDA,
    `${nomeBase}_${Date.now()}.pdf`
  );
  try {
    fs.writeFileSync(caminhoAlternativo, pdfBuffer);
    return {
      caminhoArquivo: caminhoAlternativo,
      aviso: `Não foi possível sobrescrever "${nomeBase}.pdf" (arquivo em uso, possivelmente pelo sincronizador da pasta). Salvo como "${path.basename(caminhoAlternativo)}".`,
    };
  } catch (erro) {
    return { caminhoArquivo: null, aviso: `Não foi possível salvar cópia local do PDF: ${erro.message}` };
  }
}

/**
 * Executa o fluxo completo: coleta dados -> monta relatório -> gera PDF ->
 * salva em /output -> (opcional) envia por e-mail.
 *
 * @param {object} opcoes
 * @param {string} [opcoes.cidadeChave] chave em src/config/cities.js
 * @param {boolean} [opcoes.enviarEmail=true]
 */
async function executarPipeline({ cidadeChave, enviarEmail = true, horarioAgendado = null, comparacaoAnterior = null } = {}) {
  const cidade = getCidade(cidadeChave);
  let report;
  console.log("[RELATORIO] Buscando dados meteorológicos");
  try {
    report = await montarRelatorio(cidade, { horarioAgendado });
  } catch (erro) {
    throw erroDaEtapa("weather", "COLETA_DADOS", "montarRelatorio", erro);
  }
  console.log("[RELATORIO] Dados obtidos");
  if (horarioAgendado) {
    report.nomeArquivoBase += `_${horarioAgendado.replace(":", "")}`;
    if (horarioAgendado === "15:00") {
      report.mudancasDia = compararComManha(comparacaoAnterior, resumo(report));
    }
  }

  let pdfBuffer;
  console.log("[RELATORIO] Gerando HTML");
  console.log("[RELATORIO] Gerando PDF");
  try {
    pdfBuffer = await gerarPdfBuffer(report);
  } catch (erro) {
    throw erroDaEtapa("pdf", "GERACAO_PDF", "gerarPdfBuffer", erro);
  }
  console.log("[RELATORIO] PDF gerado");

  let copiaLocal;
  try {
    copiaLocal = await salvarCopiaLocal(pdfBuffer, report.nomeArquivoBase);
  } catch (erro) {
    throw erroDaEtapa("pdf", "GRAVACAO_PDF", "salvarCopiaLocal", erro);
  }
  const { caminhoArquivo, aviso } = copiaLocal;
  if (aviso) report.avisosColeta.push(aviso);

  let envio = null;
  if (enviarEmail) {
    console.log("[RELATORIO] Preparando e-mail");
    console.log("[RELATORIO] Enviando SMTP");
    try {
      envio = await enviarRelatorioPorEmail(report, pdfBuffer);
    } catch (erro) {
      throw erroDaEtapa("email", "SMTP", "enviarRelatorioPorEmail", erro);
    }
    console.log("[RELATORIO] E-mail enviado", {
      messageId: envio.messageId,
      respostaSmtp: envio.respostaSmtp,
      aceitos: envio.aceitos,
      rejeitados: envio.rejeitados,
    });
  }

  // Sobe pro GED só junto do envio "de verdade" (não em --sem-email de
  // teste) — evita poluir o SharePoint corporativo a cada teste local.
  // Indisponibilidade do GED nunca derruba o e-mail, que já foi enviado
  // (ou está sendo, em paralelo) com o buffer em memória.
  let ged_ = null;
  if (enviarEmail && ged.destinoConfigurado()) {
    try {
      ged_ = await ged.enviarInformativo(pdfBuffer, `${report.nomeArquivoBase}.pdf`, report.cidade.nome);
    } catch (erro) {
      report.avisosColeta.push(`Não foi possível gravar no GED SharePoint: ${erro.message}`);
    }
  }

  return {
    report,
    arquivoPdf: caminhoArquivo ? path.basename(caminhoArquivo) : null,
    caminhoArquivo,
    envio,
    ged: ged_,
  };
}

module.exports = { ErroPipelineRelatorio, executarPipeline, PASTA_SAIDA };
