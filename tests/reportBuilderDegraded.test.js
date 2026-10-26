const test = require("node:test");
const { normalizarResposta: normalizarRespostaOceanop } = require("../src/sources/oceanop");
const assert = require("node:assert/strict");
const { getCidade } = require("../src/config/cities");
const { montarRelatorio } = require("../src/logic/reportBuilder");
const { comConteudoEmail } = require("../src/logic/conteudoEmailPainel");
const { renderEmailHtml } = require("../src/render/emailTemplate");
const { renderPdfHtml } = require("../src/render/pdfTemplate");
const { carregarPainel } = require("./helpers/fakeDom");

const falha = (nome) => Object.assign(new Error(`${nome} indisponível`), {
  code: "TEST_SOURCE_UNAVAILABLE",
  tipo: "network",
  transitorio: false,
});

test("mesmo snapshot mantém condição INMET e distingue UV atual do pico previsto", async () => {
  const agora = new Date("2026-10-25T13:10:00Z");
  const relatorio = await montarRelatorio(getCidade("brasilia"), { dependencias: {
    agora: () => agora,
    buscarPrevisaoInmet: async () => ({ data: "25/10/2026", periodos: { manha: { resumo: "Muitas nuvens" } }, dias: [] }),
    buscarAvisosInmet: async () => ({ avisos: [] }),
    buscarObservacaoInmet: async () => ({ status: "operacional", observacao: {
      status: "operacional", desatualizado: false, medidoEm: "2026-10-25T13:00:00Z",
      temperaturaAtualC: 25, umidadeAtualPct: 64, estacao: { codigo: "A001", nome: "Brasília" },
    }, agregado: null }),
    buscarOpenMeteo: async () => ({ condicaoGeral: "Ensolarado", uvMax: 10.2,
      uvClassificacao: { nivel: "Muito alto" }, horaPicoUv: "2026-10-25T12:00", periodos: {} }),
    buscarOceanopPorCoordenadas: async () => { throw falha("OCEANOP"); },
    buscarQualidadeAr: async () => ({ usAqi: 88, classificacao: { nivel: "MODERADO" },
      uvAtual: 2.4, uvClassificacao: { nivel: "BAIXO" }, fonteUv: "Open-Meteo Air Quality — UV atual modelado",
      fonte: "Open-Meteo — estimativa modelada de qualidade do ar",
      referenciaEm: "2026-10-25T13:00:00Z", consultadoEm: agora.toISOString() }),
    lerClimaSaudeArmazenado: () => ({ status: "indisponivel", dados: null }),
  } });
  assert.equal(relatorio.condicaoGeral, "Muitas nuvens");
  assert.equal(relatorio.fontesPorCampo.condicaoGeral, "INMET — previsão oficial");
  assert.equal(relatorio.atual.temperaturaC, 25);
  assert.equal(relatorio.atual.umidadePct, 64);
  assert.equal(relatorio.indiceUv.valorAtual, 2.4);
  assert.equal(relatorio.indiceUv.maximoPrevisto, 10.2);
  assert.equal(relatorio.indiceUv.classificacao, "BAIXO");
  assert.equal(relatorio.indicadoresSnapshot.indiceUv.valor, 2.4);
  assert.equal(relatorio.indicadoresSnapshot.indiceUv.referenciaEm, "2026-10-25T13:00:00Z");
  assert.equal(relatorio.indicadoresSnapshot.condicaoGeral.fonte, "INMET — previsão oficial");
});

test("primeira carga do painel permanece disponível quando todas as fontes falham", async () => {
  const indisponivel = async () => { throw falha("Fonte"); };
  const relatorio = await montarRelatorio(getCidade("brasilia"), {
    dependencias: {
      buscarPrevisaoInmet: indisponivel,
      buscarAvisosInmet: indisponivel,
      buscarOpenMeteo: async () => { throw falha("Open-Meteo"); },
      buscarQualidadeAr: async () => { throw falha("Open-Meteo Air Quality"); },
      buscarOceanopPorCoordenadas: async () => { throw falha("OCEANOP"); },
      buscarObservacaoInmet: async () => ({
        status: "indisponivel",
        mensagem: "INMET — Observação indisponível.",
        observacao: null,
        agregado: null,
        erro: falha("INMET — Observação"),
      }),
      lerClimaSaudeArmazenado: () => ({
        status: "indisponivel",
        mensagem: "Clima e Saúde indisponível.",
        dados: null,
      }),
    },
  });

  assert.equal(relatorio.cidade.chave, "brasilia");
  assert.match(relatorio.snapshotId, /^brasilia:\d{4}-\d{2}-\d{2}T/);
  assert.equal(relatorio.condicaoGeral, "Condição indisponível");
  assert.equal(relatorio.tempMax, null);
  assert.equal(relatorio.fontesPorCampo.tempMax, "Informação indisponível");
  assert.ok(relatorio.avisosColeta.some((aviso) => /modo degradado/i.test(aviso)));
  assert.ok(relatorio.monitoramentoApis.every((api) => api.status !== "operacional"));
  assert.equal(relatorio.monitoramentoApis.find((api) => api.id === "open-meteo-air")?.status, "indisponivel");
  assert.equal(relatorio.monitoramentoApis.find((api) => api.id === "open-meteo")?.status, "indisponivel");
  assert.equal(relatorio.indicadoresSnapshot.rajadaPrevista.valor, null);
  assert.equal(relatorio.indicadoresSnapshot.rajadaPrevista.fonte, "Open-Meteo — previsão meteorológica");
  assert.equal(relatorio.indicadoresSnapshot.rajadaPrevista.statusValidacao, "indisponivel");
  assert.equal(relatorio.indicadoresSnapshot.probabilidadeChuva.fonte, "Open-Meteo — previsão meteorológica");
  assert.equal(relatorio.indicadoresSnapshot.temperaturaObservada.fonte, "INMET — estação automática");
  assert.ok(Object.values(relatorio.indicadoresSnapshot).every((item) => item.cicloId === relatorio.snapshotId && item.consultadoEm === relatorio.geradoEmISO));
});

test("snapshot mantém condição, temperatura e umidade indisponíveis e identifica rajada modelada", async () => {
  const agora = new Date("2026-10-25T13:30:00Z");
  const indisponivel = async () => { throw falha("Fonte"); };
  const relatorio = await montarRelatorio(getCidade("brasilia"), { dependencias: {
    agora: () => agora,
    buscarPrevisaoInmet: indisponivel,
    buscarAvisosInmet: async () => ({ avisos: [] }),
    buscarObservacaoInmet: async () => ({ status: "indisponivel", observacao: null, agregado: null }),
    buscarOpenMeteo: async () => ({ dataReferencia: "2026-10-25", fuso: "America/Sao_Paulo",
      tempMin: 19, tempMax: 29, umidadeMin: 40, umidadeMax: 80, condicaoGeral: "Nublado a encoberto",
      rajadaMaxKmh: 45.4, rajadaPrevistaEm: "2026-10-25T12:00", rajadaPeriodo: "05h–12h",
      atual: { temperaturaC: 27, umidadePct: 62, horario: "2026-10-25T13:00:00Z", previsao: true },
      periodos: { manha: { rajadaMaxKmh: 45.4, rajadaPrevistaEm: "2026-10-25T12:00", janela: "05h–12h" } },
    }),
    buscarQualidadeAr: indisponivel,
    buscarOceanopPorCoordenadas: indisponivel,
    lerClimaSaudeArmazenado: () => ({ status: "indisponivel", dados: null }),
  } });
  assert.deepEqual([relatorio.tempMin, relatorio.tempMax, relatorio.umidadeMin, relatorio.umidadeMax], [null, null, null, null]);
  assert.equal(relatorio.fontesPorCampo.condicaoGeral, "Informação indisponível");
  assert.equal(relatorio.rajadaPrevistaKmh, 45.4);
  assert.equal(relatorio.indicadoresSnapshot.rajadaPrevista.fonte, "Open-Meteo — previsão meteorológica");
  assert.equal(relatorio.indicadoresSnapshot.condicaoGeral.referenciaEm, null);
  assert.equal(relatorio.indicadoresSnapshot.temperaturaAtual.statusValidacao, "indisponivel");
  assert.equal(relatorio.indicadoresSnapshot.temperaturaObservada.valor, null);
  const mesmoCiclo = comConteudoEmail(relatorio);
  const painel = carregarPainel().executar("Dashboard.home")(mesmoCiclo);
  const pdf = renderPdfHtml(mesmoCiclo);
  const email = renderEmailHtml(mesmoCiclo);
  assert.match(painel, /45\.4/);
  assert.doesNotMatch(painel, /Máxima prevista no período|Previsão para o dia/);
  assert.doesNotMatch(painel, /Máxima prevista pela Open-Meteo/);
  assert.match(pdf, /45 km\/h/);
  assert.match(email, /45 km\/h/);
  assert.ok([pdf, email].every((html) => html.includes(relatorio.snapshotId)));
});

test("OCEANOP indisponível mantém a rajada em Open-Meteo/indisponível e registra a falha", async () => {
  let chamadas = 0;
  const indisponivel = async () => { throw falha("Fonte"); };
  const relatorio = await montarRelatorio(getCidade("brasilia"), {
    dependencias: {
      agora: () => new Date("2026-10-25T11:00:00Z"),
      buscarPrevisaoInmet: indisponivel,
      buscarAvisosInmet: indisponivel,
      buscarObservacaoInmet: async () => ({ status: "indisponivel", observacao: null, agregado: null }),
      buscarOpenMeteo: indisponivel,
      buscarQualidadeAr: indisponivel,
      buscarOceanopPorCoordenadas: async () => { chamadas++; throw falha("OCEANOP"); },
      lerClimaSaudeArmazenado: () => ({ status: "indisponivel", dados: null }),
    },
  });
  assert.equal(chamadas, 1);
  assert.equal(relatorio.rajadaPrevistaKmh, null);
  assert.equal(relatorio.monitoramentoApis.find((api) => api.id === "oceanop").status, "indisponivel");
  assert.equal(relatorio.indicadoresSnapshot.rajadaPrevista.valor, null);
});

test("OCEANOP disponível fornece a rajada prioritária do relatório", async () => {
  const indisponivel = async () => { throw falha("Fonte"); };
  const registro = (hora) => ({
    PointID: "brasilia", Local: "Brasília", DataInicial: `25/10/2026 ${hora}:00:00`, DataFinal: `25/10/2026 ${hora}:59:59`,
    DirecaoVento: "90", VelocidadeVento: "5", VelocidadeVento_10M_Rajada: "10", DataEscrita: "25/10/2026 04:00:00",
  });
  const relatorio = await montarRelatorio(getCidade("brasilia"), {
    dependencias: {
      agora: () => new Date("2026-10-25T11:00:00Z"),
      buscarPrevisaoInmet: indisponivel,
      buscarAvisosInmet: indisponivel,
      buscarObservacaoInmet: async () => ({ status: "indisponivel", observacao: null, agregado: null }),
      buscarOpenMeteo: indisponivel,
      buscarQualidadeAr: indisponivel,
      buscarOceanopPorCoordenadas: async (ponto) => ({
        consultadoEm: "2026-10-25T11:00:00Z",
        previsoes: normalizarRespostaOceanop({ success: true, data: [registro("14")] }, { fusoHorario: ponto.fusoHorario }),
      }),
      lerClimaSaudeArmazenado: () => ({ status: "indisponivel", dados: null }),
    },
  });
  assert.equal(relatorio.rajadaPrevistaKmh, 18.5); // 10 nós × 1,852
  assert.equal(relatorio.fontesPorCampo.rajadaMaxKmh, "Petrobras — OCEANOP");
  assert.equal(relatorio.indicadoresSnapshot.rajadaPrevista.fonte, "Petrobras — OCEANOP");
  assert.equal(relatorio.monitoramentoApis.find((api) => api.id === "oceanop").status, "operacional");
});

test("sem Air Quality o UV atual vem da previsão Open-Meteo, identificado como modelado", async () => {
  const falhaFonte = async () => { throw falha("Fonte"); };
  const relatorio = await montarRelatorio(getCidade("brasilia"), { dependencias: {
    agora: () => new Date("2026-10-25T13:30:00Z"),
    buscarPrevisaoInmet: falhaFonte, buscarAvisosInmet: falhaFonte, buscarOceanopPorCoordenadas: falhaFonte,
    buscarObservacaoInmet: async () => ({ status: "indisponivel", observacao: null, agregado: null }),
    buscarOpenMeteo: async () => ({ uvMax: 10.2, uvAtual: 4.3, uvAtualReferenciaEm: "2026-10-25T13:30:00Z",
      horaPicoUv: "2026-10-25T12:00", periodos: {} }),
    buscarQualidadeAr: falhaFonte,
    lerClimaSaudeArmazenado: () => ({ status: "indisponivel", dados: null }),
  } });
  assert.equal(relatorio.indiceUv.status, "operacional");
  assert.equal(relatorio.indiceUv.valorAtual, 4.3);
  assert.equal(relatorio.indiceUv.classificacao, "Moderado");
  assert.match(relatorio.indiceUv.fonte, /Open-Meteo.*modelado/);
  assert.equal(relatorio.indiceUv.maximoPrevisto, 10.2);
});

test("OCEANOP: períodos cobrem o dia inteiro e o total do card usa a janela da edição", async () => {
  const indisponivel = async () => { throw falha("Fonte"); };
  const registro = (hora, rajada) => ({
    PointID: "brasilia", Local: "Brasília", DataInicial: `25/10/2026 ${hora}:00:00`, DataFinal: `25/10/2026 ${hora}:59:59`,
    DirecaoVento: "90", VelocidadeVento: "5", VelocidadeVento_10M_Rajada: rajada, DataEscrita: "25/10/2026 04:00:00",
  });
  const relatorio = await montarRelatorio(getCidade("brasilia"), {
    horarioAgendado: "08:00",
    dependencias: {
      agora: () => new Date("2026-10-25T11:00:00Z"), // 08h em Brasília
      buscarPrevisaoInmet: indisponivel, buscarAvisosInmet: indisponivel, buscarOpenMeteo: indisponivel, buscarQualidadeAr: indisponivel,
      buscarObservacaoInmet: async () => ({ status: "indisponivel", observacao: null, agregado: null }),
      // Datas em UTC: 17h UTC = 14h local (janela 08–15h); 23h UTC = 20h local (noite, fora da janela).
      buscarOceanopPorCoordenadas: async (ponto) => ({ consultadoEm: "2026-10-25T11:00:00Z",
        previsoes: normalizarRespostaOceanop({ success: true, data: [registro("17", "10"), registro("23", "20")] }, { fusoHorario: ponto.fusoDados }) }),
      lerClimaSaudeArmazenado: () => ({ status: "indisponivel", dados: null }),
    },
  });
  assert.equal(relatorio.rajadaPrevistaKmh, 18.5); // 10 nós, só a janela 08–15h
  assert.equal(relatorio.ventoPorPeriodo.find((p) => p.periodo === "Noite").rajadaMaxKmh, 37);
  assert.equal(relatorio.ventoPorPeriodo.find((p) => p.periodo === "Noite").fonteRajada, "Petrobras — OCEANOP");
});
