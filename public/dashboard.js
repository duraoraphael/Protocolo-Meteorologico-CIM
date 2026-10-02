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

// Intervalo padrão; o servidor informa o valor real em /api/preview.
let intervaloAtualizacaoMs = 30 * 60 * 1000;
const PREVIEW_TIMEOUT_MS = 90 * 1000;

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
// "Última atualização" mostra sempre a hora da última consulta bem-sucedida
// do relatório exibido (horaConsulta); falhas só acrescentam o aviso.
function mostrarUltimaAtualizacao(situacao = "") {
  if (!reportAtual) return;
  ultimaAtualizacaoEl.textContent = `Última atualização: ${reportAtual.horaConsulta}${situacao ? ` · ${situacao}` : ""}`;
}

function renderPainel(report, { pendente = false } = {}) {
  const mesmoRelatorio = reportAtual?.geradoEmISO === report.geradoEmISO && reportAtual?.cidade.chave === report.cidade.chave;
  reportAtual = report;
  cidadeAtivaChave = report.cidade.chave;
  mostrarUltimaAtualizacao(pendente ? "atualização pendente" : "");
  if (mesmoRelatorio) return; // nada novo: não re-renderiza (preserva rolagem e foco)
  document.getElementById("tempo-atual").innerHTML = Dashboard.currentWeather(report);
  conteudo.innerHTML = Dashboard.home(report);
  renderCorRio({ atualizarDetalhes: false });
  const detalhes = document.getElementById("detalhes");
  if (detalhes.open) {
    const rolagem = detalhes.scrollTop;
    abrirDetalhes(detalheAtivo);
    detalhes.scrollTop = rolagem;
  }
}

function renderListaDestinatariosPainel(responsaveis) {
  const alvo = document.getElementById("lista-destinatarios-painel");
  if (!alvo) return;
  if (!responsaveis || responsaveis.length === 0) {
    alvo.innerHTML = `<span class="texto-aviso">Nenhum responsável cadastrado para esta base — o botão 👥 permite cadastrar.</span>`;
    return;
  }
  alvo.innerHTML = `<div class="chips-destinatarios">${responsaveis
    .map((r) => `<span class="chip-destinatario">${esc(r.nome)}${r.email ? ` — ${esc(r.email)}` : ""}</span>`)
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
    if (alvo) alvo.innerHTML = `<span class="texto-erro">Erro ao carregar: ${esc(erro.message)}</span>`;
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

  basesComCorRio = new Set(dados.disponiveis.filter((c) => c.corRio).map((c) => c.chave));
  seletorBaseEl.innerHTML = dados.disponiveis
    .map((c) => `<option value="${esc(c.chave)}">${esc(c.nome)} — ${esc(c.uf)}</option>`)
    .join("");
  seletorBaseEl.value = inicial;
  return seletorBaseEl.value || dados.ativa;
}

seletorBaseEl.addEventListener("change", () => {
  definirBaseNaUrl(seletorBaseEl.value);
  carregarPreview();
  carregarCorRio();
});

// ---------------------------------------------------------------------
// Comunicados e estágio do COR-Rio (só bases com integração, hoje o
// município do Rio). Consultado ao abrir o painel / trocar de base e depois
// a cada intervalo de atualização, sem recarregar a página. Em falha, a
// última resposta válida continua na tela marcada como desatualizada.
// ---------------------------------------------------------------------
let basesComCorRio = new Set();
let estadoCorRio = null; // { chave, carregando, falhaServidor, resposta }
let proximaConsultaCorRio = 0;
let corRioRequest = 0;

function renderCorRio({ atualizarDetalhes = true } = {}) {
  const slot = document.getElementById("cor-rio-slot");
  if (slot) {
    slot.innerHTML = Dashboard.corRio(estadoCorRio);
    Dashboard.aplicarCoresEstagio(slot);
  }
  if (atualizarDetalhes && String(detalheAtivo).startsWith("cor-rio") && document.getElementById("detalhes").open) {
    const dialog = document.getElementById("detalhes");
    const rolagem = dialog.scrollTop;
    abrirDetalhes(detalheAtivo);
    dialog.scrollTop = rolagem;
  }
}

async function carregarCorRio() {
  const chave = seletorBaseEl.value;
  const request = ++corRioRequest;
  if (!basesComCorRio.has(chave)) {
    estadoCorRio = null;
    proximaConsultaCorRio = 0;
    renderCorRio();
    return;
  }
  if (estadoCorRio?.chave !== chave) {
    estadoCorRio = { chave, carregando: true, falhaServidor: false, resposta: null };
    renderCorRio();
  }
  try {
    const resp = await fetch(`/api/cor-rio?cidade=${encodeURIComponent(chave)}`, { cache: "no-store", signal: AbortSignal.timeout(60 * 1000) });
    const dados = await resp.json();
    if (request !== corRioRequest) return;
    if (!dados.ok || !dados.aplicavel) throw new Error(dados.erro || "Resposta inválida do COR-Rio.");
    const { ok, aplicavel, ...resposta } = dados;
    // estágio, textos e cores mudam juntos, num único render
    estadoCorRio = { chave, carregando: false, falhaServidor: false, resposta };
    proximaConsultaCorRio = Date.now() + intervaloAtualizacaoMs;
  } catch (erro) {
    if (request !== corRioRequest) return;
    estadoCorRio = { ...estadoCorRio, carregando: false, falhaServidor: true };
    proximaConsultaCorRio = Date.now() + Math.min(NOVA_TENTATIVA_MS, intervaloAtualizacaoMs);
  }
  renderCorRio();
}

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
    } else { mostrarUltimaAtualizacao("atualizando…"); }
  ultimaVerificacao = Date.now();
  try {
    const cidade = seletorBaseEl.value;
    const sinal = AbortSignal.any
      ? AbortSignal.any([previewAbort.signal, AbortSignal.timeout(PREVIEW_TIMEOUT_MS)])
      : previewAbort.signal;
    const resp = await fetch(`/api/preview?cidade=${encodeURIComponent(cidade)}`, { signal: sinal, cache: "no-store" });
    const dados = await resp.json();
    if (request !== previewRequest) return;
    if (!dados.ok) throw new Error(dados.erro || "Falha ao carregar dados.");
    if (dados.atualizacao?.intervaloMs > 0) intervaloAtualizacaoMs = dados.atualizacao.intervaloMs;
    renderPainel(dados.report, { pendente: Boolean(dados.atualizacao?.pendente) });
    agendarProximaVerificacao(dados.report, Boolean(dados.atualizacao?.pendente));
  } catch (erro) {
    if (request !== previewRequest || (erro.name === "AbortError" && previewAbort.signal.aborted)) return;
    agendarProximaVerificacao(null, true);
    if (manterDados) { mostrarUltimaAtualizacao("atualização pendente"); return; }
    conteudo.innerHTML = `<div class="erro" role="alert">Não foi possível carregar os dados meteorológicos: ${Dashboard.escape(erro.message)} <button id="tentar-novamente">Tentar novamente</button></div>`;
    document.getElementById("tempo-atual").textContent = "Condições atuais indisponíveis";
    ultimaAtualizacaoEl.textContent = "Atualização indisponível";
  } finally {
    if (request === previewRequest) conteudo.setAttribute("aria-busy", "false");
  }
}

// ---------------------------------------------------------------------
// Atualização automática. O servidor renova os dados sozinho a cada
// intervalo; o painel busca a versão nova logo depois. Navegadores
// atrasam ou congelam temporizadores de abas em segundo plano, então a
// próxima busca é um horário absoluto conferido por um "pulso" de 1 min
// e também ao voltar para a aba, recuperar o foco ou a rede.
// ---------------------------------------------------------------------
const FOLGA_APOS_SERVIDOR_MS = 2 * 60 * 1000; // tempo para o ciclo do servidor concluir
const NOVA_TENTATIVA_MS = 5 * 60 * 1000;
let proximaVerificacao = 0;
let ultimaVerificacao = 0;

function agendarProximaVerificacao(report, pendente) {
  const consultadoEm = Date.parse(report?.geradoEmISO || reportAtual?.geradoEmISO || "") || 0;
  const aposServidor = consultadoEm + intervaloAtualizacaoMs + FOLGA_APOS_SERVIDOR_MS;
  const minimo = Date.now() + Math.min(pendente ? NOVA_TENTATIVA_MS : 60 * 1000, intervaloAtualizacaoMs);
  proximaVerificacao = Math.max(aposServidor, minimo);
}

function verificarSeVencido() {
  if (!seletorBaseEl.value) return iniciar();
  // Requisição presa (ex.: rede caiu no meio): o timeout acima a encerra.
  if (Date.now() >= proximaVerificacao && Date.now() - ultimaVerificacao > 30 * 1000) carregarPreview();
  if (basesComCorRio.has(seletorBaseEl.value) && Date.now() >= proximaConsultaCorRio) carregarCorRio();
}

setInterval(verificarSeVencido, 60 * 1000);
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") verificarSeVencido(); });
window.addEventListener("focus", verificarSeVencido);
window.addEventListener("online", verificarSeVencido);
window.addEventListener("pageshow", (e) => { if (e.persisted) verificarSeVencido(); });
document.addEventListener("resume", verificarSeVencido); // aba descongelada (Chrome)

async function iniciar() {
  try {
    const inicial = await popularSeletorBase();
    definirBaseNaUrl(inicial);
    carregarCorRio();
    await carregarPreview();
  } catch (erro) {
    conteudo.setAttribute("aria-busy", "false");
    conteudo.innerHTML = `<div class="erro" role="alert">Não foi possível carregar as bases. <button id="tentar-novamente">Tentar novamente</button></div>`;
  }
}
iniciar();

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
  botaoConfirmar.textContent = "Gerando relatório…";
  modalMensagem.textContent = "Atualizando os dados meteorológicos…";
  const avisoPdf = setTimeout(() => {
    botaoConfirmar.textContent = "Gerando PDF…";
    modalMensagem.textContent = "Gerando o PDF completo…";
  }, 1500);
  const avisoEnvio = setTimeout(() => {
    botaoConfirmar.textContent = "Enviando relatório…";
    modalMensagem.textContent = "Anexando o PDF e enviando o relatório…";
  }, 5000);

  try {
    const resp = await fetch("/api/gerar-relatorio", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ senha, cidade: seletorBaseEl.value }),
    });
    const dados = await resp.json();
    if (!dados.ok) {
      throw new Error(dados.message || dados.erro || "Não foi possível concluir o envio do relatório.");
    }

    fecharModal();
    mostrarToast(dados.message || "Relatório gerado e enviado com sucesso.", "sucesso");
    carregarPreview();
  } catch (erro) {
    modalMensagem.textContent = erro.message || "Não foi possível concluir o envio do relatório.";
  } finally {
    clearTimeout(avisoPdf);
    clearTimeout(avisoEnvio);
    botaoConfirmar.disabled = false;
    botaoConfirmar.textContent = "Gerar e Enviar";
  }
});

// ---------------------------------------------------------------------
// Modal de gerenciamento de responsáveis. A pessoa existe uma única vez e
// pode receber os informativos de uma ou várias bases.
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
const respBotaoCadastrar = document.getElementById("resp-botao-cadastrar");
const respFormMensagem = document.getElementById("resp-form-mensagem");

let senhaDesbloqueada = null; // guardada em memória só durante a sessão do modal aberto
let basesDisponiveis = [];
let responsaveisCadastrados = [];

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
  // E-mails só vêm com a senha (V-06): a leitura pública devolve só nomes.
  const resp = await fetch("/api/responsaveis/consultar", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ senha: senhaDesbloqueada }),
  });
  const dados = await resp.json();
  if (!dados.ok) throw new Error(dados.erro || "Falha ao carregar responsáveis.");
  responsaveisCadastrados = dados.responsaveis || [];
  basesDisponiveis = dados.basesDisponiveis || [];

  respLista.innerHTML =
    responsaveisCadastrados.length === 0
      ? `<li class="resp-vazio">Nenhuma pessoa cadastrada ainda.</li>`
      : responsaveisCadastrados
          .map(
            (r) => `<li class="resp-pessoa" data-email="${esc(r.email)}">
              <div class="resp-cabecalho">
                <span><strong>${esc(r.nome)}</strong> <span class="resp-email">${esc(r.email)}</span></span>
                <button type="button" class="resp-remover" title="Excluir responsável">Excluir</button>
              </div>
              <fieldset class="resp-bases">
                <legend>Bases vinculadas</legend>
                ${basesDisponiveis.map((base) => `<label><input type="checkbox" class="resp-base" value="${esc(base.chave)}"${r.bases?.includes(base.chave) ? " checked" : ""}> ${esc(base.nome)} — ${esc(base.uf)}</label>`).join("")}
              </fieldset>
              <button type="button" class="botao-primario resp-salvar">Salvar bases</button>
            </li>`
          )
          .join("");

  // mantém o painel principal sincronizado, sem deixar e-mails à mostra na TV
  renderListaDestinatariosPainel(
    responsaveisCadastrados.filter((r) => r.bases?.includes(cidadeAtivaChave)).map(({ nome }) => ({ nome }))
  );
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
    respFormMensagem.classList.remove("sucesso");
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
    respFormMensagem.classList.remove("sucesso");
    respFormMensagem.textContent = "Preencha nome e e-mail.";
    return;
  }
  respFormMensagem.classList.remove("sucesso");
  respFormMensagem.textContent = "";
  respBotaoCadastrar.disabled = true;
  respBotaoCadastrar.textContent = "Cadastrando…";
  try {
    const resp = await fetch("/api/responsaveis", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ senha: senhaDesbloqueada, nome, email }),
    });
    const dados = await resp.json();
    if (!dados.ok) throw new Error(dados.erro || "Falha ao cadastrar responsável.");
    respInputNome.value = "";
    respInputEmail.value = "";
    await renderListaModal();
    respFormMensagem.classList.add("sucesso");
    respFormMensagem.textContent = `${nome} foi cadastrado(a). Agora marque e salve as bases dessa pessoa.`;
    mostrarToast(`${nome} cadastrado(a). Agora selecione e salve as bases.`, "sucesso");
  } catch (erro) {
    respFormMensagem.classList.remove("sucesso");
    respFormMensagem.textContent = erro.message;
    if (/senha/i.test(erro.message)) {
      // senha incorreta ou expirada: força novo desbloqueio
      respBlocoGestao.classList.add("oculto");
      respBlocoSenha.classList.remove("oculto");
      senhaDesbloqueada = null;
    }
  } finally {
    respBotaoCadastrar.disabled = false;
    respBotaoCadastrar.textContent = "Cadastrar responsável";
  }
});

async function salvarBasesResponsavel(item) {
  const email = item.dataset.email;
  const bases = [...item.querySelectorAll(".resp-base:checked")].map((campo) => campo.value);
  respFormMensagem.classList.remove("sucesso");
  respFormMensagem.textContent = "";
  try {
    const resp = await fetch("/api/responsaveis", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ senha: senhaDesbloqueada, email, bases }),
    });
    const dados = await resp.json();
    if (!dados.ok) throw new Error(dados.erro || "Falha ao salvar as bases.");
    await renderListaModal();
    mostrarToast(`Bases de ${email} atualizadas.`, "sucesso");
  } catch (erro) {
    respFormMensagem.classList.remove("sucesso");
    respFormMensagem.textContent = erro.message;
  }
}

async function removerResponsavel(email) {
  if (!window.confirm("Excluir este responsável de todas as bases?")) return;
  respFormMensagem.textContent = "";
  try {
    const resp = await fetch("/api/responsaveis", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ senha: senhaDesbloqueada, email }),
    });
    const dados = await resp.json();
    if (!dados.ok) throw new Error(dados.erro || "Falha ao excluir responsável.");
    await renderListaModal();
    mostrarToast(`${email} excluído(a).`, "sucesso");
  } catch (erro) {
    respFormMensagem.textContent = erro.message;
  }
}

respLista.addEventListener("click", (e) => {
  const item = e.target.closest(".resp-pessoa");
  if (!item) return;
  if (e.target.closest(".resp-salvar")) salvarBasesResponsavel(item);
  if (e.target.closest(".resp-remover")) removerResponsavel(item.dataset.email);
});

// Navigation and detail views keep operational features outside the compact home.
let detalheAtivo = 'monitoramento';
function abrirDetalhes(tipo) {
  detalheAtivo = tipo;
  const dialog = document.getElementById('detalhes');
  const corpo = document.getElementById('detalhes-conteudo');
  if (String(tipo).startsWith('cor-rio')) {
    const id = String(tipo).slice('cor-rio:'.length);
    document.getElementById('detalhes-titulo').textContent = Dashboard.corRioTitulo(estadoCorRio, id);
    corpo.innerHTML = Dashboard.corRioDetalhes(estadoCorRio, id);
    Dashboard.aplicarCoresEstagio(corpo);
  } else {
    document.getElementById('detalhes-titulo').textContent = Dashboard.detailsTitle(reportAtual, tipo);
    corpo.innerHTML = Dashboard.details(reportAtual, tipo);
  }
  if (!dialog.open) dialog.showModal();
  else dialog.scrollTop = 0; // trocou de conteúdo com o diálogo aberto
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
