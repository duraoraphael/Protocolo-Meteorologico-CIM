// V-06 (e-mails só com senha) e V-07 (PDFs só com senha ou link temporário).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { subirApp, SENHA_TESTE } = require("./helpers/servidor");
const { criarLinksRelatorio } = require("../src/security/linksRelatorio");

const PDF = "Informativo_Meteorologico_TESTE_2026-01-01.pdf";

function pastaComPdf() {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), "cim-pdf-"));
  fs.writeFileSync(path.join(pasta, PDF), "%PDF-1.4\n% teste\n");
  return pasta;
}

const basic = (senha) => ({ Authorization: "Basic " + Buffer.from(`cim:${senha}`).toString("base64") });

test("GET /api/responsaveis sem senha devolve só nomes", async (t) => {
  const srv = await subirApp();
  t.after(srv.fechar);
  for (const url of ["/api/responsaveis", "/api/responsaveis?cidade=rio_de_janeiro"]) {
    const r = await fetch(srv.base + url);
    const dados = await r.json();
    assert.equal(r.status, 200);
    for (const base of dados.bases) {
      for (const resp of base.responsaveis) assert.deepEqual(Object.keys(resp), ["nome"], url);
    }
    assert.doesNotMatch(JSON.stringify(dados), /@/, url);
  }
});

test("POST /api/responsaveis/consultar exige a senha", async (t) => {
  const srv = await subirApp();
  t.after(srv.fechar);
  const semSenha = await fetch(srv.base + "/api/responsaveis/consultar", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cidade: "rio_de_janeiro" }),
  });
  assert.equal(semSenha.status, 401);
  const comSenha = await fetch(srv.base + "/api/responsaveis/consultar", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ senha: SENHA_TESTE, cidade: "rio_de_janeiro" }),
  });
  assert.equal(comSenha.status, 200);
  const dados = await comSenha.json();
  assert.equal(dados.ok, true);
  assert.equal(dados.bases[0].chave, "rio_de_janeiro");
});

test("PDF: 401 sem credencial; 200 com senha (Basic) ou token válido", async (t) => {
  const srv = await subirApp({ pastaRelatorios: pastaComPdf() });
  t.after(srv.fechar);
  const url = `${srv.base}/relatorios/${PDF}`;

  let r = await fetch(url);
  assert.equal(r.status, 401);
  assert.match(r.headers.get("www-authenticate") || "", /^Basic /);
  await r.arrayBuffer();

  r = await fetch(url, { headers: basic("senha-errada-123456") });
  assert.equal(r.status, 401);
  await r.arrayBuffer();

  r = await fetch(url, { headers: basic(SENHA_TESTE) });
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type"), /application\/pdf/);
  assert.match(r.headers.get("cache-control"), /no-store/);
  await r.arrayBuffer();

  const { token } = srv.app.locals.linksRelatorio.gerar(PDF);
  r = await fetch(`${url}?token=${token}`);
  assert.equal(r.status, 200);
  await r.arrayBuffer();

  const outro = srv.app.locals.linksRelatorio.gerar("Outro.pdf").token;
  r = await fetch(`${url}?token=${outro}`);
  assert.equal(r.status, 401, "token de outro arquivo não vale");
  await r.arrayBuffer();

  r = await fetch(`${url}?token=${"A".repeat(43)}`);
  assert.equal(r.status, 401);
  await r.arrayBuffer();
});

test("PDF: nomes inválidos e path traversal → 404", async (t) => {
  const srv = await subirApp({ pastaRelatorios: pastaComPdf() });
  t.after(srv.fechar);
  for (const p of ["..%2F.env", "..%2Fserver.js", ".env", "x.PDF.exe", "%2e%2e%2fpackage.json", "arquivo.txt"]) {
    const r = await fetch(`${srv.base}/relatorios/${p}`, { headers: basic(SENHA_TESTE) });
    assert.equal(r.status, 404, p);
    await r.arrayBuffer();
  }
  const r = await fetch(`${srv.base}/relatorios/Nao_Existe.pdf`, { headers: basic(SENHA_TESTE) });
  assert.equal(r.status, 404);
  assert.deepEqual(await r.json(), { ok: false, erro: "Não encontrado." });
});

test("token expira em 24 h e o mapa de tokens tem limite", () => {
  let agora = 1_000_000;
  const links = criarLinksRelatorio({ agora: () => agora, maxTokens: 3 });
  const { token } = links.gerar("a.pdf");
  assert.equal(links.valido(token, "a.pdf"), true);
  agora += 24 * 60 * 60 * 1000 - 1;
  assert.equal(links.valido(token, "a.pdf"), true);
  agora += 1;
  assert.equal(links.valido(token, "a.pdf"), false);
  for (let i = 0; i < 10; i++) links.gerar(`${i}.pdf`);
  assert.ok(links.tamanho <= 3);
});
