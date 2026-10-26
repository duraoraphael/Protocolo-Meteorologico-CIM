const { acumularRecomendacoes } = require("./recomendacoesCumulativas");

const RECOMENDACOES = Object.freeze({
  tempestade: Object.freeze({
    "ATENÇÃO": Object.freeze([
      "Acompanhar a evolução da tempestade e manter acesso rápido a abrigo seguro.",
      "Evitar permanência desnecessária em áreas abertas durante trovoadas.",
    ]),
    ALERTA: Object.freeze([
      "Suspender atividades externas, em altura e próximas a estruturas metálicas durante a tempestade.",
      "Manter as equipes em edificação protegida e afastadas de árvores, postes e equipamentos energizados.",
    ]),
    "EMERGÊNCIA": Object.freeze([
      "Interromper toda atividade exposta e permanecer em abrigo seguro até a liberação operacional.",
      "Acionar a resposta de emergência local diante de descargas, danos ou pessoas atingidas.",
    ]),
  }),
  uv: Object.freeze({
    "ATENÇÃO": Object.freeze([
      "Utilizar protetor solar, vestimenta de manga longa, óculos com proteção UV e cobertura para a cabeça.",
      "Priorizar sombra e reforçar a proteção das equipes em atividade externa.",
    ]),
    ALERTA: Object.freeze([
      "Reprogramar, quando possível, atividades externas para fora do período de pico do índice UV.",
      "Ampliar pausas em área coberta e reduzir o tempo contínuo de exposição solar.",
    ]),
    "EMERGÊNCIA": Object.freeze([
      "Suspender atividades externas não essenciais durante o pico de radiação ultravioleta.",
    ]),
  }),
  ar: Object.freeze({
    "ATENÇÃO": Object.freeze([
      "Monitorar sintomas respiratórios e reduzir esforço prolongado ao ar livre para pessoas sensíveis.",
      "Manter pessoas com doenças respiratórias ou cardiovasculares sob atenção reforçada.",
    ]),
    ALERTA: Object.freeze([
      "Reprogramar atividades externas intensas e avaliar proteção respiratória conforme o risco ocupacional.",
      "Manter ambientes internos protegidos da entrada de ar contaminado, quando aplicável.",
    ]),
    "EMERGÊNCIA": Object.freeze([
      "Suspender esforço físico externo e encaminhar pessoas sintomáticas para avaliação de saúde.",
    ]),
  }),
  mar: Object.freeze({
    "ATENÇÃO": Object.freeze([
      "Monitorar altura das ondas e condições locais antes de transferências e atividades costeiras.",
      "Reavaliar operações com pequenas embarcações conforme os limites do procedimento local.",
    ]),
    ALERTA: Object.freeze([
      "Suspender operações marítimas expostas que ultrapassem os limites locais de segurança.",
      "Restringir o acesso a bordas, píeres e áreas sujeitas a impacto de ondas.",
    ]),
    "EMERGÊNCIA": Object.freeze([
      "Interromper operações costeiras e marítimas expostas e manter as equipes em área segura.",
    ]),
  }),
  umidade: Object.freeze({
    "ATENÇÃO": Object.freeze([
      "Reforçar hidratação e pausas para equipes em atividade externa.",
      "Evitar fontes de ignição e monitorar áreas com vegetação seca.",
    ]),
    ALERTA: Object.freeze([
      "Reduzir esforço físico prolongado e intensificar a vigilância de focos de incêndio.",
    ]),
    "EMERGÊNCIA": Object.freeze([
      "Suspender atividades externas de maior esforço e acionar o plano local diante de princípio de incêndio.",
    ]),
  }),
});

function recomendacoesFenomeno(fenomeno, grau) {
  return acumularRecomendacoes(fenomeno, grau, RECOMENDACOES);
}

module.exports = { recomendacoesFenomeno };
