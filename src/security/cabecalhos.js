// Cabeçalhos de segurança HTTP (V-08), sem dependências externas.
//
// A CSP é restrita a 'self': o painel (dashboard.html, areas.html,
// mapas.html) só usa scripts, estilos, imagens e fontes servidos pelo
// próprio servidor, sem <script>/<style> inline nem atributos style="".
// Logos e ícones: arquivos em /logo e SVG inline (permitido); data: fica
// liberado só para imagens.
//
// Observação: a página mapas.html carrega Leaflet (unpkg.com) e a biblioteca
// do Windy (api.windy.com) apenas se o mapa Windy for reativado em
// src/integrations/windyRoutes.js (hoje ele responde configurado:false). Se
// for reativado, será preciso liberar esses domínios em script-src,
// style-src, img-src e connect-src para essa página.
//
// FRAME_ANCESTORS (opcional): lista de origens https separadas por espaço ou
// vírgula que podem embutir o painel em iframe (ex.: a página do Streamlit
// descrita no README §9.2). Sem ela, nenhum site pode embutir o painel
// (frame-ancestors 'none' + X-Frame-Options: DENY).

const ORIGEM_VALIDA = /^https:\/\/[a-z0-9.-]+(?::\d{1,5})?$/i;

function origensFrameAncestors(valor) {
  if (!valor || typeof valor !== "string") return [];
  const origens = valor.split(/[\s,]+/).filter(Boolean);
  const invalidas = origens.filter((o) => !ORIGEM_VALIDA.test(o));
  if (invalidas.length) {
    throw new Error("FRAME_ANCESTORS aceita só origens no formato https://host[:porta], separadas por espaço ou vírgula.");
  }
  return origens;
}

function montarCsp(frameAncestors) {
  return [
    "default-src 'self'",
    "img-src 'self' data:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    `frame-ancestors ${frameAncestors.length ? frameAncestors.join(" ") : "'none'"}`,
  ].join("; ");
}

/**
 * Middleware que define os cabeçalhos em todas as respostas.
 * @param {object} [opcoes]
 * @param {string} [opcoes.frameAncestors] valor no formato de FRAME_ANCESTORS
 * @param {string|null} [opcoes.hsts] valor do Strict-Transport-Security, enviado
 *   só em requisições HTTPS (req.secure); null desliga.
 */
function cabecalhosSeguranca({
  frameAncestors = process.env.FRAME_ANCESTORS,
  hsts = "max-age=31536000",
} = {}) {
  const origens = origensFrameAncestors(frameAncestors);
  const csp = montarCsp(origens);
  return function aplicarCabecalhos(req, res, next) {
    res.setHeader("Content-Security-Policy", csp);
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (origens.length === 0) res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    if (hsts && req.secure) res.setHeader("Strict-Transport-Security", hsts);
    next();
  };
}

module.exports = { cabecalhosSeguranca, montarCsp, origensFrameAncestors };
