require("../src/security/certificados");
const { CIDADES } = require("../src/config/cities");
const { buscarOpenMeteo } = require("../src/sources/openMeteo");
const { buscarMar } = require("../src/sources/marine");
const { buscarRajadasTetraTech } = require("../src/sources/tetratechGusts");
const rajadaPortais = require("../src/config/rajadaPortais");

function fetchComEvidencia(estado) {
  return async (input, init) => {
    const resposta = await fetch(input, init);
    let json = null;
    try { json = await resposta.clone().json(); } catch {}
    const primeiro = Array.isArray(json) ? json[0] : json;
    const resumoBloco = (bloco) => {
      const dados = primeiro?.[bloco] || {};
      const unidades = primeiro?.[`${bloco}_units`] || {};
      return {
        campos: Object.keys(dados).filter((campo) => campo !== "time"),
        quantidadeHorarios: Array.isArray(dados.time) ? dados.time.length : null,
        unidades,
        nulosPorCampo: Object.fromEntries(Object.entries(dados)
          .filter(([campo, valores]) => campo !== "time" && Array.isArray(valores))
          .map(([campo, valores]) => [campo, valores.filter((valor) => valor == null).length])),
      };
    };
    estado.push({
      http: resposta.status,
      ok: resposta.ok,
      coordenadaRetornada: Number.isFinite(primeiro?.latitude) && Number.isFinite(primeiro?.longitude)
        ? { latitude: primeiro.latitude, longitude: primeiro.longitude }
        : null,
      fusoRetornado: primeiro?.timezone || null,
      hourly: resumoBloco("hourly"),
      daily: resumoBloco("daily"),
    });
    return resposta;
  };
}

async function validarBase(cidade) {
  const resultado = {
    base: cidade.nome,
    chave: cidade.chave,
    coordenadasSolicitadas: { latitude: cidade.latitude, longitude: cidade.longitude },
    fuso: cidade.fusoHorario || "America/Sao_Paulo",
    meteorologia: null,
    mar: "não se aplica",
    rajada: null,
  };
  try {
    const evidencia = [];
    const dados = await buscarOpenMeteo(cidade.latitude, cidade.longitude, {
      fuso: cidade.fusoHorario || "America/Sao_Paulo", diasPrevisao: 4, logger: null,
      fetchImpl: fetchComEvidencia(evidencia),
    });
    resultado.meteorologia = {
      status: "ok", uvMax: dados.uvMax, probabilidadeChuvaMax: dados.probabilidadeChuvaMax,
      tempMin: dados.tempMin, tempMax: dados.tempMax, umidadeMin: dados.umidadeMin,
      umidadeMax: dados.umidadeMax, ventoMedioManha: dados.periodos.manha.velocidadeMediaKmh,
      rajadaOpenMeteo: dados.rajadaMaxKmh, dataReferencia: dados.dataReferencia,
      datasPrevisao: dados.previsaoDias.map((dia) => dia.data), horaAtualModelo: dados.atual?.horario || null,
      respostaApi: evidencia[0] || null,
    };
  } catch (erro) {
    resultado.meteorologia = { status: "falha", codigo: erro.code || erro.name, mensagem: erro.message };
  }
  if (cidade.costeira) {
    try {
      const evidencia = [];
      const dados = await buscarMar(cidade.pontoMar.latitude, cidade.pontoMar.longitude, {
        fuso: cidade.fusoHorario || "America/Sao_Paulo", logger: null,
        fetchImpl: fetchComEvidencia(evidencia),
      });
      resultado.mar = { status: "ok", ponto: cidade.pontoMar, alturaMaxDiaM: dados.alturaMaxDiaM, periodosValidos: dados.periodos.filter((p) => Number.isFinite(p.alturaMaxM)).length, respostaApi: evidencia[0] || null };
    } catch (erro) {
      resultado.mar = { status: "falha", ponto: cidade.pontoMar, codigo: erro.code || erro.name, mensagem: erro.message };
    }
  }
  const portal = rajadaPortais[cidade.chave];
  if (!portal?.habilitado) {
    resultado.rajada = { status: "não configurada", motivo: portal?.motivo || "sem tabela" };
  } else {
    try {
      const dados = await buscarRajadasTetraTech(cidade.nome, portal, { usarCache: false, usarCachePersistente: false, logger: null });
      resultado.rajada = { status: "ok", area: dados.area, dias: dados.picosDiarios.length };
    } catch (erro) {
      resultado.rajada = { status: "falha", codigo: erro.code || erro.name, mensagem: erro.message };
    }
  }
  return resultado;
}

(async () => {
  const resultados = [];
  for (const cidade of Object.values(CIDADES)) resultados.push(await validarBase(cidade));
  const saida = process.argv.includes("--compact") ? resultados.map((r) => ({
    base: r.base,
    coordenadasSolicitadas: r.coordenadasSolicitadas,
    fuso: r.fuso,
    meteo: {
      status: r.meteorologia?.status,
      http: r.meteorologia?.respostaApi?.http,
      coordenadaRetornada: r.meteorologia?.respostaApi?.coordenadaRetornada,
      fusoRetornado: r.meteorologia?.respostaApi?.fusoRetornado,
      camposHourly: r.meteorologia?.respostaApi?.hourly?.campos,
      camposDaily: r.meteorologia?.respostaApi?.daily?.campos,
      datas: r.meteorologia?.datasPrevisao,
      horaModelo: r.meteorologia?.horaAtualModelo,
      temperaturaMinMax: [r.meteorologia?.tempMin, r.meteorologia?.tempMax],
      chuvaProbMax: [r.meteorologia?.probabilidadeChuvaMax],
      uvMax: r.meteorologia?.uvMax,
    },
    mar: r.mar === "não se aplica" ? r.mar : {
      status: r.mar?.status,
      http: r.mar?.respostaApi?.http,
      coordenadaRetornada: r.mar?.respostaApi?.coordenadaRetornada,
      alturaMaxDiaM: r.mar?.alturaMaxDiaM,
      camposHourly: r.mar?.respostaApi?.hourly?.campos,
      qtdHoras: r.mar?.respostaApi?.hourly?.quantidadeHorarios,
    },
    rajada: r.rajada?.status,
  })) : resultados;
  process.stdout.write(JSON.stringify({ validadoEm: new Date().toISOString(), resultados: saida }, null, 2) + "\n");
  if (resultados.some((r) => r.meteorologia.status !== "ok" || (r.mar !== "não se aplica" && r.mar.status !== "ok"))) process.exitCode = 1;
})().catch((erro) => {
  console.error(erro);
  process.exitCode = 1;
});
