#!/usr/bin/env node
// Diagnóstico da integração com o GED SharePoint.
//
// Uso:
//   node src/cliTestarSharepoint.js
//     -> testa só a autenticação (Client ID/Secret/Tenant)
//
//   node src/cliTestarSharepoint.js --site=petrobras.sharepoint.com --caminho=/sites/GED-CIM
//     -> além de autenticar, resolve o site e lista as bibliotecas de
//        documentos dele (com os IDs necessários para configurar o envio)
//
//   node src/cliTestarSharepoint.js --enviar-teste --drive=<ID_DA_BIBLIOTECA>
//     -> sobe um arquivo de teste (texto simples) na biblioteca indicada,
//        para confirmar que a permissão de ESCRITA está concedida (não só leitura)

require("dotenv").config({ quiet: true });
const ged = require("./integrations/sharepointGed");

function argumento(nome) {
  const p = process.argv.find((a) => a.startsWith(`--${nome}=`));
  return p ? p.split("=")[1] : null;
}

(async () => {
  console.log("[GED] 1. Testando autenticação (Client ID/Secret/Tenant)...");
  try {
    await ged.obterToken();
    console.log("[GED] OK — token obtido do Azure AD.");
  } catch (erro) {
    console.error("[GED] FALHA:", erro.message);
    process.exitCode = 1;
    return;
  }

  const site = argumento("site");
  const caminho = argumento("caminho");

  if (!site || !caminho) {
    console.log("");
    console.log("Autenticação OK. Para continuar o diagnóstico, informe o site do GED:");
    console.log("  node src/cliTestarSharepoint.js --site=petrobras.sharepoint.com --caminho=/sites/NomeDoSite");
    console.log("");
    console.log("(o endereço completo do GED, ex. https://petrobras.sharepoint.com/sites/GED-CIM,");
    console.log(" vira --site=petrobras.sharepoint.com --caminho=/sites/GED-CIM)");
    return;
  }

  console.log("");
  console.log(`[GED] 2. Resolvendo o site ${site}${caminho}...`);
  let siteInfo;
  try {
    siteInfo = await ged.resolverSite(site, caminho);
    console.log("[GED] OK — site encontrado:");
    console.log("       ID  :", siteInfo.id);
    console.log("       Nome:", siteInfo.nome);
    console.log("       URL :", siteInfo.url);
  } catch (erro) {
    console.error("[GED] FALHA:", erro.message);
    if (erro.message.includes("403")) {
      console.error("");
      console.error(
        "  Causa provável: este app (Client ID configurado) ainda não recebeu"
      );
      console.error(
        "  acesso a este site. Como a permissão é Sites.Selected, alguém com"
      );
      console.error(
        "  direito de administração no site precisa conceder esse acesso"
      );
      console.error("  explicitamente — não basta o token ser válido.");
    }
    process.exitCode = 1;
    return;
  }

  console.log("");
  console.log("[GED] 3. Listando bibliotecas de documentos do site...");
  try {
    const bibliotecas = await ged.listarBibliotecas(siteInfo.id);
    if (bibliotecas.length === 0) {
      console.log("[GED] Nenhuma biblioteca encontrada (ou sem permissão de leitura nelas).");
      return;
    }
    bibliotecas.forEach((b) => {
      console.log(`  - ${b.nome}`);
      console.log(`      ID : ${b.id}`);
      console.log(`      URL: ${b.url}`);
    });
    console.log("");
    console.log("Copie o ID da biblioteca certa e adicione no .env:");
    console.log("  SHAREPOINT_SITE_HOSTNAME=" + site);
    console.log("  SHAREPOINT_SITE_PATH=" + caminho);
    console.log("  SHAREPOINT_DRIVE_ID=<ID da biblioteca escolhida>");
  } catch (erro) {
    console.error("[GED] FALHA ao listar bibliotecas:", erro.message);
    process.exitCode = 1;
    return;
  }

  if (process.argv.includes("--enviar-teste")) {
    const driveId = argumento("drive") || process.env.SHAREPOINT_DRIVE_ID;
    if (!driveId) {
      console.error("");
      console.error("[GED] --enviar-teste precisa de --drive=<ID> (ou SHAREPOINT_DRIVE_ID no .env).");
      process.exitCode = 1;
      return;
    }
    console.log("");
    console.log("[GED] 4. Enviando arquivo de teste...");
    try {
      const conteudo = Buffer.from(
        `Teste de escrita do Protocolo Meteorológico CIM — ${new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}`
      );
      const resultado = await ged.enviarArquivo(driveId, "teste-protocolo-cim.txt", conteudo);
      console.log("[GED] OK — arquivo enviado:", resultado.url);
    } catch (erro) {
      console.error("[GED] FALHA no envio:", erro.message);
      process.exitCode = 1;
    }
  }
})();
