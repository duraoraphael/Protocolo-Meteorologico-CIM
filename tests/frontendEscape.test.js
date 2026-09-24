// V-01: o painel não pode inserir nome/e-mail/mensagens do servidor como HTML.
const test = require("node:test");
const assert = require("node:assert/strict");
const { carregarPainel } = require("./helpers/fakeDom");

const NOME_XSS = "<img src=x onerror=alert(document.domain)>";
const EMAIL_XSS = '"><svg/onload=alert(1)>@x.co';

const semHtmlAtivo = (html) => {
  assert.ok(!/<(img|svg)/i.test(html), `HTML ativo encontrado: ${html}`);
  assert.ok(!html.includes(NOME_XSS) && !html.includes(EMAIL_XSS), `payload cru encontrado: ${html}`);
};

test("Dashboard.escape neutraliza os 5 caracteres especiais", () => {
  const painel = carregarPainel();
  const esc = painel.executar("Dashboard.escape");
  assert.equal(esc(`<a href="x" title='y'>&</a>`), "&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;");
});

test("chips de destinatários escapam nome e e-mail", () => {
  const painel = carregarPainel();
  painel.contexto.renderListaDestinatariosPainel([{ nome: NOME_XSS, email: EMAIL_XSS }]);
  const html = painel.elemento("lista-destinatarios-painel").innerHTML;
  semHtmlAtivo(html);
  assert.match(html, /&lt;img src=x onerror=alert\(document\.domain\)&gt;/);
});

test("mensagem de erro do servidor é escapada", async () => {
  const painel = carregarPainel({
    responder: (url) => (url.startsWith("/api/responsaveis") ? { ok: false, erro: NOME_XSS } : {}),
  });
  painel.executar('cidadeAtivaChave = "rio_de_janeiro";');
  await painel.contexto.carregarDestinatariosPainel();
  const html = painel.elemento("lista-destinatarios-painel").innerHTML;
  semHtmlAtivo(html);
  assert.match(html, /Erro ao carregar: &lt;img/);
});
