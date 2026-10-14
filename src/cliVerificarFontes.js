// Verifica todas as fontes externas sem gerar PDF nem enviar informativo.
//
// Uso:
//   npm run verificar-fontes
//   node src/cliVerificarFontes.js --enviar-email   (avisa EMAIL_ALERTA_FONTES se houver problema)
//   node src/cliVerificarFontes.js --json
//
// Código de saída 1 quando há problema, para uso em monitoramento externo.

require("dotenv").config();
require("./security/certificados");
const { executarVerificacao, formatarTexto } = require("./logic/verificacaoFontes");
const { enviarVerificacaoFontes } = require("./email/sendVerificacaoFontes");

async function main() {
  const resultado = await executarVerificacao();
  console.log(process.argv.includes("--json") ? JSON.stringify(resultado, null, 2) : formatarTexto(resultado));
  if (process.argv.includes("--enviar-email") && resultado.problemas.length) {
    const envio = await enviarVerificacaoFontes(resultado);
    console.log(envio.enviado
      ? `[FONTES] Aviso enviado para ${envio.destinatarios.join(", ")}.`
      : `[FONTES] Aviso não enviado: ${envio.motivo}.`);
  }
  process.exitCode = resultado.problemas.length ? 1 : 0;
}

main().catch((erro) => {
  console.error("[FONTES] Falha na verificação:", erro.message);
  process.exitCode = 2;
});
