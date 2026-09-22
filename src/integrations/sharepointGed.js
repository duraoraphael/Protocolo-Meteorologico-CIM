// Integração com o GED SharePoint do CIM, via Microsoft Graph API.
//
// Autenticação: OAuth2 client credentials grant (App Registration no Azure
// AD, sem usuário logado — é a aplicação quem se autentica, não uma pessoa).
//
// Ponto crítico: a permissão concedida ao app é `Sites.Selected`, o tipo
// MAIS RESTRITO de permissão do Graph para SharePoint. Diferente de
// `Sites.ReadWrite.All` (acesso a todos os sites do tenant), `Sites.Selected`
// NÃO dá acesso a nenhum site por padrão — alguém com direito de
// administração no site (ou um admin do SharePoint) precisa conceder acesso
// explícito a ESTE app para O site do GED, via uma chamada separada à API
// (POST /sites/{site-id}/permissions) ou pelo SharePoint admin center.
// Sem esse passo, toda chamada de escrita abaixo devolve HTTP 403, mesmo com
// token válido. Isso é intencional da arquitetura Sites.Selected — não é bug
// de configuração deste código.

const GRAPH = "https://graph.microsoft.com/v1.0";

function credenciaisConfiguradas() {
  return Boolean(
    process.env.AZURE_TENANT_ID &&
      process.env.AZURE_CLIENT_ID &&
      process.env.AZURE_CLIENT_SECRET
  );
}

// O que o envio de arquivo (enviarArquivo) realmente usa é o ID da
// biblioteca — hostname/site path só servem para o diagnóstico inicial
// (resolverSite/listarBibliotecas), não para o upload do dia a dia.
function destinoConfigurado() {
  return credenciaisConfiguradas() && Boolean(process.env.SHAREPOINT_DRIVE_ID);
}

// Cache simples em memória: o token dura ~1h, não faz sentido pedir um novo
// a cada chamada dentro do mesmo processo.
let tokenCache = { valor: null, expiraEm: 0 };

async function obterToken() {
  if (!credenciaisConfiguradas()) {
    throw new Error(
      "GED SharePoint não configurado: defina AZURE_TENANT_ID, AZURE_CLIENT_ID e AZURE_CLIENT_SECRET no .env."
    );
  }

  if (tokenCache.valor && Date.now() < tokenCache.expiraEm) {
    return tokenCache.valor;
  }

  const params = new URLSearchParams({
    client_id: process.env.AZURE_CLIENT_ID,
    client_secret: process.env.AZURE_CLIENT_SECRET,
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials",
  });

  const resposta = await fetch(
    `https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
      signal: AbortSignal.timeout(20000),
    }
  );

  const json = await resposta.json();
  if (!resposta.ok) {
    throw new Error(
      `Azure AD recusou a autenticação: ${json.error} — ${(json.error_description || "").split("\n")[0]}`
    );
  }

  // Renova 60s antes de expirar, por margem de segurança.
  tokenCache = {
    valor: json.access_token,
    expiraEm: Date.now() + (json.expires_in - 60) * 1000,
  };
  return tokenCache.valor;
}

async function chamarGraph(caminho, opcoes = {}) {
  const token = await obterToken();
  const resposta = await fetch(`${GRAPH}${caminho}`, {
    ...opcoes,
    headers: {
      Authorization: `Bearer ${token}`,
      ...opcoes.headers,
    },
    signal: AbortSignal.timeout(30000),
  });

  if (!resposta.ok) {
    const corpo = await resposta.text().catch(() => "");
    const dica =
      resposta.status === 403
        ? " — provável causa: este app ainda não recebeu acesso ao site via Sites.Selected (ver comentário no topo do arquivo)."
        : "";
    throw new Error(`Graph API HTTP ${resposta.status} em ${caminho}${dica} | ${corpo.slice(0, 200)}`);
  }

  return resposta.status === 204 ? null : resposta.json();
}

/**
 * Resolve o ID do site do SharePoint a partir do hostname + caminho.
 * Ex.: resolverSite("petrobras.sharepoint.com", "/sites/GED-CIM")
 */
async function resolverSite(hostname, sitePath) {
  const site = await chamarGraph(`/sites/${hostname}:${sitePath}`);
  return { id: site.id, nome: site.displayName, url: site.webUrl };
}

/** Lista as bibliotecas de documentos (drives) de um site — ajuda a achar o ID certo. */
async function listarBibliotecas(siteId) {
  const resultado = await chamarGraph(`/sites/${siteId}/drives`);
  return resultado.value.map((d) => ({ id: d.id, nome: d.name, url: d.webUrl }));
}

/**
 * Envia um arquivo (PDF do informativo) para uma pasta do GED.
 * @param {string} driveId ID da biblioteca (obtido via listarBibliotecas)
 * @param {string} caminhoNoDrive ex.: "Informativos CIM/2026-09-16.pdf"
 * @param {Buffer} conteudo
 */
async function enviarArquivo(driveId, caminhoNoDrive, conteudo) {
  // Upload simples (funciona até 4 MB — nossos PDFs ficam na casa de 1 MB,
  // então não precisamos da sessão de upload em partes exigida para arquivos
  // maiores).
  const caminhoCodificado = caminhoNoDrive.split("/").map(encodeURIComponent).join("/");
  const resultado = await chamarGraph(
    `/drives/${driveId}/root:/${caminhoCodificado}:/content`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/pdf" },
      body: conteudo,
    }
  );
  return { id: resultado.id, url: resultado.webUrl };
}

/**
 * Cria uma pasta na raiz de uma biblioteca (ou dentro de outra pasta, se
 * `pastaPaiCaminho` for informado). Idempotente: se a pasta já existir,
 * não dá erro — só devolve os dados da pasta existente.
 */
async function criarPasta(driveId, nome, pastaPaiCaminho) {
  const destino = pastaPaiCaminho
    ? `/drives/${driveId}/root:/${pastaPaiCaminho.split("/").map(encodeURIComponent).join("/")}:/children`
    : `/drives/${driveId}/root/children`;

  try {
    const resultado = await chamarGraph(destino, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: nome,
        folder: {},
        "@microsoft.graph.conflictBehavior": "fail",
      }),
    });
    return { id: resultado.id, nome: resultado.name, url: resultado.webUrl, criada: true };
  } catch (erro) {
    // HTTP 409 = já existe uma pasta com esse nome — não é erro, é o caso
    // comum de rodar isso mais de uma vez.
    if (!erro.message.includes("409")) throw erro;
    const caminhoCompleto = pastaPaiCaminho ? `${pastaPaiCaminho}/${nome}` : nome;
    const existente = await chamarGraph(
      `/drives/${driveId}/root:/${caminhoCompleto.split("/").map(encodeURIComponent).join("/")}`
    );
    return { id: existente.id, nome: existente.name, url: existente.webUrl, criada: false };
  }
}

/**
 * Envia um informativo (PDF) para o GED, organizado em
 * "<SHAREPOINT_PASTA_DESTINO>/<subpasta>/<nomeArquivo>" — subpasta é
 * normalmente o nome da base, para não misturar os PDFs das 12 instalações
 * numa lista só.
 *
 * Não lança em caso de indisponibilidade do GED: o chamador decide se isso
 * deve virar um aviso no relatório ou ser só registrado no log — enviar o
 * e-mail nunca deve ficar refém do SharePoint estar fora do ar.
 */
async function enviarInformativo(pdfBuffer, nomeArquivo, subpasta) {
  if (!destinoConfigurado()) {
    throw new Error(
      "GED não configurado (falta SHAREPOINT_DRIVE_ID no .env) — rode node src/cliTestarSharepoint.js para diagnosticar."
    );
  }
  const pastaBase = process.env.SHAREPOINT_PASTA_DESTINO || "Informativos CIM";
  const caminho = subpasta
    ? `${pastaBase}/${subpasta}/${nomeArquivo}`
    : `${pastaBase}/${nomeArquivo}`;
  return enviarArquivo(process.env.SHAREPOINT_DRIVE_ID, caminho, pdfBuffer);
}

module.exports = {
  credenciaisConfiguradas,
  destinoConfigurado,
  obterToken,
  resolverSite,
  listarBibliotecas,
  criarPasta,
  enviarArquivo,
  enviarInformativo,
};
