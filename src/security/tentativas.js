// Controle de tentativas de senha por IP com ATRASO PROGRESSIVO (V-05).
//
// Antes: 5 erros bloqueavam o IP por 5 minutos, inclusive para a senha
// correta — numa rede com NAT/proxy, qualquer pessoa errando 5 vezes
// trancava o operador para fora.
//
// Agora nada é bloqueado: a partir da 3ª falha seguida do mesmo IP, toda
// tentativa desse IP (certa ou errada) espera 0,5 s, 1 s, 2 s, 4 s ... até
// 30 s antes de ser avaliada. A senha correta sempre entra (no máximo com
// esse atraso) e zera o contador. Como o atraso vale também para a senha
// correta, a demora da resposta não revela se o palpite estava certo.
//
// Limites de memória: no máximo `maxIps` IPs registrados (os mais antigos
// são descartados) e `maxEmEsperaTotal` respostas aguardando atraso ao mesmo
// tempo (acima disso responde 503 sem avaliar a senha).

function criarControleTentativas({
  falhasSemAtraso = 2,
  atrasoBaseMs = 500,
  atrasoMaxMs = 30_000,
  esquecerAposMs = 15 * 60 * 1000,
  maxIps = 10_000,
  maxEmEsperaTotal = 500,
  agora = Date.now,
  dormir = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  const registros = new Map(); // ip -> { falhas, ultima }
  let emEsperaTotal = 0;

  function registroAtivo(ip) {
    const r = registros.get(ip);
    if (!r) return null;
    if (agora() - r.ultima > esquecerAposMs) {
      registros.delete(ip);
      return null;
    }
    return r;
  }

  function atrasoPara(falhas) {
    if (falhas <= falhasSemAtraso) return 0;
    return Math.min(atrasoBaseMs * 2 ** (falhas - falhasSemAtraso - 1), atrasoMaxMs);
  }

  function liberarEspaco() {
    if (registros.size < maxIps) return;
    const t = agora();
    for (const [ip, r] of registros) if (t - r.ultima > esquecerAposMs) registros.delete(ip);
    while (registros.size >= maxIps) registros.delete(registros.keys().next().value);
  }

  function registrarFalha(ip) {
    let r = registros.get(ip);
    if (r) {
      registros.delete(ip); // reinsere no fim (ordem = mais recente por último)
    } else {
      liberarEspaco();
      r = { falhas: 0, ultima: 0 };
    }
    r.falhas = Math.min(r.falhas + 1, 1000);
    r.ultima = agora();
    registros.set(ip, r);
  }

  /**
   * @param {string} ip
   * @param {() => boolean} senhaConfere avaliada só depois do atraso
   * @returns {Promise<{ok: boolean, status?: number, erro?: string, atrasoMs: number}>}
   */
  async function verificar(ip, senhaConfere) {
    const chave = String(ip || "desconhecido");
    const r = registroAtivo(chave);
    const atrasoMs = r ? atrasoPara(r.falhas) : 0;

    if (atrasoMs > 0) {
      if (emEsperaTotal >= maxEmEsperaTotal) {
        return { ok: false, status: 503, erro: "Servidor ocupado. Tente novamente em instantes.", atrasoMs: 0 };
      }
      emEsperaTotal += 1;
      try {
        await dormir(atrasoMs);
      } finally {
        emEsperaTotal -= 1;
      }
    }

    if (senhaConfere()) {
      registros.delete(chave);
      return { ok: true, atrasoMs };
    }
    registrarFalha(chave);
    return { ok: false, status: 401, erro: "Senha incorreta.", atrasoMs };
  }

  return {
    verificar,
    atrasoPara,
    falhasDe: (ip) => registroAtivo(String(ip))?.falhas || 0,
    get tamanho() { return registros.size; },
  };
}

/**
 * Converte TRUST_PROXY para o formato de app.set("trust proxy").
 *   vazio / false / 0  -> false (padrão: não confia em X-Forwarded-For)
 *   true               -> 1 (confia só no proxy imediatamente à frente)
 *   número N           -> N saltos
 *   lista              -> IPs/sub-redes ou "loopback", "uniquelocal"...
 */
function valorTrustProxy(valor) {
  if (valor === undefined || valor === null) return false;
  const s = String(valor).trim();
  if (!s || /^(false|0|off|no|nao|não)$/i.test(s)) return false;
  if (/^true$/i.test(s)) return 1;
  if (/^\d+$/.test(s)) return Number(s);
  return s.split(",").map((x) => x.trim()).filter(Boolean);
}

module.exports = { criarControleTentativas, valorTrustProxy };
