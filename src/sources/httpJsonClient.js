const API_TIMEOUT_MS = 15000;
const API_TENTATIVAS = 3;
const API_ATRASO_BASE_MS = 2000;
const API_ATRASOS_MS = Object.freeze([2000, 4000]);

const CODIGOS_TRANSITORIOS = new Set([
  "EAI_AGAIN",
  "ECONNRESET",
  "ETIMEDOUT",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_SOCKET",
]);

function esperar(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function statusTransitorio(status) {
  return status === 408 || status === 425 || status === 429 || [502, 503, 504].includes(status);
}

function codigoOriginal(erro) {
  return erro?.code || erro?.cause?.code || erro?.cause?.cause?.code || null;
}

function tipoErro(erro) {
  const codigo = codigoOriginal(erro);
  if (erro?.httpStatus) return "http";
  if (erro?.name === "EmptyResponseError") return "empty_response";
  if (erro?.name === "InvalidJsonError") return "invalid_json";
  if (erro?.name === "ParserError") return "parser";
  if (erro?.name === "TimeoutError" || erro?.name === "AbortError" ||
      ["ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT"].includes(codigo)) {
    return "timeout";
  }
  if (["ENOTFOUND", "EAI_AGAIN"].includes(codigo)) return "dns";
  if (codigo === "ECONNREFUSED") return "connection_refused";
  if (["ECONNRESET", "UND_ERR_SOCKET"].includes(codigo)) return "connection_reset";
  if (/CERT|TLS|SSL|VERIFY|SELF_SIGNED|UNABLE_TO_VERIFY/i.test(codigo || "")) return "tls";
  if (erro?.name === "TypeError") return "network";
  return "unknown";
}

function erroTransitorio(erro) {
  if (erro?.transitorio === true) return true;
  if (erro?.httpStatus) return statusTransitorio(erro.httpStatus);
  if (["TimeoutError", "AbortError", "InvalidJsonError", "EmptyResponseError"].includes(erro?.name)) return true;
  const codigo = codigoOriginal(erro);
  if (CODIGOS_TRANSITORIOS.has(codigo)) return true;
  return erro?.name === "TypeError" && !codigo;
}

function criarErro(mensagem, propriedades = {}, causa) {
  const erro = new Error(mensagem, causa ? { cause: causa } : undefined);
  Object.assign(erro, propriedades);
  return erro;
}

function erroNormalizado(erro, nomeFonte, timeoutMs) {
  if (erro?.normalizado) return erro;
  const tipo = tipoErro(erro);
  const codigoRecebido = codigoOriginal(erro);
  const codigo = (typeof codigoRecebido === "string" ? codigoRecebido : null) ||
    ({ timeout: "ETIMEDOUT", invalid_json: "INVALID_JSON", empty_response: "EMPTY_RESPONSE" }[tipo] ?? null);
  const mensagens = {
    timeout: `${nomeFonte}: tempo de resposta esgotado (${timeoutMs / 1000}s)`,
    dns: `${nomeFonte}: falha de resolução DNS${codigo ? ` (${codigo})` : ""}`,
    connection_refused: `${nomeFonte}: conexão recusada${codigo ? ` (${codigo})` : ""}`,
    connection_reset: `${nomeFonte}: conexão interrompida${codigo ? ` (${codigo})` : ""}`,
    tls: `${nomeFonte}: falha na validação TLS${codigo ? ` (${codigo})` : ""}`,
    invalid_json: `${nomeFonte}: resposta JSON inválida ou incompleta`,
    empty_response: `${nomeFonte}: resposta vazia`,
    parser: `${nomeFonte}: falha ao interpretar a resposta`,
    network: `${nomeFonte}: falha de conexão`,
  };
  return criarErro(mensagens[tipo] || erro?.message || `${nomeFonte}: falha desconhecida`, {
    name: "ExternalSourceError",
    tipo,
    code: codigo,
    httpStatus: erro?.httpStatus ?? null,
    transitorio: erroTransitorio(erro),
    normalizado: true,
  }, erro);
}

function urlSegura(valor) {
  try {
    const url = new URL(valor);
    for (const chave of url.searchParams.keys()) {
      if (/key|token|senha|password|secret|authorization/i.test(chave)) url.searchParams.set(chave, "[redacted]");
    }
    url.username = "";
    url.password = "";
    return url.toString();
  } catch {
    return "URL inválida";
  }
}

function escreverLog(logger, nivel, ...argumentos) {
  if (!logger) return;
  const funcao = typeof logger[nivel] === "function"
    ? logger[nivel].bind(logger)
    : typeof logger === "function" ? logger : null;
  funcao?.(...argumentos);
}

function registrarErro(logger, prefixo, erro, tentativa, tempoMs) {
  const causa = erro?.cause;
  escreverLog(logger, "error", `[${prefixo}][ERRO]`, {
    type: erro?.tipo || tipoErro(erro),
    code: erro?.code || codigoOriginal(erro),
    httpStatus: erro?.httpStatus ?? null,
    message: erro?.message,
    cause: causa ? { name: causa.name, code: codigoOriginal(causa), message: causa.message } : null,
    tentativa,
    tempoMs,
    stack: erro?.stack,
  });
}

function atrasoDaTentativa(indice, atrasoBaseMs) {
  if (atrasoBaseMs !== API_ATRASO_BASE_MS) return atrasoBaseMs * (indice + 1);
  return API_ATRASOS_MS[indice] ?? API_ATRASOS_MS.at(-1);
}

async function lerJson(resposta) {
  if (typeof resposta.text === "function") {
    const texto = await resposta.text();
    if (!texto.trim()) {
      const erro = new Error("Resposta vazia");
      erro.name = "EmptyResponseError";
      throw erro;
    }
    try {
      return JSON.parse(texto);
    } catch (causa) {
      const erro = new Error("Resposta JSON inválida ou incompleta", { cause: causa });
      erro.name = "InvalidJsonError";
      throw erro;
    }
  }
  try {
    const json = await resposta.json();
    if (json === undefined || json === null) {
      const erro = new Error("Resposta vazia");
      erro.name = "EmptyResponseError";
      throw erro;
    }
    return json;
  } catch (causa) {
    if (["EmptyResponseError", "InvalidJsonError"].includes(causa?.name)) throw causa;
    if (causa?.name !== "SyntaxError") throw causa;
    const erro = new Error("Resposta JSON inválida ou incompleta", { cause: causa });
    erro.name = "InvalidJsonError";
    throw erro;
  }
}

/**
 * Cliente JSON comum para fontes meteorológicas externas.
 * Repete somente falhas recuperáveis. HTTP 401/403/404 falha imediatamente.
 */
async function buscarJsonComRetentativa(url, {
  nomeFonte,
  fetchImpl = fetch,
  timeoutMs = API_TIMEOUT_MS,
  tentativas = API_TENTATIVAS,
  atrasoBaseMs = API_ATRASO_BASE_MS,
  esperarFn = esperar,
  requestInit = {},
  logger = null,
  prefixoLog = nomeFonte,
  onDiagnostic,
} = {}) {
  let ultimoErro;
  const urlLog = urlSegura(url);

  for (let tentativa = 0; tentativa < tentativas; tentativa++) {
    const numeroTentativa = tentativa + 1;
    const inicio = Date.now();
    escreverLog(logger, "log", `[${prefixoLog}]`, { url: urlLog, tentativa: `${numeroTentativa}/${tentativas}` });
    try {
      const resposta = await fetchImpl(url, {
        ...requestInit,
        signal: AbortSignal.timeout(timeoutMs),
      });
      const tempoMs = Date.now() - inicio;
      escreverLog(logger, "log", `[${prefixoLog}]`, {
        tentativa: `${numeroTentativa}/${tentativas}`,
        http: resposta.status,
        tempoMs,
      });

      if (!resposta.ok) {
        throw criarErro(`${nomeFonte} respondeu HTTP ${resposta.status}`, {
          name: "HttpSourceError",
          tipo: "http",
          code: `HTTP_${resposta.status}`,
          httpStatus: resposta.status,
          transitorio: statusTransitorio(resposta.status),
          normalizado: true,
        });
      }

      const json = await lerJson(resposta);
      onDiagnostic?.({ status: "success", tentativa: numeroTentativa, httpStatus: resposta.status, tempoMs });
      return json;
    } catch (erroOriginal) {
      const tempoMs = Date.now() - inicio;
      const erro = erroNormalizado(erroOriginal, nomeFonte, timeoutMs);
      ultimoErro = erro;
      onDiagnostic?.({
        status: "error",
        tentativa: numeroTentativa,
        httpStatus: erro.httpStatus,
        tempoMs,
        errorCode: erro.code,
        errorType: erro.tipo,
      });
      registrarErro(logger, prefixoLog, erro, `${numeroTentativa}/${tentativas}`, tempoMs);
      if (!erro.transitorio || numeroTentativa >= tentativas) break;
      await esperarFn(atrasoDaTentativa(tentativa, atrasoBaseMs));
    }
  }

  const tentativasFeitas = ultimoErro?.transitorio === false ? 1 : tentativas;
  throw criarErro(
    `${ultimoErro?.message || `${nomeFonte} indisponível`} após ${tentativasFeitas} tentativas`,
    {
      name: "ExternalSourceError",
      tipo: ultimoErro?.tipo || "unknown",
      code: ultimoErro?.code || null,
      httpStatus: ultimoErro?.httpStatus ?? null,
      transitorio: ultimoErro?.transitorio === true,
      tentativas: tentativasFeitas,
    },
    ultimoErro
  );
}

module.exports = {
  API_TIMEOUT_MS,
  API_TENTATIVAS,
  API_ATRASO_BASE_MS,
  API_ATRASOS_MS,
  buscarJsonComRetentativa,
  erroNormalizado,
  erroTransitorio,
  statusTransitorio,
  tipoErro,
  codigoOriginal,
};
