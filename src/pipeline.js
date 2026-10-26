const fs = require("fs");
const path = require("path");
const { getCidade } = require("./config/cities");
const { montarRelatorio } = require("./logic/reportBuilder");
const { gerarPdfBuffer } = require("./render/pdfGenerator");
const { enviarRelatorioPorEmail, enviarAvisoCorRioPorEmail } = require("./email/sendReport");
const ged = require("./integrations/sharepointGed");
const { obterMonitorSecas } = require("./sources/monitorSecas");
const {
  montarPrevisaoProximosDiasInmet,
  montarPrevisaoProximosDiasOpenMeteo,
  complementarPrevisaoProximosDias,
  aplicarRajadasOceanop,
} = require("./sources/previsaoProximosDias");
const { anexarCorRioAoRelatorio } = require("./sources/corRio");
const { validadeInformativo } = require("./logic/informativoValidity");
const { TIPOS_DOCUMENTO } = require("./logic/alertPresentation");
const {
  registrarDocumentoOperacional,
  atualizarAssinaturaDocumentoOperacional,
  validarDocumentoOperacional,
} = require("./logic/documentProvenance");

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
/**
 * @param {boolean} [opcoes.teste=false] envio de teste: assunto "[TESTE …]",
 *   PDF com sufixo _TESTE (não sobrescreve o real) e sem gravação no GED.
 */
function relatorioBaseCorRio(cidade, horarioAgendado = null) {
  const dataNow = new Date();
  return {
    cidade: { chave: cidade.chave, nome: cidade.nome, uf: cidade.uf, fuso: cidade.fusoHorario || "America/Sao_Paulo" },
    dataFormatadaLonga: new Intl.DateTimeFormat("pt-BR", { dateStyle: "full", timeZone: "America/Sao_Paulo" }).format(dataNow),
    dataFormatadaCurta: new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeZone: "America/Sao_Paulo" }).format(dataNow),
    horaConsulta: horarioAgendado || new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "America/Sao_Paulo" }).format(dataNow),
    geradoEmISO: dataNow.toISOString(),
    horarioAgendado,
    tipoDocumento: TIPOS_DOCUMENTO.AVISO_COR_RIO,
    validadeInformativo: validadeInformativo(horarioAgendado, dataNow),
    fontesAutomatizadas: [],
    fontesManuais: [],
    avisosColeta: [],
  };
}

async function executarPipelineCorRio({ enviarEmail = true, horarioAgendado = null, teste = false, permitirSemDestinatarios = false } = {}) {
  const cidade = getCidade("rio_de_janeiro");
  const report = relatorioBaseCorRio(cidade, horarioAgendado);
  if (teste) report.envioTeste = true;
  await anexarCorRioAoRelatorio(report, cidade);
  registrarDocumentoOperacional(report, {
    tipo: TIPOS_DOCUMENTO.AVISO_COR_RIO,
    fontes: ["COR-Rio — Centro de Operações e Resiliência"],
  });

  let envio = null;
  if (enviarEmail) {
    try {
      envio = await enviarAvisoCorRioPorEmail(report);
      if (!envio && !permitirSemDestinatarios) {
        const erro = new Error("Nenhum destinatário vinculado à base COR-RIO.");
        const erroPublico = erroDaEtapa("email", "DESTINATARIOS_COR_RIO", "enviarAvisoCorRioPorEmail", erro);
        erroPublico.mensagemPublica = erro.message;
        throw erroPublico;
      }
    } catch (erro) {
      if (erro instanceof ErroPipelineRelatorio) throw erro;
      throw erroDaEtapa("email", "SMTP_COR_RIO", "enviarAvisoCorRioPorEmail", erro);
    }
  }
  return { report, arquivoPdf: null, caminhoArquivo: null, envio, ged: null };
}

async function executarPipeline({ cidadeChave, enviarEmail = true, horarioAgendado = null, teste = false, tipoEnvio = "informativo", permitirSemDestinatarios = false, destinatariosTeste = null, destinatariosAvulsos = null } = {}) {
  if (tipoEnvio === "cor_rio") {
    return executarPipelineCorRio({ enviarEmail, horarioAgendado, teste, permitirSemDestinatarios });
  }
  const cidade = getCidade(cidadeChave);
  let report;
  console.log("[RELATORIO] Buscando dados meteorológicos");
  try {
    report = await montarRelatorio(cidade, { horarioAgendado, atualizarClimaSaude: true });
  } catch (erro) {
    throw erroDaEtapa("weather", "COLETA_DADOS", "montarRelatorio", erro);
  }
  console.log("[RELATORIO] Dados obtidos");
  if (horarioAgendado) {
    report.nomeArquivoBase += `_${horarioAgendado.replace(":", "")}`;
    // Cada edição é autônoma, sem carregar comparações de outros relatórios.
    delete report.mudancasDia;
  }
  if (teste) {
    report.envioTeste = true;
    report.nomeArquivoBase += "_TESTE";
  }

  // Monitor de Secas (ANA): mensal e em cache por competência. Nunca lança —
  // indisponível vira aviso na seção, sem interromper o protocolo. Recortado
  // para a UF deste informativo: cada PDF leva só o resumo do seu destino.
  report.monitorSecas = await obterMonitorSecas({ uf: cidade.uf });

  // Previsão dos 3 dias seguintes (seção final do PDF), no fuso da própria
  // localidade e a partir do instante de geração do informativo. Nunca lança
  // — falha da fonte vira "Não disponível" na tabela e aviso de coleta.
  const instantePrevisao = new Date(report.geradoEmISO || Date.now());
  const previsaoOpenMeteo3d = montarPrevisaoProximosDiasOpenMeteo(cidade, report.previsaoOpenMeteoDias, { agora: instantePrevisao });
  const previsaoBase3d = complementarPrevisaoProximosDias(
    montarPrevisaoProximosDiasInmet(cidade, report.inmetPrevisao, { agora: instantePrevisao }),
    previsaoOpenMeteo3d,
  );
  report.previsaoProximosDias = aplicarRajadasOceanop(previsaoBase3d, report.previsaoOceanopDias);
  if (report.previsaoProximosDias.status === "indisponivel") {
    report.avisosColeta.push("INMET/Open-Meteo (previsão dos próximos 3 dias): não foi possível obter valores para as datas solicitadas.");
  }

  // COR-Rio (só município do Rio): mesmo serviço/cache do painel, então site,
  // PDF baixado e anexo do e-mail mostram a mesma consulta. Nunca lança.
  await anexarCorRioAoRelatorio(report, cidade);

  atualizarAssinaturaDocumentoOperacional(report);
  validarDocumentoOperacional(report, "geração do documento operacional", { exigirCamposCriticos: true });

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
    validarDocumentoOperacional(report, "gravação do PDF operacional", { exigirCamposCriticos: true });
    copiaLocal = await salvarCopiaLocal(pdfBuffer, report.nomeArquivoBase);
  } catch (erro) {
    throw erroDaEtapa("pdf", "GRAVACAO_PDF", "salvarCopiaLocal", erro);
  }
  const { caminhoArquivo, aviso } = copiaLocal;
  if (aviso) report.avisosColeta.push(aviso);

  // O PDF salvo/baixado preserva o painel técnico completo. O anexo enviado
  // aos destinatários da base meteorológica não inclui o aviso COR-RIO, que
  // possui lista e mensagem próprias.
  let pdfAnexoEmail = pdfBuffer;
  if (enviarEmail && report.corRio) {
    try {
      pdfAnexoEmail = await gerarPdfBuffer(report, { incluirCorRio: false });
    } catch (erro) {
      throw erroDaEtapa("pdf", "GERACAO_PDF_EMAIL", "gerarPdfBuffer", erro);
    }
  }

  let envio = null;
  if (enviarEmail) {
    console.log("[RELATORIO] Preparando e-mail");
    console.log("[RELATORIO] Enviando SMTP");
    try {
      envio = await enviarRelatorioPorEmail(report, pdfAnexoEmail, {
        destinatariosOverride: destinatariosTeste ?? destinatariosAvulsos,
        permitirOverrideDestinatarios: destinatariosAvulsos !== null,
      });
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
  if (enviarEmail && !teste && destinatariosAvulsos === null && ged.destinoConfigurado()) {
    try {
      validarDocumentoOperacional(report, "publicação no GED", { exigirCamposCriticos: true });
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

module.exports = { ErroPipelineRelatorio, executarPipeline, executarPipelineCorRio, PASTA_SAIDA };
