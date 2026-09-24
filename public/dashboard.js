const conteudo = document.getElementById("conteudo");
const relogioEl = document.getElementById("relogio");
const ultimaAtualizacaoEl = document.getElementById("ultima-atualizacao");
const seletorBaseEl = document.getElementById("seletor-base");

const overlaySenha = document.getElementById("overlay-senha");
const inputSenha = document.getElementById("input-senha");
const modalMensagem = document.getElementById("modal-mensagem");
const botaoConfig = document.getElementById("botao-config");
const botaoCancelar = document.getElementById("botao-cancelar");
const botaoConfirmar = document.getElementById("botao-confirmar");
const toastEl = document.getElementById("toast");

const REFRESH_MS = 10 * 60 * 1000; // 10 minutos

// Todo texto vindo do servidor (nomes, e-mails, mensagens de erro) passa por
// este escape antes de ir para innerHTML — evita XSS armazenado (V-01).
const esc = Dashboard.escape;

let cidadeAtivaChave = null; // preenchido após o primeiro /api/preview

async function carregarLogos() {
  try {
    const resp = await fetch("/api/logos");
    const dados = await resp.json();
    if (!dados.ok) return;

    const logoPetrobrasCard = document.getElementById("logo-petrobras-card");
    if (dados.petrobras) {
      document.getElementById("logo-petrobras").src = dados.petrobras;
      logoPetrobrasCard.classList.remove("oculto");
    }
  } catch (erro) {
    // Sem logo cadastrado ainda (pasta Logo/ vazia) — painel segue normal, só sem as imagens.
  }
}
carregarLogos();

function atualizarRelogio() {
  const agora = new Date();
  const data = document.getElementById("data-atual");
  data.textContent = agora.toLocaleDateString("pt-BR", { dateStyle: "full", timeZone: "America/Sao_Paulo" });
  data.dateTime = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(agora);
  relogioEl.textContent = agora.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "America/Sao_Paulo" });
}
setInterval(atualizarRelogio, 1000);
atualizarRelogio();

let reportAtual = null;
function renderPainel(report) {
  reportAtual = report;
  ultimaAtualizacaoEl.textContent = `Última atualização: ${report.horaConsulta}`;
  document.getElementById("tempo-atual").innerHTML = Dashboard.currentWeather(report);
  conteudo.innerHTML = Dashboard.home(report);
  cidadeAtivaChave = report.cidade.chave;
  document.getElementById("resp-nome-base").textContent = `${report.cidade.nome} — ${report.cidade.uf}`;
  if (document.getElementById("detalhes").open) abrirDetalhes(detalheAtivo);
}

function renderListaDestinatariosPainel(responsaveis) {
  const alvo = document.getElementById("lista-destinatarios-painel");
  if (!alvo) return;
  if (!responsaveis || responsaveis.length === 0) {
    alvo.innerHTML = `<span style="color:var(--laranja)">Nenhum responsável cadastrado para esta base — o botão 👥 permite cadastrar.</span>`;
    return;
  }
  alvo.innerHTML = `<div class="chips-destinatarios">${responsaveis
    .map((r) => `<span class="chip-destinatario">${esc(r.nome)} — ${esc(r.email)}</span>`)
    .join("")}</div>`;
}

async function carregarDestinatariosPainel() {
  if (!cidadeAtivaChave) return;
  try {
    const resp = await fetch(`/api/responsaveis?cidade=${encodeURIComponent(cidadeAtivaChave)}`);
    const dados = await resp.json();
    if (!dados.ok) throw new Error(dados.erro || "Falha ao carregar responsáveis.");
    renderListaDestinatariosPainel(dados.bases[0]?.responsaveis || []);
  } catch (erro) {
    const alvo = document.getElementById("lista-destinatarios-painel");
    if (alvo) alvo.innerHTML = `<span style="color:var(--vermelho)">Erro ao carregar: ${esc(erro.message)}</span>`;
  }
}

// ---------------------------------------------------------------------
// Seletor de base — permite trocar a instalação exibida no painel. A base
// escolhida fica salva na URL (?cidade=chave), então uma TV específica pode
// ser fixada numa base salvando/abrindo sempre o mesmo link.
// ---------------------------------------------------------------------
function baseNaUrl() {
  return new URLSearchParams(window.location.search).get("cidade");
}
function definirBaseNaUrl(chave) {
  const url = new URL(window.location.href);
  url.searchParams.set("cidade", chave);
  window.history.replaceState({}, "", url);
}

async function popularSeletorBase() {
  const resp = await fetch("/api/cidades");
  const dados = await resp.json();
  const escolhidaNaUrl = baseNaUrl();
  const inicial = escolhidaNaUrl || dados.ativa;

  seletorBaseEl.innerHTML = dados.disponiveis
    .map((c) => `<option value="${esc(c.chave)}">${esc(c.nome)} — ${esc(c.uf)}</option>`)
    .join("");
  seletorBaseEl.value = inicial;
  return seletorBaseEl.value || dados.ativa;
}

seletorBaseEl.addEventListener("change", () => {
  definirBaseNaUrl(seletorBaseEl.value);
  carregarPreview();
});

let previewRequest = 0;
let previewAbort;
async function carregarPreview() {
  const request = ++previewRequest;
  previewAbort?.abort();
  previewAbort = new AbortController();
  conteudo.setAttribute("aria-busy", "true");
  const manterDados = reportAtual?.cidade.chave === seletorBaseEl.value;
  if (!manterDados) {
    reportAtual = null;
    cidadeAtivaChave = null;
    document.getElementById("tempo-atual").textContent = "Atualizando condições…";
    ultimaAtualizacaoEl.textContent = "Atualizando dados…";
    conteudo.innerHTML = '<p role="status">Carregando dados meteorológicos…</p><div class="cim-loading-grid" aria-hidden="true">' + '<div class="cim-loading-card"></div>'.repeat(7) + '</div>'; 
    if (document.getElementById("detalhes").open) abrirDetalhes(detalheAtivo);
    } else { ultimaAtualizacaoEl.textContent = "Atualizando dados…"; }
  try {
    const cidade = seletorBaseEl.value;
    const resp = await fetch(`/api/preview?cidade=${encodeURIComponent(cidade)}`, { signal: previewAbort.signal });
    const dados = await resp.json();
    if (request !== previewRequest) return;
    if (!dados.ok) throw new Error(dados.erro || "Falha ao carregar dados.");
    renderPainel(dados.report);
  } catch (erro) {
    if (request !== previewRequest || erro.name === "AbortError") return;
    if (manterDados) { ultimaAtualizacaoEl.textContent = "Falha na atualização · exibindo dados anteriores"; return; }
    conteudo.innerHTML = `<div class="erro" role="alert">Não foi possível carregar os dados meteorológicos: ${Dashboard.escape(erro.message)} <button id="tentar-novamente">Tentar novamente</button></div>`;
    document.getElementById("tempo-atual").textContent = "Condições atuais indisponíveis";
    ultimaAtualizacaoEl.textContent = "Atualização indisponível";
  } finally {
    if (request === previewRequest) conteudo.setAttribute("aria-busy", "false");
  }
}

async function iniciar() {
  try {
    const inicial = await popularSeletorBase();
    definirBaseNaUrl(inicial);
    await carregarPreview();
  } catch (erro) {
    conteudo.setAttribute("aria-busy", "false");
    conteudo.innerHTML = `<div class="erro" role="alert">Não foi possível carregar as bases. <button id="tentar-novamente">Tentar novamente</button></div>`;
  }
}
iniciar();
setInterval(() => seletorBaseEl.value ? carregarPreview() : iniciar(), REFRESH_MS);

// ---------------------------------------------------------------------
// Modal de senha / geração + envio manual
// ---------------------------------------------------------------------
function abrirModal() {
  overlaySenha.classList.remove("oculto");
  modalMensagem.textContent = "";
  inputSenha.value = "";
  inputSenha.focus();
}
function fecharModal() {
  overlaySenha.classList.add("oculto");
}

botaoConfig.addEventListener("click", abrirModal);
botaoCancelar.addEventListener("click", fecharModal);
overlaySenha.addEventListener("click", (e) => {
  if (e.target === overlaySenha) fecharModal();
});
inputSenha.addEventListener("keydown", (e) => {
  if (e.key === "Enter") botaoConfirmar.click();
});

function mostrarToast(mensagem, tipo = "sucesso") {
  toastEl.textContent = mensagem;
  toastEl.className = `toast ${tipo === "erro" ? "erro" : ""}`;
  setTimeout(() => toastEl.classList.add("oculto"), 8000);
}

botaoConfirmar.addEventListener("click", async () => {
  const senha = inputSenha.value;
  if (!senha) {
    modalMensagem.textContent = "Digite a senha.";
    return;
  }
  botaoConfirmar.disabled = true;
  botaoConfirmar.textContent = "Gerando…";
  modalMensagem.textContent = "";

  try {
    const resp = await fetch("/api/gerar-relatorio", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ senha, cidade: seletorBaseEl.value }),
    });
    const dados = await resp.json();
    if (!dados.ok) throw new Error(dados.erro || "Falha ao gerar relatório.");

    fecharModal();
    mostrarToast(
      `Relatório gerado e enviado para: ${dados.destinatarios.join(", ")}.`,
      "sucesso"
    );
    carregarPreview();
  } catch (erro) {
    modalMensagem.textContent = erro.message;
  } finally {
    botaoConfirmar.disabled = false;
    botaoConfirmar.textContent = "Gerar e Enviar";
  }
});

// ---------------------------------------------------------------------
// Modal de gerenciamento de responsáveis (nome + e-mail) por base
// ---------------------------------------------------------------------
const overlayResponsaveis = document.getElementById("overlay-responsaveis");
const botaoResponsaveis = document.getElementById("botao-responsaveis");
const respBlocoSenha = document.getElementById("resp-bloco-senha");
const respBlocoGestao = document.getElementById("resp-bloco-gestao");
const respInputSenha = document.getElementById("resp-input-senha");
const respSenhaMensagem = document.getElementById("resp-senha-mensagem");
const respBotaoDesbloquear = document.getElementById("resp-botao-desbloquear");
const respBotaoCancelar = document.getElementById("resp-botao-cancelar");
const respBotaoFechar = document.getElementById("resp-botao-fechar");
const respLista = document.getElementById("resp-lista");
const respForm = document.getElementById("resp-form");
const respInputNome = document.getElementById("resp-input-nome");
const respInputEmail = document.getElementById("resp-input-email");
const respFormMensagem = document.getElementById("resp-form-mensagem");

let senhaDesbloqueada = null; // guardada em memória só durante a sessão do modal aberto

function abrirModalResponsaveis() {
  if (!cidadeAtivaChave) return;
  overlayResponsaveis.classList.remove("oculto");
  respBlocoSenha.classList.remove("oculto");
  respBlocoGestao.classList.add("oculto");
  respInputSenha.value = "";
  respSenhaMensagem.textContent = "";
  senhaDesbloqueada = null;
  respInputSenha.focus();
}
function fecharModalResponsaveis() {
  overlayResponsaveis.classList.add("oculto");
  senhaDesbloqueada = null;
}

botaoResponsaveis.addEventListener("click", abrirModalResponsaveis);
respBotaoCancelar.addEventListener("click", fecharModalResponsaveis);
respBotaoFechar.addEventListener("click", fecharModalResponsaveis);
overlayResponsaveis.addEventListener("click", (e) => {
  if (e.target === overlayResponsaveis) fecharModalResponsaveis();
});
respInputSenha.addEventListener("keydown", (e) => {
  if (e.key === "Enter") respBotaoDesbloquear.click();
});

async function renderListaModal() {
  respLista.innerHTML = `<li class="resp-vazio">Carregando…</li>`;
  const resp = await fetch(`/api/responsaveis?cidade=${encodeURIComponent(cidadeAtivaChave)}`);
  const dados = await resp.json();
  if (!dados.ok) throw new Error(dados.erro || "Falha ao carregar responsáveis.");
  const lista = dados.bases[0]?.responsaveis || [];

  respLista.innerHTML =
    lista.length === 0
      ? `<li class="resp-vazio">Nenhum responsável cadastrado ainda.</li>`
      : lista
          .map(
            (r) => `<li>
              <span>${esc(r.nome)} <span class="resp-email">${esc(r.email)}</span></span>
              <button class="resp-remover" data-email="${esc(r.email)}" title="Remover">✕</button>
            </li>`
          )
          .join("");

  respLista.querySelectorAll(".resp-remover").forEach((btn) => {
    btn.addEventListener("click", () => removerResponsavel(btn.dataset.email));
  });

  renderListaDestinatariosPainel(lista); // mantém o painel principal sincronizado
}

respBotaoDesbloquear.addEventListener("click", async () => {
  const senha = respInputSenha.value;
  if (!senha) {
    respSenhaMensagem.textContent = "Digite a senha.";
    return;
  }
  respBotaoDesbloquear.disabled = true;
  respBotaoDesbloquear.textContent = "Verificando…";
  try {
    const resp = await fetch("/api/verificar-senha", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ senha }),
    });
    const dados = await resp.json();
    if (!dados.ok) throw new Error(dados.erro || "Senha incorreta.");

    senhaDesbloqueada = senha;
    respBlocoSenha.classList.add("oculto");
    respBlocoGestao.classList.remove("oculto");
    respFormMensagem.textContent = "";
    await renderListaModal();
  } catch (erro) {
    respSenhaMensagem.textContent = erro.message;
  } finally {
    respBotaoDesbloquear.disabled = false;
    respBotaoDesbloquear.textContent = "Desbloquear";
  }
});

respForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const nome = respInputNome.value.trim();
  const email = respInputEmail.value.trim();
  if (!nome || !email) {
    respFormMensagem.textContent = "Preencha nome e e-mail.";
    return;
  }
  respFormMensagem.textContent = "";
  try {
    const resp = await fetch("/api/responsaveis", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ senha: senhaDesbloqueada, cidade: cidadeAtivaChave, nome, email }),
    });
    const dados = await resp.json();
    if (!dados.ok) throw new Error(dados.erro || "Falha ao cadastrar responsável.");
    respInputNome.value = "";
    respInputEmail.value = "";
    await renderListaModal();
    mostrarToast(`${nome} cadastrado(a) para receber o informativo desta base.`, "sucesso");
  } catch (erro) {
    respFormMensagem.textContent = erro.message;
    if (/senha/i.test(erro.message)) {
      // senha incorreta ou expirada: força novo desbloqueio
      respBlocoGestao.classList.add("oculto");
      respBlocoSenha.classList.remove("oculto");
      senhaDesbloqueada = null;
    }
  }
});

async function removerResponsavel(email) {
  respFormMensagem.textContent = "";
  try {
    const resp = await fetch("/api/responsaveis", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ senha: senhaDesbloqueada, cidade: cidadeAtivaChave, email }),
    });
    const dados = await resp.json();
    if (!dados.ok) throw new Error(dados.erro || "Falha ao remover responsável.");
    await renderListaModal();
    mostrarToast(`${email} removido(a) da lista desta base.`, "sucesso");
  } catch (erro) {
    respFormMensagem.textContent = erro.message;
    if (/senha/i.test(erro.message)) {
      respBlocoGestao.classList.add("oculto");
      respBlocoSenha.classList.remove("oculto");
      senhaDesbloqueada = null;
    }
  }
}

// Navigation and detail views keep operational features outside the compact home.
let detalheAtivo = 'monitoramento';
function abrirDetalhes(tipo) {
  detalheAtivo = tipo;
  const dialog = document.getElementById('detalhes');
  document.getElementById('detalhes-titulo').textContent = {monitoramento:'Monitoramento e fontes', mar:'Condições marítimas', vento:'Vento e chuva', sobre:'Sobre o CIM'}[tipo];
  document.getElementById('detalhes-conteudo').innerHTML = Dashboard.details(reportAtual, tipo);
  if (!dialog.open) dialog.showModal();
  if (tipo === 'monitoramento' && reportAtual) carregarDestinatariosPainel();
}
document.addEventListener('click', e => {
  const trigger = e.target.closest('[data-detail]');
  if (trigger) abrirDetalhes(trigger.dataset.detail);
  if (e.target.closest('#tentar-novamente')) seletorBaseEl.value ? carregarPreview() : iniciar();
});
document.getElementById('fechar-detalhes').addEventListener('click', () => document.getElementById('detalhes').close());
const menuToggle = document.getElementById('menu-toggle');
menuToggle.addEventListener('click', () => {
  const expanded = menuToggle.getAttribute('aria-expanded') !== 'true';
  menuToggle.setAttribute('aria-expanded', String(expanded));
  menuToggle.setAttribute('aria-label', expanded ? 'Fechar menu' : 'Abrir menu');
});
document.getElementById('menu-principal').addEventListener('click', e => {
  if (e.target.closest('a,button')) menuToggle.setAttribute('aria-expanded', 'false');
});
document.querySelectorAll('[data-icon]').forEach(el => el.innerHTML = Dashboard.icon(el.dataset.icon));
// Existing protected dialogs: keyboard containment and return focus.
let modalTrigger = null;
const modalObserver = new MutationObserver(records => {
  for (const {target} of records) {
    if (!target.classList.contains('oculto')) {
      modalTrigger = target === overlaySenha ? botaoConfig : botaoResponsaveis;
    } else if (modalTrigger) {
      modalTrigger.focus();
    }
  }
});
[overlaySenha, overlayResponsaveis].forEach(el => modalObserver.observe(el, {attributes:true, attributeFilter:['class']}));
document.addEventListener('keydown', e => {
  const overlay = [overlaySenha, overlayResponsaveis].find(el => !el.classList.contains('oculto'));
  if (!overlay) return;
  if (e.key === 'Escape') overlay === overlaySenha ? fecharModal() : fecharModalResponsaveis();
  if (e.key === 'Tab') {
    const focusable = [...overlay.querySelectorAll('button,input')].filter(el => !el.disabled && el.getClientRects().length);
    const first = focusable[0], last = focusable.at(-1);
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
});
