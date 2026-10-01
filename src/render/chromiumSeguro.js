// Endurecimento do Chromium usado para gerar PDFs (V-12).
//
// - --no-sandbox / --disable-setuid-sandbox só em Linux (containers Docker,
//   Render), onde a sandbox do Chrome costuma não ter as permissões de
//   kernel necessárias. No Windows Server a sandbox fica ligada.
// - Os templates de PDF são HTML autocontido: logos em data: URI, gráficos
//   em SVG inline, sem <script>. Por isso a página roda com JavaScript
//   desligado e com toda requisição de rede bloqueada, exceto data: e
//   about:. Uma eventual falha de escape nos templates não vira SSRF nem
//   leitura de file://.

function argsChromium(plataforma = process.platform) {
  const args = [
    // Containers Docker (Render, etc.) costumam limitar /dev/shm a ~64MB —
    // sem essa flag o Chrome pode travar/matar a aba ao renderizar o PDF.
    "--disable-dev-shm-usage",
    "--disable-gpu",
  ];
  if (plataforma === "linux") args.unshift("--no-sandbox", "--disable-setuid-sandbox");
  return args;
}

function urlPermitida(url) {
  return typeof url === "string" && /^(data|about):/i.test(url);
}

async function prepararPaginaIsolada(pagina) {
  await pagina.setJavaScriptEnabled(false);
  await pagina.setRequestInterception(true);
  pagina.on("request", (requisicao) => {
    if (requisicao.isInterceptResolutionHandled?.()) return;
    if (urlPermitida(requisicao.url())) {
      requisicao.continue();
    } else {
      requisicao.abort("blockedbyclient");
    }
  });
}

module.exports = { argsChromium, urlPermitida, prepararPaginaIsolada };
