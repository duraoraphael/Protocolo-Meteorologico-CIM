const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buscarPrevisaoInmet,
  buscarAvisosInmet,
  normalizarAviso,
  extrairAvisos,
  consolidarAvisosInmet,
  fenomenoAvisoInmet,
  grauAvisoInmet,
  INMET_TIMEOUT_MS,
  INMET_AVISOS_TIMEOUT_MS,
  INMET_TENTATIVAS,
} = require("../src/sources/inmet");

test("aviso INMET em formato CAP preserva os campos oficiais sem reescrever", () => {
  const aviso = normalizarAviso({
    event: "Tempestade",
    headline: "Aviso de tempestade",
    severity: "Moderate",
    description: "Chuva entre 20 e 30 mm/h ou até 50 mm/dia.",
    instruction: "Em caso de rajadas de vento, não se abrigue debaixo de árvores.",
    onset: "2026-09-29T09:25:00-03:00",
    expires: "2026-09-29T23:59:00-03:00",
    geocode: [{ valueName: "IBGE", value: "3303906" }],
  });

  assert.deepEqual(aviso, {
    id: null,
    idAviso: null,
    sequencia: null,
    encerrado: false,
    estados: null,
    totalMunicipios: null,
    atualizadoEm: null,
    descricao: "Tempestade",
    severidade: "Moderate",
    cor: null,
    inicio: "2026-09-29T09:25:00-03:00",
    fim: "2026-09-29T23:59:00-03:00",
    riscos: ["Chuva entre 20 e 30 mm/h ou até 50 mm/dia."],
    instrucoes: ["Em caso de rajadas de vento, não se abrigue debaixo de árvores."],
    geocodes: ["3303906"],
  });
});

test("aviso INMET legado continua aceito e ausências não viram texto inventado", () => {
  const aviso = normalizarAviso({
    descricao: "Baixa Umidade",
    severidade: "Perigo Potencial",
    inicio: "29/09/2026 10:00",
    fim: "29/09/2026 23:59",
    riscos: ["Umidade relativa do ar variando entre 30% e 20%."],
    geocodes: "3303906,3304557",
  });

  assert.equal(aviso.descricao, "Baixa Umidade");
  assert.equal(aviso.instrucoes.length, 0);
  assert.equal(aviso.riscos[0], "Umidade relativa do ar variando entre 30% e 20%.");
  assert.deepEqual(aviso.geocodes, ["3303906", "3304557"]);
});

test("geocode municipal é recuperado do campo municípios quando a lista dedicada não vem", () => {
  const aviso = normalizarAviso({
    descricao: "Chuvas Intensas",
    municipios: "Macaé - RJ (3302403),Manaus - AM (1302603)",
  });
  assert.deepEqual(aviso.geocodes, ["3302403", "1302603"]);
});

test("resposta nova organizada por dia é achatada sem usar metadados", () => {
  const primeiro = { event: "Chuva Intensa" };
  const segundo = { event: "Vento Forte" };
  assert.deepEqual(extrairAvisos({
    "2026-09-29": [primeiro],
    "2026-09-30": [segundo],
    atualizadoEm: "2026-09-29T10:00:00-03:00",
  }), [primeiro, segundo]);
});

test("avisos equivalentes são consolidados e preservam o mais grave", () => {
  const avisos = consolidarAvisosInmet([
    {
      descricao: "  TEMPESTADE  ", severidade: "Perigo Potencial",
      inicio: "30/09/2026 08:00", fim: "30/09/2026 18:00",
      riscos: ["Chuva intensa.", "Ventos fortes."],
      instrucoes: ["Busque abrigo."],
    },
    {
      descricao: "Tempestáde", severidade: "Perigo",
      inicio: "30/09/2026 09:00", fim: "30/09/2026 19:00",
      riscos: [" chuva   intensa. ", "Queda de granizo."],
      instrucoes: ["BUSQUE ABRIGO.", "Desligue aparelhos."],
    },
    {
      descricao: "Tempestade severa", severidade: "Grande Perigo",
      inicio: "30/09/2026 10:00", fim: "30/09/2026 20:00",
      riscos: ["Queda de granizo."], instrucoes: ["Desligue aparelhos."],
    },
    { descricao: "Baixa Umidade", severidade: "Perigo", riscos: ["Risco à saúde."] },
  ], { agora: new Date("2026-09-30T12:00:00-03:00") });

  assert.equal(avisos.length, 2, "fenômenos diferentes devem permanecer separados");
  const tempestade = avisos.find((aviso) => fenomenoAvisoInmet(aviso.descricao) === "tempestade");
  assert.equal(tempestade.severidade, "Grande Perigo");
  assert.deepEqual(tempestade.riscos, ["Chuva intensa.", "Ventos fortes.", "Queda de granizo."]);
  assert.deepEqual(tempestade.instrucoes, ["Busque abrigo.", "Desligue aparelhos."]);
  assert.equal(grauAvisoInmet(tempestade.severidade), "EMERGÊNCIA");
});

test("empate de severidade prioriza vigência, início recente e término distante", () => {
  const agora = new Date("2026-09-30T12:00:00-03:00");
  const [vigente] = consolidarAvisosInmet([
    { descricao: "Chuvas Intensas", severidade: "Perigo", inicio: "29/09/2026 08:00", fim: "29/09/2026 18:00", riscos: ["Expirado"] },
    { descricao: "chuva intensa", severidade: "PERIGO", inicio: "30/09/2026 09:00", fim: "30/09/2026 17:00", riscos: ["Vigente"] },
  ], { agora });
  assert.equal(vigente.inicio, "30/09/2026 09:00");

  const [maisRecente] = consolidarAvisosInmet([
    { descricao: "Vento Forte", severidade: "Perigo", inicio: "30/09/2026 08:00", fim: "30/09/2026 20:00" },
    { descricao: "ventos fortes", severidade: "Perigo", inicio: "30/09/2026 10:00", fim: "30/09/2026 18:00" },
  ], { agora });
  assert.equal(maisRecente.inicio, "30/09/2026 10:00");

  const [maisDistante] = consolidarAvisosInmet([
    { descricao: "Baixa Umidade", severidade: "Perigo", inicio: "30/09/2026 10:00", fim: "30/09/2026 18:00" },
    { descricao: "baixa   umidade", severidade: "Perigo", inicio: "30/09/2026 10:00", fim: "30/09/2026 21:00" },
  ], { agora });
  assert.equal(maisDistante.fim, "30/09/2026 21:00");
});

test("previsão INMET usa 15 segundos e recupera após falhas transitórias", async () => {
  const codigo = "3304557";
  const esperas = [];
  let chamadas = 0;
  const resultado = await buscarPrevisaoInmet(codigo, {
    fetchImpl: async (_url, opcoes) => {
      chamadas += 1;
      assert.equal(opcoes.headers["User-Agent"].includes("ProtocoloMeteorologicoCIM"), true);
      if (chamadas === 1) throw Object.assign(new Error("rede"), { name: "TypeError" });
      if (chamadas === 2) throw Object.assign(new Error("timeout"), { name: "TimeoutError" });
      return {
        ok: true,
        json: async () => ({
          [codigo]: {
            "01/01/2099": {
              manha: { resumo: "Nublado", temp_max: 28, temp_min: 20 },
              tarde: { resumo: "Chuva" },
              noite: { resumo: "Nublado" },
            },
          },
        }),
      };
    },
    esperarFn: async (ms) => { esperas.push(ms); },
  });

  assert.equal(INMET_TIMEOUT_MS, 15000);
  assert.equal(INMET_TENTATIVAS, 3);
  assert.equal(chamadas, 3);
  assert.deepEqual(esperas, [2000, 4000]);
  assert.equal(resultado.periodos.manha.resumo, "Nublado");
});

test("avisos INMET repetem falha temporária e filtram o município", async () => {
  const codigo = "3304557";
  const esperas = [];
  let chamadas = 0;
  const resultado = await buscarAvisosInmet(codigo, {
    fetchImpl: async () => {
      chamadas += 1;
      if (chamadas === 1) return { ok: false, status: 503 };
      return {
        ok: true,
        json: async () => ({
          hoje: [
            { event: "Tempestade", severity: "Severe", geocode: codigo },
            { event: "Baixa umidade", geocode: "5300108" },
          ],
        }),
      };
    },
    esperarFn: async (ms) => { esperas.push(ms); },
  });

  assert.equal(INMET_AVISOS_TIMEOUT_MS, 15000);
  assert.equal(chamadas, 2);
  assert.deepEqual(esperas, [1000]);
  assert.equal(resultado.totalAvisosPais, 2);
  assert.equal(resultado.avisos.length, 1);
  assert.equal(resultado.avisos[0].descricao, "Tempestade");
});

test("avisos são isolados por base e precisam intersectar a janela da edição", async () => {
  const payload = { hoje: [
    { descricao: "Chuva em Macaé", severidade: "Perigo", geocodes: "3302403", inicio: "2026-10-09 06:00", fim: "2026-10-09 14:00" },
    { descricao: "Vento em Manaus", severidade: "Perigo", geocodes: "1302603", inicio: "2026-10-09 06:00", fim: "2026-10-09 14:00" },
    { descricao: "Aviso futuro", severidade: "Perigo", geocodes: "3302403", inicio: "2026-10-09 16:00", fim: "2026-10-09 20:00" },
  ] };
  const opcoes = {
    agora: new Date("2026-10-09T08:00:00-03:00"),
    inicioPeriodo: new Date("2026-10-09T05:00:00-03:00"),
    fimPeriodo: new Date("2026-10-09T15:00:00-03:00"),
    fetchImpl: async () => ({ ok: true, json: async () => payload }),
  };
  const macae = await buscarAvisosInmet("3302403", opcoes);
  const manaus = await buscarAvisosInmet("1302603", opcoes);
  assert.deepEqual(macae.avisos.map((aviso) => aviso.descricao), ["Chuva em Macaé"]);
  assert.deepEqual(manaus.avisos.map((aviso) => aviso.descricao), ["Vento em Manaus"]);
});

test("INMET não repete erro HTTP permanente", async () => {
  for (const consultar of [buscarPrevisaoInmet, buscarAvisosInmet]) {
    let chamadas = 0;
    await assert.rejects(
      consultar("3304557", {
        fetchImpl: async () => {
          chamadas += 1;
          return { ok: false, status: 400 };
        },
        esperarFn: async () => {},
      }),
      /HTTP 400/
    );
    assert.equal(chamadas, 1);
  }
});
