// Diagnóstico técnico dos endpoints públicos. Não alimenta cache, painel,
// PDF ou e-mail operacional e nunca usa a chave comercial da instalação.
const fs = require("node:fs");
const path = require("node:path");
const { CIDADES } = require("../src/config/cities");
const { criarUrlPublicaOpenMeteo, normalizarRespostaOpenMeteo } = require("../src/sources/openMeteo");
const { criarUrlPublicaQualidadeAr, validarAtual } = require("../src/sources/airQuality");
const { buscarJsonComRetentativa } = require("../src/sources/httpJsonClient");

async function consultar(url, nomeFonte) {
  let http = null;
  const json = await buscarJsonComRetentativa(url, {
    nomeFonte, timeoutMs: 15000, tentativas: 2, atrasoBaseMs: 1000,
    fetchImpl: async (input, init) => {
      const resposta = await fetch(input, init);
      http = resposta.status;
      return resposta;
    },
  });
  return { json, http };
}

function diaLocal(now, fuso) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: fuso, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
}

function valorValido(valor, minimo, maximo) {
  return Number.isFinite(valor) && valor >= minimo && valor <= maximo ? valor : null;
}

async function auditarCidade(cidade) {
  const now = new Date();
  const base = { chave: cidade.chave, localidade: `${cidade.nome}/${cidade.uf}`,
    coordenadasSolicitadas: { latitude: cidade.latitude, longitude: cidade.longitude },
    fusoCadastrado: cidade.fusoHorario || "America/Sao_Paulo", consultadoEm: now.toISOString() };
  const urlTempo = new URL(criarUrlPublicaOpenMeteo(cidade.latitude, cidade.longitude, {
    diasPrevisao: 4, fuso: "auto",
  }));
  const urlAr = new URL(criarUrlPublicaQualidadeAr(cidade));
  for (const [campo, url, nome] of [["meteorologia", urlTempo, "Open-Meteo Weather público"],
    ["qualidadeAr", urlAr, "Open-Meteo Air Quality público"]]) {
    try {
      const { json, http } = await consultar(url.toString(), nome);
      const evidencia = { status: "VALIDADO", endpoint: url.origin + url.pathname, http,
        fuso: json.timezone, coordenadasGrade: { latitude: json.latitude, longitude: json.longitude } };
      if (campo === "meteorologia") {
        const normalizado = normalizarRespostaOpenMeteo(json, cidade.latitude, cidade.longitude,
          { now, fuso: json.timezone, url: url.toString() });
        const data = diaLocal(now, json.timezone);
        const indice = json.daily.time.indexOf(data);
        if (indice < 0) throw new Error(`Dia local ${data} ausente de daily.time`);
        const chuvaDia = valorValido(json.daily.precipitation_sum[indice], 0, 10000);
        const prob = valorValido(json.daily.precipitation_probability_max[indice], 0, 100);
        const uvMax = valorValido(json.daily.uv_index_max[indice], 0, 30);
        const rajadas = Object.fromEntries(["manha", "tarde", "noite"].map((chave) => [chave,
          normalizado.periodos[chave].rajadaMaxKmh]));
        const periodos = Object.fromEntries(["manha", "tarde", "noite"].map((chave) => {
          const periodo = normalizado.periodosDiaCompleto[chave];
          return [chave, { janelaLocal: periodo.janela, cobertura: periodo.cobertura,
            coberturaChuva: periodo.coberturaChuva,
            ventoMedioKmh: periodo.velocidadeMediaKmh,
            acumuladoPrevistoMm: periodo.precipitacaoMm,
            probabilidadeMaxPct: periodo.probabilidadeChuva,
            rajadaPrevistaKmh: periodo.rajadaMaxKmh,
            horarioReferencia: periodo.referenciaEm,
            status: [periodo.velocidadeMediaKmh, periodo.precipitacaoMm, periodo.probabilidadeChuva]
              .every(Number.isFinite) ? "VALIDADO" : "FALHA" }];
        }));
        Object.assign(evidencia, {
          dataLocal: data, horarioModelo: json.current?.time || null,
          temperaturaPrevistaModeloC: [normalizado.tempMin, normalizado.tempMax],
          umidadePrevistaModeloPct: [normalizado.umidadeMin, normalizado.umidadeMax],
          condicaoModelo: normalizado.condicaoGeral,
          atualModelado: { temperaturaC: normalizado.atual?.temperaturaC,
            umidadePct: normalizado.atual?.umidadePct, referenciaEm: normalizado.atual?.horario },
          precipitacaoDiaCivilPrevistaMm: chuvaDia,
          probabilidadeMaxDiaPct: prob, uvMaxDiaPrevisto: uvMax,
          precipitacaoEstimadaDecorridaMm: normalizado.precipitacaoAcumuladaEstimadaMm,
          rajadaMaxJanela05a00Kmh: Object.values(normalizado.periodosDiaCompleto)
            .map((periodo) => periodo.rajadaMaxKmh).filter(Number.isFinite)
            .reduce((maior, valor) => maior === null ? valor : Math.max(maior, valor), null),
          rajadaMaxRestanteKmh: normalizado.rajadaRestanteMaxKmh,
          rajadaPicoRestanteEm: normalizado.rajadaRestantePrevistaEm,
          rajadasPorPeriodoKmh: rajadas,
          periodos,
          janelaEstimativa: normalizado.precipitacaoAcumuladaEstimadaJanela,
          coberturaEstimativa: normalizado.precipitacaoAcumuladaEstimadaCobertura,
          motivoEstimativaIndisponivel: normalizado.precipitacaoAcumuladaEstimadaMotivo,
          unidades: { chuva: json.daily_units?.precipitation_sum, probabilidade: json.daily_units?.precipitation_probability_max,
            uv: json.daily_units?.uv_index_max },
        });
        if ([chuvaDia, prob, uvMax].some((v) => v === null)) evidencia.status = "FALHA";
      } else {
        const atual = validarAtual(json, { now, cidade });
        Object.assign(evidencia, {
          horarioModelo: json.current?.time || null, referenciaEm: atual.referenciaEm,
          usAqi: atual.usAqi, classificacaoAqi: atual.classificacao?.nivel || null,
          uvAtual: atual.uvAtual, classificacaoUv: atual.uvClassificacao?.nivel || null,
          pm25: atual.pm25Medio, pm10: atual.pm10Medio,
          distanciaGradeKm: atual.distanciaGradeKm,
          unidades: json.current_units || null,
        });
        if (atual.usAqi === null || atual.uvAtual === null) evidencia.status = "FALHA";
      }
      base[campo] = evidencia;
    } catch (erro) {
      base[campo] = { status: "FALHA", endpoint: url.origin + url.pathname,
        http: erro.httpStatus || null, codigo: erro.code || erro.name, motivo: erro.message };
    }
  }
  return base;
}

async function main() {
  const cidades = Object.values(CIDADES);
  const resultados = [];
  for (let i = 0; i < cidades.length; i += 3) {
    resultados.push(...await Promise.all(cidades.slice(i, i + 3).map(auditarCidade)));
  }
  const saida = { executadoEm: new Date().toISOString(), finalidade: "teste técnico sem uso operacional",
    resultados };
  const destino = path.join(__dirname, "..", "tmp", "auditoria-open-meteo-publico.json");
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  fs.writeFileSync(destino, JSON.stringify(saida, null, 2) + "\n");
  console.log(JSON.stringify(saida, null, 2));
  if (resultados.some((r) => r.meteorologia.status !== "VALIDADO" || r.qualidadeAr.status !== "VALIDADO")) process.exitCode = 1;
}

if (require.main === module) main().catch((erro) => { console.error(erro); process.exitCode = 1; });
module.exports = { auditarCidade };
