// Monitor de vigilância: detecta agravamento do tempo FORA do horário do
// informativo diário e avisa só quando aparece algo novo.
//
// Por que existe: o informativo das 07:30 é uma fotografia. Se um aviso de
// tempestade do INMET surgir às 14h, ninguém é notificado — o painel mostra,
// mas só enxerga quem estiver olhando para a TV. Este monitor cobre
// exatamente o item do protocolo original sobre "variações meteorológicas
// extremas que possam acontecer no dia em que não estava previsto".
//
// Duas regras guiam o desenho, ambas para não virar spam (alerta que é
// ignorado não protege ninguém):
//
// 1. SÓ O QUE É GRAVE. Chuva moderada e vento de 45 km/h são assunto do
//    informativo diário, não de um e-mail fora de hora. Aqui entram apenas
//    condições que mudam decisão operacional na hora.
//
// 2. SÓ O QUE É NOVO. Cada alerta tem uma "assinatura"; o que já foi avisado
//    fica registrado em data/alertas-notificados.json e não é repetido. Se a
//    severidade AUMENTAR (atenção -> perigo), aí sim avisa de novo.

const fs = require("fs");
const path = require("path");
const { CIDADES, getCidade } = require("../config/cities");
const { montarRelatorio } = require("./reportBuilder");
const { LIMIARES } = require("./riskEngine");

const ARQUIVO_ESTADO = path.join(__dirname, "..", "..", "data", "alertas-notificados.json");

// Um alerta notificado deixa de ser considerado "já avisado" depois disso,
// para que um evento que persista por muitas horas volte a ser lembrado.
const VALIDADE_HORAS = 12;

// ---------------------------------------------------------------------------
// Estado (o que já foi avisado)
// ---------------------------------------------------------------------------

function carregarEstado() {
  try {
    const dados = JSON.parse(fs.readFileSync(ARQUIVO_ESTADO, "utf-8"));
    return dados && typeof dados === "object" ? dados : {};
  } catch (erro) {
    if (erro.code === "ENOENT") return {};
    console.warn(`[CIM] Estado de alertas ilegível (${erro.message}); recomeçando do zero.`);
    return {};
  }
}

function salvarEstado(estado) {
  fs.mkdirSync(path.dirname(ARQUIVO_ESTADO), { recursive: true });
  fs.writeFileSync(ARQUIVO_ESTADO, JSON.stringify(estado, null, 2), "utf-8");
}

function limparExpirados(estado) {
  const limite = Date.now() - VALIDADE_HORAS * 3600 * 1000;
  for (const [chave, registro] of Object.entries(estado)) {
    if (!registro?.emISO || new Date(registro.emISO).getTime() < limite) {
      delete estado[chave];
    }
  }
  return estado;
}

// ---------------------------------------------------------------------------
// Detecção
// ---------------------------------------------------------------------------

// Peso usado para decidir se um alerta "piorou" em relação ao já notificado.
const GRAVIDADE = { alto: 2, severo: 3 };

function normalizarTexto(t) {
  return (t || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Extrai de um relatório apenas as condições graves o bastante para
 * interromper alguém fora do horário do informativo.
 */
function detectarAlertasGraves(report) {
  const achados = [];

  // 1. Avisos oficiais do INMET. São a fonte mais forte: já vêm classificados
  // por autoridade competente. "Potencial" fica de fora — é previsão de
  // possibilidade, não de evento em curso.
  for (const aviso of report.avisosInmet || []) {
    const sev = normalizarTexto(aviso.severidade);
    const ehGrandePerigo = sev.includes("grande perigo");
    const ehPerigo = sev.includes("perigo") && !sev.includes("potencial");
    if (!ehGrandePerigo && !ehPerigo) continue;

    achados.push({
      origem: "INMET",
      tipo: aviso.descricao || "Aviso meteorológico",
      gravidade: ehGrandePerigo ? "severo" : "alto",
      severidadeTexto: aviso.severidade,
      detalhe: (aviso.riscos || [])[0] || "",
      janela: `${aviso.inicio} até ${aviso.fim}`,
      // A assinatura ignora acentuação/caixa para que o mesmo aviso reemitido
      // com grafia levemente diferente não vire alerta novo.
      assinatura: `inmet:${normalizarTexto(aviso.descricao)}:${aviso.inicio}`,
    });
  }

  // 2. Tempestade com raios detectada na previsão horária.
  if (report.eventoMaisRelevante?.tipo === "raios") {
    achados.push({
      origem: "Previsão",
      tipo: "Tempestade com raios",
      gravidade: "severo",
      detalhe: report.eventoMaisRelevante.descricao,
      janela: report.eventoMaisRelevante.janela,
      assinatura: "raios",
    });
  }

  // 3. Limiares numéricos severos. Usam os mesmos valores do motor diário,
  // então monitor e informativo nunca se contradizem.
  const rajada = Math.max(
    ...(report.ventoPorPeriodo || []).map((p) => p.rajadaMaxKmh ?? 0),
    0
  );
  if (rajada >= LIMIARES.ventoForteKmh) {
    achados.push({
      origem: "Previsão",
      tipo: "Vento forte",
      gravidade: "alto",
      detalhe: `Rajadas de até ${rajada} km/h previstas`,
      janela: "próximas horas",
      // Faixas de 10 km/h: sem isso, uma variação de 61 para 62 km/h geraria
      // um alerta novo a cada verificação.
      assinatura: `vento:${Math.floor(rajada / 10) * 10}`,
    });
  }

  const chuva = report.chuvaPorPeriodo || [];
  const acumulado = chuva.reduce((s, p) => s + (p.precipitacaoMm || 0), 0);
  if (acumulado >= LIMIARES.chuvaIntensaMm) {
    achados.push({
      origem: "Previsão",
      tipo: "Chuva intensa",
      gravidade: "alto",
      detalhe: `Acumulado previsto de ${Math.round(acumulado * 10) / 10} mm`,
      janela: "restante do dia",
      assinatura: `chuva:${Math.floor(acumulado / 10) * 10}`,
    });
  }

  if (report.mar?.alturaMaxDiaM != null && report.mar.alturaMaxDiaM >= LIMIARES.marGrossoM) {
    achados.push({
      origem: "Previsão",
      tipo: "Mar grosso",
      gravidade: "alto",
      detalhe: `Ondas de até ${report.mar.alturaMaxDiaM} m (${report.mar.estadoMarDia})`,
      janela: "próximas horas",
      assinatura: `mar:${Math.floor(report.mar.alturaMaxDiaM * 2) / 2}`,
    });
  }

  if (report.tempMax != null && report.tempMax >= LIMIARES.calorExtremoC) {
    achados.push({
      origem: "Previsão",
      tipo: "Calor extremo",
      gravidade: "alto",
      detalhe: `Máxima prevista de ${report.tempMax}°C`,
      janela: "tarde",
      assinatura: `calor:${report.tempMax}`,
    });
  }

  if (report.qualidadeAr?.uvMax != null && report.qualidadeAr.uvMax >= LIMIARES.uvExtremo) {
    achados.push({
      origem: "Previsão",
      tipo: "Índice UV extremo",
      gravidade: "alto",
      detalhe: `Índice UV de ${report.qualidadeAr.uvMax}`,
      janela: report.qualidadeAr.horaPicoUv ? `pico ~${report.qualidadeAr.horaPicoUv}` : "meio do dia",
      assinatura: `uv:${Math.floor(report.qualidadeAr.uvMax)}`,
    });
  }

  return achados;
}

/**
 * Filtra o que ainda não foi avisado (ou piorou desde o último aviso).
 */
function filtrarNovidades(chaveBase, achados, estado) {
  const novos = [];
  for (const a of achados) {
    const chave = `${chaveBase}|${a.assinatura}`;
    const jaAvisado = estado[chave];

    if (!jaAvisado) {
      novos.push({ ...a, chaveEstado: chave, motivo: "novo" });
      continue;
    }

    // Reavisar quando o evento se agrava (ex.: passou de Perigo para Grande
    // Perigo) — não avisar de novo quando apenas persiste igual.
    const antes = GRAVIDADE[jaAvisado.gravidade] ?? 0;
    const agora = GRAVIDADE[a.gravidade] ?? 0;
    if (agora > antes) {
      novos.push({ ...a, chaveEstado: chave, motivo: "agravou" });
    }
  }
  return novos;
}

// ---------------------------------------------------------------------------
// Verificação
// ---------------------------------------------------------------------------

function basesMonitoradas() {
  const restricao = process.env.BASES_MONITOR_ALERTAS;
  if (!restricao) return Object.keys(CIDADES);
  return restricao
    .split(",")
    .map((c) => c.trim())
    .filter((chave) => {
      if (!CIDADES[chave]) {
        console.warn(`[CIM] BASES_MONITOR_ALERTAS cita base desconhecida "${chave}" — ignorada.`);
        return false;
      }
      return true;
    });
}

/**
 * Verifica todas as bases monitoradas e devolve os alertas novos.
 *
 * @param {object} opcoes
 * @param {boolean} [opcoes.registrar=true] grava os alertas como "já
 *   avisados". Use false para simular sem afetar o estado.
 * @returns {Promise<{porBase: Array, totalNovos: number, falhas: Array}>}
 */
async function verificarAlertas({ registrar = true } = {}) {
  const estado = limparExpirados(carregarEstado());
  const porBase = [];
  const falhas = [];

  for (const chave of basesMonitoradas()) {
    const cidade = getCidade(chave);
    try {
      const report = await montarRelatorio(cidade);
      const graves = detectarAlertasGraves(report);
      const novos = filtrarNovidades(chave, graves, estado);

      if (novos.length) {
        porBase.push({ chave, cidade, report, alertas: novos });
        if (registrar) {
          const emISO = new Date().toISOString();
          for (const a of novos) {
            estado[a.chaveEstado] = { gravidade: a.gravidade, tipo: a.tipo, emISO };
          }
        }
      }
    } catch (erro) {
      falhas.push({ chave, nome: cidade.nome, erro: erro.message });
    }
  }

  if (registrar) salvarEstado(estado);

  return {
    porBase,
    totalNovos: porBase.reduce((s, b) => s + b.alertas.length, 0),
    falhas,
    verificadoEm: new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }),
  };
}

module.exports = {
  verificarAlertas,
  detectarAlertasGraves,
  carregarEstado,
  salvarEstado,
  ARQUIVO_ESTADO,
};
