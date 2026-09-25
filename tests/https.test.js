// V-03 / V-14: configuração de HTTPS, HOST e redirecionamento HTTP -> HTTPS.
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { opcoesDeRede, redirecionarParaHttps, carregarPfx } = require("../src/security/https");

test("sem variáveis: HTTP em todas as interfaces (padrão atual)", () => {
  assert.deepEqual(opcoesDeRede({}), { modo: "http", host: undefined });
  assert.equal(opcoesDeRede({ HOST: "127.0.0.1" }).host, "127.0.0.1");
});

test("HTTPS só com HTTPS_PFX_PATH e HTTPS_PFX_SENHA juntas", () => {
  assert.equal(opcoesDeRede({ HTTPS_PFX_PATH: "c.pfx" }).modo, "erro");
  assert.equal(opcoesDeRede({ HTTPS_PFX_SENHA: "x" }).modo, "erro");
  const o = opcoesDeRede({ HTTPS_PFX_PATH: "c.pfx", HTTPS_PFX_SENHA: "x" });
  assert.equal(o.modo, "https");
  assert.equal(o.portaHttps, 3443);
  assert.equal(opcoesDeRede({ HTTPS_PFX_PATH: "c.pfx", HTTPS_PFX_SENHA: "x", HTTPS_PORTA: "abc" }).modo, "erro");
});

test("erro ao ler o .pfx não expõe a senha", () => {
  const r = carregarPfx("/caminho/que/nao/existe.pfx");
  assert.match(r.erro, /ENOENT/);
});

test("HTTP responde 308 para a mesma URL em HTTPS e valida o Host", async (t) => {
  const srv = http.createServer(redirecionarParaHttps(3443));
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  t.after(() => new Promise((r) => srv.close(r)));
  const porta = srv.address().port;
  const pedir = (caminho, host) => new Promise((resolve, reject) => {
    http.get({ host: "127.0.0.1", port: porta, path: caminho, headers: { Host: host } }, (res) => {
      res.resume();
      resolve(res);
    }).on("error", reject);
  });
  let r = await pedir("/api/cidades?x=1", "painel.petrobras.com.br:3210");
  assert.equal(r.statusCode, 308);
  assert.equal(r.headers.location, "https://painel.petrobras.com.br:3443/api/cidades?x=1");
  r = await pedir("/", "evil.com/x");
  assert.equal(r.statusCode, 400);
  r = await pedir("//evil.com/", "painel:3210");
  assert.equal(r.headers.location, "https://painel:3443/");
});
