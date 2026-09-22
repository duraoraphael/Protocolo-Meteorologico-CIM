// Comando único de linha de comando: coleta os dados, gera o PDF e envia o
// e-mail imediatamente, sem precisar subir o painel/servidor.
//
// Uso:
//   npm run send-now
//   node src/cli.js
//   node src/cli.js --sem-email      (gera o PDF em /output mas não envia)
//   node src/cli.js --cidade=salvador

require("dotenv").config();
const { executarPipeline } = require("./pipeline");
const { fecharNavegador } = require("./render/pdfGenerator");

function lerArgumento(nome) {
  const arg = process.argv.find((a) => a.startsWith(`--${nome}=`));
  return arg ? arg.split("=")[1] : undefined;
}

async function main() {
  const enviarEmail = !process.argv.includes("--sem-email");
  const cidadeChave = lerArgumento("cidade");

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
