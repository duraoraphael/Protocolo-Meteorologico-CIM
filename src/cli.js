// Comando único de linha de comando: coleta os dados, gera o PDF e envia o
// e-mail imediatamente, sem precisar subir o painel/servidor.
//
// Uso:
//   npm run send-now
//   node src/cli.js
//   node src/cli.js --sem-email      (gera o PDF em /output mas não envia)
//   node src/cli.js --cidade=salvador
//   node src/cli.js --teste --horario=08:00 --cidade=rio_de_janeiro --enviar-para=voce@empresa.com
//   node src/cli.js --avulso-automatico --horario=15:00 --cidade=rio_de_janeiro --enviar-para=voce@empresa.com
//   node src/cli.js --teste --horario=08:00,15:00 --todas-bases
//                                    (envio de TESTE dos informativos agendados:
//                                     assunto "[TESTE 08:00]", PDF *_TESTE, sem
//                                     histórico do agendador e sem GED.
//                                     Edições: 08:00, 15:00 ou "todas".

require("dotenv").config();
require("./security/certificados");
const { executarPipeline } = require("./pipeline");
const { fecharNavegador } = require("./render/pdfGenerator");
const { CIDADES } = require("./config/cities");
const { horariosConfigurados } = require("./logic/informativoValidity");

function lerArgumento(nome) {
  const arg = process.argv.find((a) => a.startsWith(`--${nome}=`));
  return arg ? arg.split("=")[1] : undefined;
}

async function enviarTeste(enviarEmail) {
  const argumento = lerArgumento("horario") || "08:00,15:00";
  const destinoTeste = lerArgumento("enviar-para");
  const horarios = horariosConfigurados(argumento === "todas" ? "" : argumento);
  const bases = process.argv.includes("--todas-bases") ? Object.keys(CIDADES) : [lerArgumento("cidade") || process.env.CIDADE];
  let falhas = 0;
  for (const cidadeChave of bases) {
    for (const horarioAgendado of horarios) {
      try {
        const r = await executarPipeline({
          cidadeChave,
          enviarEmail,
          horarioAgendado,
          teste: true,
          destinatariosTeste: destinoTeste ? [destinoTeste] : null,
        });
        console.log(`[CIM][TESTE ${horarioAgendado}] ${r.report.cidade.nome}: ${r.envio ? `enviado para ${r.envio.destinatarios.join(", ")}` : "e-mail não enviado (--sem-email)"} | ${r.arquivoPdf}`);
      } catch (erro) {
        falhas += 1;
        console.error(`[CIM][TESTE ${horarioAgendado}] ${cidadeChave}: falha — ${erro.message}`);
      }
    }
  }
  return falhas;
}

async function enviarAvulsoAutomatico() {
  const cidadeChave = lerArgumento("cidade");
  const horario = lerArgumento("horario");
  const destinatario = lerArgumento("enviar-para");
  if (!cidadeChave || !horario || !destinatario) {
    throw new Error("--avulso-automatico exige --cidade, --horario e --enviar-para.");
  }
  const horarios = horariosConfigurados(horario);
  if (horarios.length !== 1) {
    throw new Error("--avulso-automatico aceita somente um horário: 08:00 ou 15:00.");
  }
  const resultado = await executarPipeline({
    cidadeChave,
    enviarEmail: true,
    horarioAgendado: horarios[0],
    destinatariosAvulsos: [destinatario],
  });
  console.log(`[CIM][ENVIO AVULSO ${horarios[0]}] ${resultado.report.cidade.nome}: enviado para ${resultado.envio.destinatarios.join(", ")} | ${resultado.arquivoPdf}`);
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

  if (process.argv.includes("--avulso-automatico")) {
    try {
      await enviarAvulsoAutomatico();
      process.exitCode = 0;
    } catch (erro) {
      console.error("[CIM] Falha no envio avulso:", erro.message);
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
