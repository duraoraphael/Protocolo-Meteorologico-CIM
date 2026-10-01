// V-12: sandbox do Chromium e bloqueio de rede na geração de PDF.
const test = require("node:test");
const assert = require("node:assert/strict");
const { argsChromium, urlPermitida, prepararPaginaIsolada } = require("../src/render/chromiumSeguro");

test("--no-sandbox só em Linux", () => {
  assert.ok(argsChromium("linux").includes("--no-sandbox"));
  for (const p of ["win32", "darwin"]) {
    const args = argsChromium(p);
    assert.ok(!args.includes("--no-sandbox") && !args.includes("--disable-setuid-sandbox"), p);
    assert.ok(args.includes("--disable-dev-shm-usage"));
  }
});

test("só data: e about: são permitidos", () => {
  for (const u of ["data:image/png;base64,AAAA", "about:blank", "DATA:text/plain,x"]) assert.equal(urlPermitida(u), true, u);
  for (const u of ["http://169.254.169.254/", "https://exemplo.com/x.png", "file:///C:/Windows/win.ini", "ftp://x", "javascript:alert(1)", "", null]) {
    assert.equal(urlPermitida(u), false, String(u));
  }
});

test("prepararPaginaIsolada desliga JS, intercepta e aborta requisições externas", async () => {
  const chamadas = [];
  let ouvinte;
  const pagina = {
    setJavaScriptEnabled: async (v) => chamadas.push(["js", v]),
    setRequestInterception: async (v) => chamadas.push(["intercept", v]),
    on: (evento, fn) => { assert.equal(evento, "request"); ouvinte = fn; },
  };
  await prepararPaginaIsolada(pagina);
  assert.deepEqual(chamadas, [["js", false], ["intercept", true]]);
  const req = (url) => {
    const r = { url: () => url, resultado: null };
    r.continue = () => { r.resultado = "continue"; };
    r.abort = () => { r.resultado = "abort"; };
    ouvinte(r);
    return r.resultado;
  };
  assert.equal(req("data:image/svg+xml,<svg/>"), "continue");
  assert.equal(req("about:blank"), "continue");
  assert.equal(req("https://exemplo.com/logo.png"), "abort");
  assert.equal(req("file:///etc/passwd"), "abort");
});
