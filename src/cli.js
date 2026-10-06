// Comando único de linha de comando: coleta os dados, gera o PDF e envia o
// e-mail imediatamente, sem precisar subir o painel/servidor.
//
// Uso:
//   npm run send-now
//   node src/cli.js
//   node src/cli.js --sem-email      (gera o PDF em /output mas não envia)
//   node src/cli.js --cidade=salvador
//   node src/cli.js --teste --horario=05:00,15:00 --todas-bases
//                                    (envio de TESTE dos informativos agendados:
//                                     assunto "[TESTE 05:00]", PDF *_TESTE, sem
//                                     histórico do agendador e sem GED; o das
//                                     15h compara com o das 05h deste teste)

require("dotenv").config();
require("./security/certificados");
const { executarPipeline } = require("./pipeline");
const { fecharNavegador } = require("./render/pdfGenerator");
const { CIDADES } = require("./config/cities");
const { resumo } = require("./logic/scheduledReport");

function lerArgumento(nome) {
  const arg = process.argv.find((a) => a.startsWith(`--${nome}=`));
  return arg ? arg.split("=")[1] : undefined;
}

async function enviarTeste(enviarEmail) {
  const horarios = (lerArgumento("horario") || "05:00,15:00").split(",").map((h) => h.trim()).filter(Boolean);
  const invalido = horarios.find((h) => !["05:00", "15:00"].includes(h));
  if (invalido) throw new Error(`Horário inválido: "${invalido}". Use 05:00 e/ou 15:00.`);
  const bases = process.argv.includes("--todas-bases") ? Object.keys(CIDADES) : [lerArgumento("cidade") || process.env.CIDADE];
  let falhas = 0;
  for (const cidadeChave of bases) {
    let anterior = null;
    for (const horarioAgendado of horarios) {
      try {
        const r = await executarPipeline({ cidadeChave, enviarEmail, horarioAgendado, teste: true, comparacaoAnterior: anterior });
        if (horarioAgendado === "05:00") anterior = resumo(r.report);
        console.log(`[CIM][TESTE ${horarioAgendado}] ${r.report.cidade.nome}: ${r.envio ? `enviado para ${r.envio.destinatarios.join(", ")}` : "e-mail não enviado (--sem-email)"} | ${r.arquivoPdf}`);
      } catch (erro) {
        falhas += 1;
        console.error(`[CIM][TESTE ${horarioAgendado}] ${cidadeChave}: falha — ${erro.message}`);
      }
    }
  }
  return falhas;
}

async function main() {
  const enviarEmail = !process.argv.includes("--sem-email");
  const cidadeChave = lerArgumento("cidade");

  if (process.argv.includes("--teste")) {
    try {
      const falhas = await enviarTeste(enviarEmail);
      process.exitCode = falhas ? 1 : 0;
    } catch (erro) {
      console.error("[CIM] Falha no envio de teste:", erro.message);
      process.exitCode = 1;
    } finally {
      await fecharNavegador();
    }
    return;
  }

  console.log(`[CIM] Iniciando geração do informativo${cidadeChave ? ` (${cidadeChave})` : ""}...`);
  const inicio = Date.now();

  try {
    const resultado = await executarPipeline({ cidadeChave, enviarEmail });
    const segundos = ((Date.now() - inicio) / 1000).toFixed(1);

    console.log(`[CIM] PDF gerado: ${resultado.caminhoArquivo}`);
    if (resultado.envio) {
      console.log(
        `[CIM] E-mail enviado para: ${resultado.envio.destinatarios.join(", ")} (id: ${resultado.envio.messageId})`
      );
    } else {
      console.log("[CIM] Envio de e-mail pulado (--sem-email).");
    }
    if (resultado.report.avisosColeta.length > 0) {
      console.log("[CIM] Avisos de coleta:", resultado.report.avisosColeta.join(" | "));
    }
    console.log(`[CIM] Concluído em ${segundos}s.`);
    process.exitCode = 0;
  } catch (erro) {
    console.error("[CIM] Falha ao gerar/enviar o informativo:", erro.message);
    process.exitCode = 1;
  } finally {
    await fecharNavegador();
  }
}

main();
