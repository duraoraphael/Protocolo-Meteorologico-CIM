const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const RAIZ = path.resolve(__dirname, "..");
const ALVOS = ["src", "scripts", "public"];
const EXTENSOES = new Set([".js", ".json", ".html", ".css"]);

function arquivosAtivos(diretorio) {
  return fs.readdirSync(diretorio, { withFileTypes: true }).flatMap((entrada) => {
    const absoluto = path.join(diretorio, entrada.name);
    if (entrada.isDirectory()) return arquivosAtivos(absoluto);
    return EXTENSOES.has(path.extname(entrada.name)) ? [absoluto] : [];
  });
}

test("Climatempo removido não permanece no código ativo nem na configuração", () => {
  const arquivos = [
    ...ALVOS.flatMap((alvo) => arquivosAtivos(path.join(RAIZ, alvo))),
    path.join(RAIZ, ".env.example"),
    path.join(RAIZ, "render.yaml"),
    path.join(RAIZ, "RAJADAS_PORTAIS.md"),
    path.join(RAIZ, "RESPOSTAS_SI.md"),
  ].filter((arquivo) => arquivo !== __filename);
  const proibidos = [
    /climatempo/i,
    /apiadvisor/i,
  ];
  const ocorrencias = [];
  for (const arquivo of arquivos) {
    const conteudo = fs.readFileSync(arquivo, "utf8");
    for (const padrao of proibidos) {
      if (padrao.test(conteudo)) ocorrencias.push(`${path.relative(RAIZ, arquivo)}: ${padrao}`);
    }
  }
  assert.deepEqual(ocorrencias, []);
});

test("Open-Meteo consulta a série própria de rajada prevista", () => {
  const conteudo = fs.readFileSync(path.join(RAIZ, "src", "sources", "openMeteo.js"), "utf8");
  assert.match(conteudo, /uv_index/);
  assert.match(conteudo, /precipitation_probability/);
  assert.match(conteudo, /wind_gusts_10m/);
});
