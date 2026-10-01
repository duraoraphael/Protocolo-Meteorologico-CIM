// V-08: cabeçalhos de segurança e ausência de X-Powered-By.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { subirApp } = require("./helpers/servidor");
const { cabecalhosSeguranca, origensFrameAncestors } = require("../src/security/cabecalhos");

test("/, /api/cidades e estáticos trazem CSP, nosniff, XFO e Referrer-Policy", async (t) => {
  const srv = await subirApp({ frameAncestors: undefined });
  t.after(srv.fechar);
  for (const url of ["/", "/api/cidades", "/dashboard.js", "/logo/CIM.png", "/rota-inexistente"]) {
    const r = await fetch(srv.base + url);
    await r.arrayBuffer();
    const csp = r.headers.get("content-security-policy") || "";
    for (const diretiva of ["default-src 'self'", "img-src 'self' data:", "frame-ancestors 'none'", "object-src 'none'"]) {
      assert.ok(csp.includes(diretiva), `${url}: falta ${diretiva} em "${csp}"`);
    }
    assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval|\*/, url);
    assert.equal(r.headers.get("x-content-type-options"), "nosniff", url);
    assert.equal(r.headers.get("x-frame-options"), "DENY", url);
    assert.equal(r.headers.get("referrer-policy"), "no-referrer", url);
    assert.equal(r.headers.get("x-powered-by"), null, url);
    assert.equal(r.headers.get("strict-transport-security"), null, `${url}: HSTS só em HTTPS`);
  }
});

test("HSTS só é enviado quando a requisição é HTTPS", () => {
  const mw = cabecalhosSeguranca({ frameAncestors: "" });
  const cab = {};
  const res = { setHeader: (k, v) => { cab[k.toLowerCase()] = v; } };
  mw({ secure: true }, res, () => {});
  assert.equal(cab["strict-transport-security"], "max-age=31536000");
});

test("FRAME_ANCESTORS só aceita origens https válidas", () => {
  assert.deepEqual(origensFrameAncestors("https://a.streamlit.app, https://b.exemplo.com:8443"),
    ["https://a.streamlit.app", "https://b.exemplo.com:8443"]);
  for (const v of ["*", "http://x.com", "https://x.com/caminho", "'unsafe-inline'", "https://x.com;script-src *"]) {
    assert.throws(() => origensFrameAncestors(v), undefined, v);
  }
});

test("páginas do painel não usam script/estilo inline nem recursos externos", () => {
  const pub = path.join(__dirname, "..", "public");
  for (const arquivo of fs.readdirSync(pub).filter((f) => /\.(html|js|css)$/.test(f))) {
    const conteudo = fs.readFileSync(path.join(pub, arquivo), "utf-8");
    if (arquivo.endsWith(".html")) {
      assert.doesNotMatch(conteudo, /<script(?![^>]*\bsrc=)[^>]*>/i, `${arquivo}: <script> inline`);
      assert.doesNotMatch(conteudo, /<style[\s>]/i, `${arquivo}: <style> inline`);
      assert.doesNotMatch(conteudo, /\son[a-z]+\s*=/i, `${arquivo}: handler inline`);
      assert.doesNotMatch(conteudo, /(src|href)="(https?:)?\/\//i, `${arquivo}: recurso externo`);
    }
    assert.doesNotMatch(conteudo, /style\s*=\s*["'`]/i, `${arquivo}: atributo style inline`);
    if (arquivo.endsWith(".css")) assert.doesNotMatch(conteudo, /@import|url\(\s*["']?(https?:)?\/\//i, `${arquivo}: fonte/estilo externo`);
  }
});
