// DOM mínimo, sem dependências, para carregar os scripts de public/ num
// contexto vm do Node e inspecionar o HTML que eles geram.
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function elementoFalso(id) {
  const props = { id, innerHTML: "", textContent: "", value: "", dataset: {}, open: false };
  const noop = () => {};
  const classList = { add: noop, remove: noop, contains: () => false, toggle: noop };
  return new Proxy(props, {
    get(alvo, chave) {
      if (chave in alvo) return alvo[chave];
      if (chave === "classList") return classList;
      if (chave === "querySelectorAll") return () => [];
      if (chave === "getClientRects") return () => [];
      if (typeof chave === "symbol") return undefined;
      return noop;
    },
    set(alvo, chave, valor) {
      alvo[chave] = valor;
      return true;
    },
  });
}

/**
 * Cria um contexto com document/window falsos e carrega os scripts pedidos.
 * `responder(url, opcoes)` define o JSON devolvido pelo fetch falso.
 */
function carregarPainel({ responder = () => ({}) } = {}) {
  const elementos = new Map();
  const obter = (id) => {
    if (!elementos.has(id)) elementos.set(id, elementoFalso(id));
    return elementos.get(id);
  };
  const document = {
    getElementById: obter,
    querySelectorAll: () => [],
    addEventListener: () => {},
    activeElement: null,
    createElement: () => elementoFalso("novo"),
  };
  const contexto = {
    console,
    document,
    window: { location: { search: "", href: "http://painel.local/" }, history: { replaceState() {} } },
    location: { search: "", href: "http://painel.local/" },
    URL,
    URLSearchParams,
    Intl,
    AbortController,
    setInterval: () => 0,
    setTimeout: () => 0,
    clearTimeout: () => {},
    MutationObserver: class { observe() {} },
    fetch: async (url, opcoes) => ({ ok: true, json: async () => responder(String(url), opcoes) }),
  };
  vm.createContext(contexto);
  for (const arquivo of ["dashboard-components.js", "dashboard.js"]) {
    const codigo = fs.readFileSync(path.join(__dirname, "..", "..", "public", arquivo), "utf-8");
    vm.runInContext(codigo, contexto, { filename: arquivo });
  }
  return { contexto, elemento: obter, executar: (codigo) => vm.runInContext(codigo, contexto) };
}

module.exports = { carregarPainel };
