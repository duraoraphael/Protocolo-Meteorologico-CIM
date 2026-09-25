#!/usr/bin/env node
// Gera o relatório semanal.
//
// Uso:
//   node src/cliSemanal.js                 -> gera PDF + previews HTML, SEM enviar
//   node src/cliSemanal.js --enviar        -> gera e envia por e-mail
//   node src/cliSemanal.js --bases=a,b     -> restringe às bases indicadas
//   node src/cliSemanal.js --dias=5        -> encurta a janela de previsão
//
// O padrão é NÃO enviar: gerar um preview nunca deve disparar e-mail para as
// bases por acidente.

require("dotenv").config({ quiet: true });
require("./security/certificados");
const fs = require("fs");
const { executarPipelineSemanal } = require("./weeklyPipeline");

function argumento(nome) {
  const p = process.argv.find((a) => a.startsWith(`--${nome}=`));
  return p ? p.split("=")[1] : null;
}

(async () => {
  const enviarEmail = process.argv.includes("--enviar");
  const basesArg = argumento("bases");
  const diasArg = argumento("dias");

  const bases = basesArg ? basesArg.split(",").map((s) => s.trim()).filter(Boolean) : undefined;
  const dias = diasArg ? parseInt(diasArg, 10) : 7;

  console.log(`[CIM] Gerando relatório semanal (${dias} dias)${bases ? ` — bases: ${bases.join(", ")}` : " — todas as bases"}...`);
  const inicio = Date.now();

  try {
    const r = await executarPipelineSemanal({ bases, dias, enviarEmail, salvarPreviewHtml: true });
    const rel = r.relatorio;

    console.log(`[CIM] Concluído em ${((Date.now() - inicio) / 1000).toFixed(0)}s`);
    console.log("");
    console.log(`  Período .......... ${rel.periodoLabel}`);
    console.log(`  Bases críticas ... ${rel.totalBasesCriticas}`);
    console.log(`  Bases atenção .... ${rel.totalBasesAtencao}`);
    console.log(`  Bases normais .... ${rel.totalBasesNormais}`);
    console.log(`  Alertas .......... ${rel.alertas.length} (${rel.alertasCriticos.length} críticos)`);
    if (rel.diaMaisCritico) {
      console.log(`  Dia mais crítico . ${rel.diaMaisCritico.diaSemana} ${rel.diaMaisCritico.diaMes}`);
    }
    if (rel.basesComFalha.length) {
      console.log(`  Bases sem dados .. ${rel.basesComFalha.map((b) => b.cidade.nome).join(", ")}`);
    }
    console.log("");
    console.log(`  PDF ............ ${r.caminhoPdf} (${(fs.statSync(r.caminhoPdf).size / 1024).toFixed(0)} KB)`);
    if (r.caminhoHtmlEmail) console.log(`  Preview e-mail . ${r.caminhoHtmlEmail}`);
    if (r.caminhoHtmlPdf) console.log(`  Preview PDF .... ${r.caminhoHtmlPdf}`);

    if (r.envio) {
      console.log("");
      console.log(`[CIM] E-mail enviado para: ${r.envio.destinatarios.join(", ")}`);
    } else {
      console.log("");
      console.log("[CIM] Nenhum e-mail enviado (use --enviar para disparar).");
    }
  } catch (erro) {
    console.error("[CIM] Falha ao gerar o relatório semanal:", erro.message);
    process.exitCode = 1;
  }
})();
