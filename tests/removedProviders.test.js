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

test("integrações desativadas não permanecem em código ou configuração operacional", () => {
  const arquivos = [
    ...ALVOS.flatMap((alvo) => arquivosAtivos(path.join(RAIZ, alvo))),
    path.join(RAIZ, ".env.example"),
    path.join(RAIZ, "render.yaml"),
  ].filter((arquivo) => arquivo !== __filename && fs.existsSync(arquivo));
  const proibidos = [
    /climatempo/i,
    /apiadvisor/i,
    /TETRATECH_(?:API_KEY|ACCESS_TOKEN|USERNAME|PASSWORD)/i,
    /ttforecast/i,
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

test("Open-Meteo usa endpoint público e pede indicadores de previsão", () => {
  const conteudo = fs.readFileSync(path.join(RAIZ, "src", "sources", "openMeteo.js"), "utf8");
  assert.match(conteudo, /uv_index/);
  assert.match(conteudo, /precipitation_probability/);
  assert.match(conteudo, /wind_gusts_10m/);
  assert.match(conteudo, /api\.open-meteo\.com\/v1\/forecast/);
  assert.match(conteudo, /MODELO_PRINCIPAL = "best_match"/);
  assert.match(conteudo, /MODELO_FALLBACK = "ncep_gfs_seamless"/);
  assert.doesNotMatch(conteudo, /customer-api|OPEN_METEO_API_KEY/);
});
