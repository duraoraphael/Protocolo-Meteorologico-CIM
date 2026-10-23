const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const pasta = fs.mkdtempSync(path.join(os.tmpdir(), "cim-responsaveis-"));
const arquivo = path.join(pasta, "responsaveis.json");
process.env.RESPONSAVEIS_ARQUIVO = arquivo;

fs.writeFileSync(arquivo, JSON.stringify({
  rio_de_janeiro: [{ nome: "Maria", email: "maria@exemplo.com" }],
  macae: [{ nome: "Maria", email: "maria@exemplo.com" }],
  cabiunas: [{ nome: "Histórico", email: "historico@exemplo.com" }],
}));

const { subirApp, SENHA_TESTE } = require("./helpers/servidor");

const pedir = (base, metodo, corpo) => fetch(base + "/api/responsaveis", {
  method: metodo,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ senha: SENHA_TESTE, ...corpo }),
});

test("cadastra a pessoa uma vez e depois vincula uma ou várias bases", async (t) => {
  const srv = await subirApp();
  t.after(async () => {
    await srv.fechar();
    fs.rmSync(pasta, { recursive: true, force: true });
  });

  let r = await fetch(srv.base + "/api/responsaveis/consultar", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ senha: SENHA_TESTE }),
  });
  let dados = await r.json();
  assert.equal(dados.responsaveis.length, 2, "migração preserva contato histórico sem expor a base desativada");
  assert.deepEqual(dados.responsaveis[0].bases, ["rio_de_janeiro", "macae"]);
  assert.ok(dados.basesDisponiveis.length > 2);
  assert.deepEqual(
    dados.basesDisponiveis.find((base) => base.chave === "cor_rio"),
    { chave: "cor_rio", nome: "COR-RIO", uf: "RJ", tipo: "aviso_cor_rio" }
  );

  r = await pedir(srv.base, "POST", { nome: "João Operação", email: "joao@exemplo.com" });
  assert.equal(r.status, 200);
  dados = await r.json();
  assert.deepEqual(dados.responsavel.bases, []);

  r = await pedir(srv.base, "PUT", { email: "joao@exemplo.com", bases: ["cabiunas", "santos"] });
  assert.equal(r.status, 400);
  r = await pedir(srv.base, "PUT", { email: "joao@exemplo.com", bases: ["santos"] });
  assert.equal(r.status, 200);

  r = await pedir(srv.base, "PUT", { email: "joao@exemplo.com", bases: ["cor_rio"] });
  assert.equal(r.status, 200);
  dados = await r.json();
  assert.deepEqual(dados.responsavel.bases, ["cor_rio"], "COR-RIO pode ser o único vínculo");

  r = await fetch(srv.base + "/api/responsaveis?cidade=cor_rio");
  dados = await r.json();
  assert.deepEqual(dados.bases[0].responsaveis, [{ nome: "João Operação" }]);

  r = await pedir(srv.base, "PUT", { email: "joao@exemplo.com", bases: ["santos", "cor_rio"] });
  assert.equal(r.status, 200);

  r = await fetch(srv.base + "/api/responsaveis?cidade=cabiunas");
  assert.equal(r.status, 400);
  dados = JSON.parse(fs.readFileSync(arquivo, "utf8"));
  assert.ok(dados.responsaveis.some((p) => p.email === "historico@exemplo.com" && p.bases.includes("cabiunas")));

  r = await pedir(srv.base, "DELETE", { email: "joao@exemplo.com" });
  assert.equal(r.status, 200);
  dados = JSON.parse(fs.readFileSync(arquivo, "utf8"));
  assert.equal(dados.versao, 2);
  assert.equal(dados.responsaveis.some((p) => p.email === "joao@exemplo.com"), false);
});
