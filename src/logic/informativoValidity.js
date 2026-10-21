const FUSO_INFORMATIVOS = "America/Sao_Paulo";

const EDICOES_INFORMATIVO = Object.freeze({
  "05:00": Object.freeze({
    codigo: "05h",
    papel: "inicial",
    inicioHora: 5,
    fimPrevisaoHora: 24,
    previsaoAte: "00h",
    periodo: "hoje, das 05h até 00h do dia seguinte",
    validadeFimDia: 1,
    validadeFimHora: 0,
  }),
  "08:00": Object.freeze({
    codigo: "08h",
    papel: "inicial",
    inicioHora: 8,
    fimPrevisaoHora: 24,
    previsaoAte: "00h",
    periodo: "hoje, das 08h até 00h do dia seguinte",
    validadeFimDia: 0,
    validadeFimHora: 15,
  }),
  "09:00": Object.freeze({
    codigo: "09h",
    papel: "atualizacao",
    inicioHora: 9,
    fimPrevisaoHora: 24,
    previsaoAte: "00h",
    periodo: "hoje, das 09h até 00h do dia seguinte",
    validadeFimDia: 1,
    validadeFimHora: 5,
  }),
  "12:00": Object.freeze({
    codigo: "12h",
    papel: "atualizacao",
    inicioHora: 12,
    fimPrevisaoHora: 24,
    previsaoAte: "00h",
    periodo: "hoje, das 12h até 00h do dia seguinte",
    validadeFimDia: 1,
    validadeFimHora: 5,
  }),
  "15:00": Object.freeze({
    codigo: "15h",
    papel: "atualizacao",
    inicioHora: 15,
    fimPrevisaoHora: 24,
    previsaoAte: "00h",
    periodo: "hoje, das 15h até 00h do dia seguinte",
    validadeFimDia: 1,
    validadeFimHora: 8,
  }),
  "17:00": Object.freeze({
    codigo: "17h",
    papel: "atualizacao",
    inicioHora: 17,
    fimPrevisaoHora: 24,
    previsaoAte: "00h",
    periodo: "hoje, das 17h até 00h do dia seguinte",
    validadeFimDia: 1,
    validadeFimHora: 5,
  }),
  "20:00": Object.freeze({
    codigo: "20h",
    papel: "atualizacao",
    inicioHora: 20,
    fimPrevisaoHora: 24,
    previsaoAte: "00h",
    periodo: "hoje, das 20h até 00h do dia seguinte",
    validadeFimDia: 1,
    validadeFimHora: 5,
  }),
});

// Únicas edições automáticas regulares autorizadas para o CIM.
const HORARIOS_INFORMATIVO = Object.freeze(["08:00", "15:00"]);
const HORARIO_EDICAO_INICIAL = "08:00";

/**
 * Lista de horários a partir de texto "HH:MM,HH:MM" (ex.: variável de
 * ambiente). Vazio = todas as edições. Horário desconhecido gera erro, para
 * não agendar silenciosamente uma edição sem regras definidas.
 */
function horariosConfigurados(valor, padrao = HORARIOS_INFORMATIVO) {
  const texto = String(valor ?? "").trim();
  if (!texto) return [...padrao];
  const lista = [...new Set(texto.split(",").map((h) => h.trim()).filter(Boolean))];
  const invalido = lista.find((h) => !HORARIOS_INFORMATIVO.includes(h));
  if (invalido) throw new Error(`Horário automático de informativo inválido: "${invalido}". Use somente: ${HORARIOS_INFORMATIVO.join(", ")}.`);
  return lista.sort();
}

function partesNoFuso(instante, fuso = FUSO_INFORMATIVOS) {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: fuso,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(instante));
  return Object.fromEntries(
    partes.filter((parte) => parte.type !== "literal").map((parte) => [parte.type, Number(parte.value)])
  );
}

// Converte uma data/hora civil de um fuso IANA em instante UTC sem depender
// do fuso do servidor. A segunda passagem cobre mudanças históricas de offset.
function instanteNoFuso({ year, month, day, hour = 0, minute = 0, second = 0 }, fuso = FUSO_INFORMATIVOS) {
  const desejadoUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  let tentativa = desejadoUtc;
  for (let i = 0; i < 2; i += 1) {
    const local = partesNoFuso(tentativa, fuso);
    const localComoUtc = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second);
    tentativa += desejadoUtc - localComoUtc;
  }
  return new Date(tentativa);
}

function adicionarDias({ year, month, day }, dias) {
  const data = new Date(Date.UTC(year, month - 1, day + dias));
  return { year: data.getUTCFullYear(), month: data.getUTCMonth() + 1, day: data.getUTCDate() };
}

function edicaoInformativo(horarioAgendado) {
  return EDICOES_INFORMATIVO[horarioAgendado] || null;
}

function intervaloAvisos(horarioAgendado, instante = new Date()) {
  const edicao = edicaoInformativo(horarioAgendado);
  if (!edicao) return { inicioPeriodo: instante, fimPeriodo: null };
  const dia = partesNoFuso(instante);
  const inicioPeriodo = instanteNoFuso({ ...dia, hour: edicao.inicioHora, minute: 0, second: 0 });
  const fimDia = edicao.fimPrevisaoHora === 24 ? adicionarDias(dia, 1) : dia;
  const fimPeriodo = instanteNoFuso({
    ...fimDia,
    hour: edicao.fimPrevisaoHora === 24 ? 0 : edicao.fimPrevisaoHora,
    minute: 0,
    second: 0,
  });
  return { inicioPeriodo, fimPeriodo };
}

function validadeInformativo(horarioAgendado, instante = new Date()) {
  const edicao = edicaoInformativo(horarioAgendado);
  if (!edicao) return null;
  const dia = partesNoFuso(instante);
  const fimDia = adicionarDias(dia, edicao.validadeFimDia);
  return Object.freeze({
    codigo: edicao.codigo,
    papel: edicao.papel,
    fusoHorario: FUSO_INFORMATIVOS,
    validoDeISO: instanteNoFuso({ ...dia, hour: edicao.inicioHora, minute: 0, second: 0 }).toISOString(),
    validoAteISO: instanteNoFuso({ ...fimDia, hour: edicao.validadeFimHora, minute: 0, second: 0 }).toISOString(),
  });
}

function informativoVigente(validade, instante = new Date()) {
  if (!validade) return false;
  const agora = new Date(instante).getTime();
  const inicio = Date.parse(validade.validoDeISO);
  const fim = Date.parse(validade.validoAteISO);
  return Number.isFinite(agora) && Number.isFinite(inicio) && Number.isFinite(fim) && agora >= inicio && agora < fim;
}

module.exports = {
  FUSO_INFORMATIVOS,
  EDICOES_INFORMATIVO,
  HORARIOS_INFORMATIVO,
  HORARIO_EDICAO_INICIAL,
  horariosConfigurados,
  partesNoFuso,
  instanteNoFuso,
  adicionarDias,
  edicaoInformativo,
  intervaloAvisos,
  validadeInformativo,
  informativoVigente,
};
