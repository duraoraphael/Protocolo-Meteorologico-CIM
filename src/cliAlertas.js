#!/usr/bin/env node
// Verifica manualmente o monitor de alertas.
//
// Uso:
//   node src/cliAlertas.js              -> simula: mostra o que seria enviado, SEM enviar
//                                          e SEM marcar como avisado
//   node src/cliAlertas.js --enviar     -> envia de verdade e registra
//   node src/cliAlertas.js --limpar     -> apaga o histórico de "já avisado"
//   node src/cliAlertas.js --bases=a,b  -> restringe as bases

require("dotenv").config({ quiet: true });
require("./security/certificados");
const fs = require("fs");
const { verificarAlertas, ARQUIVO_ESTADO } = require("./logic/alertWatcher");

function argumento(nome) {
  const p = process.argv.find((a) => a.startsWith(`--${nome}=`));
  return p ? p.split("=")[1] : null;
}

(async () => {
  if (process.argv.includes("--limpar")) {
    try {
      fs.unlinkSync(ARQUIVO_ESTADO);
      console.log("[CIM] Histórico de alertas notificados apagado.");
    } catch (erro) {
      if (erro.code === "ENOENT") console.log("[CIM] Nenhum histórico para apagar.");
      else throw erro;
    }
    return;
  }

  const enviar = process.argv.includes("--enviar");
  const basesArg = argumento("bases");
  if (basesArg) process.env.BASES_MONITOR_ALERTAS = basesArg;

  console.log(
    `[CIM] Verificando alertas${enviar ? " (MODO ENVIO)" : " (simulação — nada será enviado)"}...`
  );

  // Em simulação não registramos nada, para que o teste não "consuma" o
  // alerta e impeça o envio real logo depois.
  const resultado = await verificarAlertas({ registrar: enviar });

  console.log("");
  if (resultado.totalNovos === 0) {
    console.log("Nenhuma condição de alerta nova nas bases monitoradas.");
  } else {
    console.log(`${resultado.totalNovos} alerta(s) novo(s) em ${resultado.porBase.length} base(s):`);
    console.log("");
    for (const base of resultado.porBase) {
      console.log(`  ${base.cidade.nome} — ${base.cidade.uf}`);
      for (const a of base.alertas) {
        const marca = `[${a.grau || (a.gravidade === "severo" ? "SEVERO" : "ALTO")}]`;
        console.log(`    ${marca} ${a.tipo}${a.motivo === "agravou" ? " (AGRAVOU)" : ""}`);
        if (a.detalhe) console.log(`             ${a.detalhe}`);
        console.log(`             janela: ${a.janela} · critério: ${a.origem}${a.fonteDados ? ` · dado: ${a.fonteDados}` : ""}`);
      }
      console.log("");
    }
  }

  if (resultado.falhas.length) {
    console.log("Bases não verificadas:");
    resultado.falhas.forEach((f) => console.log(`  ${f.nome}: ${f.erro}`));
    console.log("");
  }

  if (enviar && resultado.totalNovos > 0) {
    const { enviarAlertaPorEmail } = require("./email/sendAlert");
    for (const base of resultado.porBase) {
      try {
        const envio = await enviarAlertaPorEmail(base);
        console.log(`[CIM] Alerta enviado (${base.chave}) -> ${envio.destinatarios.join(", ")}`);
      } catch (erro) {
        console.error(`[CIM] Falha ao enviar (${base.chave}): ${erro.message}`);
      }
    }
  } else if (!enviar) {
    console.log("Simulação: nenhum e-mail enviado e nada marcado como avisado.");
    console.log("Use --enviar para disparar de verdade.");
  }
})();
