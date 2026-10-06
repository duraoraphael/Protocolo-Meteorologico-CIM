/* Estágios operacionais do COR-Rio — definição ÚNICA, compartilhada entre o
 * painel (carregado como <script>, expõe window.CorRio) e o PDF (require no
 * Node). Também concentra a leitura do estado de /api/cor-rio, para que
 * painel, PDF baixado e PDF anexado ao e-mail mostrem a mesma situação.
 *
 * O estágio vem só do COR-Rio. Sem dado válido o estado é "indisponível" —
 * nunca se assume o estágio 1. */
(function (raiz, fabrica) {
  const modulo = fabrica();
  if (typeof module === 'object' && module.exports) module.exports = modulo;
  else raiz.CorRio = modulo;
})(typeof self !== 'undefined' ? self : this, function () {
  const ESTAGIOS = Object.freeze({
    1: Object.freeze({ nome: 'Verde', cor: '#22C55E' }),
    2: Object.freeze({ nome: 'Amarelo', cor: '#FACC15' }),
    3: Object.freeze({ nome: 'Laranja', cor: '#F97316' }),
    4: Object.freeze({ nome: 'Vermelho', cor: '#EF4444' }),
    5: Object.freeze({ nome: 'Roxo', cor: '#A855F7' }),
  });
  // Texto sobre a cor do estágio: contraste ≥ 4,5:1 nas cinco cores.
  const TINTA = '#0B1A12';
  const NEUTRO = Object.freeze({ cor: '#8A9894', fundo: '#F3F5F4' });

  function estagioValido(n) {
    return Object.prototype.hasOwnProperty.call(ESTAGIOS, String(n));
  }

  /** Tom claro da cor (proporção da cor sobre o branco), em #RRGGBB. */
  function tomClaro(hex, proporcao = 0.1) {
    const canais = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    return '#' + canais.map((c) => Math.round(255 - (255 - c) * proporcao).toString(16).padStart(2, '0')).join('').toUpperCase();
  }

  /**
   * Lê o estado devolvido pelo serviço COR-Rio (o mesmo de /api/cor-rio).
   * `falhaServidor`: o painel não conseguiu falar com o próprio servidor —
   * o último dado recebido continua valendo, mas desatualizado.
   */
  function situacao(estado, { falhaServidor = false } = {}) {
    const est = estado && estado.estagio;
    const calor = estado && estado.calor;
    const com = estado && estado.comunicados;
    const nivel = est && est.dados && estagioValido(est.dados.nivel) ? Number(est.dados.nivel) : null;
    const nivelCalor = calor && calor.dados && estagioValido(calor.dados.nivel) ? Number(calor.dados.nivel) : null;
    const comConsultado = Boolean(com && com.consultadoEm);
    const itens = (com && com.itens) || [];
    return {
      nivel,
      estagio: nivel ? ESTAGIOS[nivel] : null,
      estagioDesatualizado: Boolean(nivel) && (est.status === 'desatualizado' || falhaServidor),
      nivelCalor,
      calor: nivelCalor ? ESTAGIOS[nivelCalor] : null,
      calorDesatualizado: Boolean(nivelCalor) && (calor.status === 'desatualizado' || falhaServidor),
      comunicadosDesatualizados: comConsultado && (com.status === 'desatualizado' || falhaServidor),
      // 'indisponivel' (nunca consultado com sucesso) ≠ 'nenhum' (consultado, sem vigentes)
      comunicados: !comConsultado ? 'indisponivel' : itens.length ? 'disponivel' : 'nenhum',
      itens,
    };
  }

  return { ESTAGIOS, TINTA, NEUTRO, estagioValido, tomClaro, situacao };
});
