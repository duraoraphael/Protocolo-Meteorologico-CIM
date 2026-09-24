// O .env só é carregado quando o servidor é executado diretamente
// (node server.js). Nos testes, que importam criarApp(), o .env real nunca é
// lido.
const executadoDiretamente = require.main === module;
if (executadoDiretamente) require("dotenv").config();

const express = require("express");
const path = require("path");
const fs = require("fs");

const { getCidade, CIDADES } = require("./src/config/cities");
const { montarRelatorio } = require("./src/logic/reportBuilder");
const { executarPipeline, PASTA_SAIDA } = require("./src/pipeline");
const {
  iniciarAgendamentoDiario,
  agendarEnvioUnicoHoje,
  iniciarMonitorAlertas,
} = require("./src/scheduler");
const responsaveis = require("./src/config/recipients");
const { arquivosLogos } = require("./src/config/logos");
const { problemaSenhaConfigurada, criarComparadorSenha } = require("./src/security/senha");
const { cabecalhosSeguranca } = require("./src/security/cabecalhos");
const { tratadorDeErros, naoEncontrado } = require("./src/security/erros");
const { criarLinksRelatorio, senhaDoBasicAuth } = require("./src/security/linksRelatorio");

// Hospedagens em nuvem (Render, Railway, etc.) definem PORT automaticamente —
// PORTA continua valendo para rodar local/Windows sem mexer no .env.
const PORTA = process.env.PORT || process.env.PORTA || 3210;

/**
 * Monta o app Express com todas as rotas. Não abre porta nem inicia
 * agendamentos — isso fica em iniciarServidor(). Separado para os testes.
 */
function criarApp({
  senhaPainel = process.env.DASHBOARD_PASSWORD,
  cidadeAtiva = process.env.CIDADE || undefined,
  pastaRelatorios = PASTA_SAIDA,
} = {}) {
  const senhaConfere = criarComparadorSenha(senhaPainel);
  const app = express();
  // V-08: não anunciar a tecnologia e aplicar cabeçalhos de segurança
  // (CSP, nosniff, X-Frame-Options, Referrer-Policy) em todas as respostas.
  app.disable("x-powered-by");
  app.use(cabecalhosSeguranca());
  app.use(express.json({ limit: "100kb" }));
  app.use("/api/windy", require("./src/integrations/windyRoutes"));
  app.use("/api/oceanop", require("./src/integrations/oceanopRoutes"));
  app.use(express.static(path.join(__dirname, "public"), { index: "dashboard.html" }));
  // Logos (Petrobras + CIM) ficam em Logo/, na raiz do projeto, fora de
  // public/ — servidos em /logo/<arquivo> para uso no painel e no PDF.
  app.use("/logo", express.static(path.join(__dirname, "Logo")));

  const CIDADE_ATIVA = cidadeAtiva; // usada como base padrão do seletor

  // -----------------------------------------------------------------------
  // Cache curto do "preview" (cards do painel na TV), por base, para não
  // bater nas APIs externas a cada auto-refresh do navegador. Cada base tem
  // sua própria entrada porque o painel agora deixa escolher qual visualizar.
  // -----------------------------------------------------------------------
  const previewCachePorBase = new Map();
  const previewEmAndamento = new Map();
  const PREVIEW_TTL_MS = 10 * 60 * 1000; // 10 minutos

  // Respostas de erro das rotas (V-10/V-09): só mensagens marcadas como
  // públicas (fixas, sem dado interno) vão para o cliente; o resto vira uma
  // mensagem genérica e o detalhe fica só no console do servidor.
  function responderErro(res, erro, contexto, mensagemGenerica = "Erro interno. Consulte o log do servidor.") {
    if (erro && erro.publico) {
      return res.status(erro.status || 400).json({ ok: false, erro: erro.message });
    }
    console.error(`[CIM] ${contexto}:`, erro);
    return res.status(500).json({ ok: false, erro: mensagemGenerica });
  }

  async function obterPreview(cidade) {
    const agora = Date.now();
    const cache = previewCachePorBase.get(cidade.chave);
    if (cache && agora - cache.timestamp < PREVIEW_TTL_MS) {
      return cache.dados;
    }
    if (previewEmAndamento.has(cidade.chave)) return previewEmAndamento.get(cidade.chave);
    const tarefa = montarRelatorio(cidade).then(report => {
      previewCachePorBase.set(cidade.chave, { dados: report, timestamp: Date.now() });
      return report;
    }).finally(() => previewEmAndamento.delete(cidade.chave));
    previewEmAndamento.set(cidade.chave, tarefa);
    return tarefa;
  }

  app.get("/api/preview", async (req, res) => {
    let cidade;
    try {
      cidade = getCidade(req.query.cidade || CIDADE_ATIVA);
    } catch (erro) {
      return res.status(400).json({ ok: false, erro: "Base inválida." });
    }
    try {
      const report = await obterPreview(cidade);
      res.json({ ok: true, report });
    } catch (erro) {
      console.error("[CIM] Erro ao montar o preview:", erro);
      res.status(502).json({ ok: false, erro: "Não foi possível obter os dados meteorológicos agora." });
    }
  });

  // -----------------------------------------------------------------------
  // Geração + envio sob demanda (botão do painel, protegido por senha).
  // Throttle simples em memória para reduzir tentativas de força bruta na
  // senha, já que o painel fica em rede local da sala de operação.
  // -----------------------------------------------------------------------
  const tentativasPorIp = new Map();
  const JANELA_BLOQUEIO_MS = 5 * 60 * 1000;
  const MAX_TENTATIVAS = 5;

  function ipBloqueado(ip) {
    const registro = tentativasPorIp.get(ip);
    if (!registro) return false;
    if (Date.now() - registro.desde > JANELA_BLOQUEIO_MS) {
      tentativasPorIp.delete(ip);
      return false;
    }
    return registro.contagem >= MAX_TENTATIVAS;
  }

  function registrarTentativaFalha(ip) {
    const registro = tentativasPorIp.get(ip) || { contagem: 0, desde: Date.now() };
    registro.contagem += 1;
    tentativasPorIp.set(ip, registro);
  }

  function limparTentativas(ip) {
    tentativasPorIp.delete(ip);
  }

  // Valida a senha operacional com o mesmo throttle anti-força-bruta usado
  // pela geração manual do relatório. Retorna { ok, status, erro } — usado por
  // todos os endpoints que alteram estado (gerar relatório, cadastrar/remover
  // responsável).
  function verificarSenha(req, senha = req.body?.senha) {
    const ip = req.ip;
    if (ipBloqueado(ip)) {
      return {
        ok: false,
        status: 429,
        erro: "Muitas tentativas de senha incorretas. Aguarde alguns minutos e tente novamente.",
      };
    }

    if (!senhaConfere(senha)) {
      registrarTentativaFalha(ip);
      return { ok: false, status: 401, erro: "Senha incorreta." };
    }
    limparTentativas(ip);
    return { ok: true };
  }

  // -----------------------------------------------------------------------
  // PDFs gerados (V-07). Antes eram servidos por express.static sem
  // autenticação e com nome previsível. Agora só com:
  //   - link temporário (?token=...) criado em /api/gerar-relatorio, válido
  //     por 24 h e só para aquele arquivo; ou
  //   - a senha operacional via HTTP Basic (o navegador pede a senha; o nome
  //     de usuário é ignorado), com o mesmo controle de tentativas.
  // -----------------------------------------------------------------------
  const linksRelatorio = criarLinksRelatorio();
  app.locals.linksRelatorio = linksRelatorio;
  const NOME_PDF_VALIDO = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}\.pdf$/;

  app.get("/relatorios/:arquivo", (req, res, next) => {
    const { arquivo } = req.params;
    if (!NOME_PDF_VALIDO.test(arquivo)) {
      return res.status(404).json({ ok: false, erro: "Não encontrado." });
    }

    const token = req.query.token;
    if (!(typeof token === "string" && linksRelatorio.valido(token, arquivo))) {
      const senha = senhaDoBasicAuth(req);
      const checagem = senha === undefined ? { ok: false, status: 401 } : verificarSenha(req, senha);
      if (!checagem.ok) {
        if (checagem.status === 401) {
          res.setHeader("WWW-Authenticate", 'Basic realm="Relatorios CIM", charset="UTF-8"');
        }
        return res.status(checagem.status).json({ ok: false, erro: checagem.erro || "Não autorizado." });
      }
    }

    res.sendFile(
      arquivo,
      { root: pastaRelatorios, dotfiles: "deny", headers: { "Cache-Control": "private, no-store" } },
      (erro) => {
        if (erro && !res.headersSent) next(erro.status === 404 || erro.code === "ENOENT" ? Object.assign(erro, { status: 404 }) : erro);
      }
    );
  });

  let geracaoEmAndamento = false;

  app.post("/api/gerar-relatorio", async (req, res) => {
    const checagem = verificarSenha(req);
    if (!checagem.ok) {
      return res.status(checagem.status).json({ ok: false, erro: checagem.erro });
    }

    if (geracaoEmAndamento) {
      return res.status(409).json({
        ok: false,
        erro: "Já existe uma geração de relatório em andamento. Aguarde a conclusão.",
      });
    }

    let cidadeChave;
    try {
      cidadeChave = getCidade(req.body?.cidade || CIDADE_ATIVA).chave;
    } catch (erro) {
      return res.status(400).json({ ok: false, erro: "Base inválida." });
    }

    geracaoEmAndamento = true;
    try {
      const resultado = await executarPipeline({ cidadeChave, enviarEmail: true });
      // atualiza o cache dessa base na hora, sem esperar o próximo /api/preview
      previewCachePorBase.set(resultado.report.cidade.chave, { dados: resultado.report, timestamp: Date.now() });
      // Link de download com token aleatório, válido por 24 h (V-07).
      const link = resultado.arquivoPdf ? linksRelatorio.gerar(resultado.arquivoPdf) : null;
      res.json({
        ok: true,
        arquivo: resultado.arquivoPdf,
        urlArquivo: link
          ? `/relatorios/${encodeURIComponent(resultado.arquivoPdf)}?token=${link.token}`
          : null,
        linkExpiraEmISO: link ? link.expiraEmISO : null,
        destinatarios: resultado.envio?.destinatarios || [],
        geradoEmISO: resultado.report.geradoEmISO,
        avisosColeta: resultado.report.avisosColeta,
      });
    } catch (erro) {
      console.error("[CIM] Erro ao gerar/enviar relatório sob demanda:", erro);
      res.status(500).json({ ok: false, erro: "Falha ao gerar ou enviar o relatório. Detalhes no log do servidor." });
    } finally {
      geracaoEmAndamento = false;
    }
  });

  app.get("/api/logos", (req, res) => {
    const { petrobras, cim } = arquivosLogos();
    res.json({
      ok: true,
      petrobras: petrobras ? `/logo/${petrobras}` : null,
      cim: cim ? `/logo/${cim}` : null,
    });
  });

  app.get("/api/cidades", (req, res) => {
    res.json({
      ativa: CIDADE_ATIVA || require("./src/config/cities").CIDADE_PADRAO,
      disponiveis: Object.values(CIDADES).map((c) => ({ chave: c.chave, nome: c.nome, uf: c.uf })),
    });
  });

  // -----------------------------------------------------------------------
  // Responsáveis (nome + e-mail) que recebem o informativo de cada base.
  // Leitura pública devolve SÓ OS NOMES (ficam à mostra no painel da TV).
  // E-mails (dado pessoal, V-06) só com a senha operacional, via
  // POST /api/responsaveis/consultar; cadastrar/remover também exige senha.
  // -----------------------------------------------------------------------
  const somenteNomes = (lista) => lista.map((r) => ({ nome: r?.nome }));

  function basesResponsaveis(cidadeChave, { comEmail }) {
    const formatar = comEmail ? (l) => l : somenteNomes;
    if (cidadeChave) {
      const cidade = getCidade(cidadeChave);
      return [{ chave: cidade.chave, nome: cidade.nome, uf: cidade.uf, responsaveis: formatar(responsaveis.listarPorCidade(cidade.chave)) }];
    }
    return responsaveis.listarTodos().map((b) => ({ ...b, responsaveis: formatar(b.responsaveis) }));
  }
  app.post("/api/verificar-senha", (req, res) => {
    const checagem = verificarSenha(req);
    if (!checagem.ok) {
      return res.status(checagem.status).json({ ok: false, erro: checagem.erro });
    }
    res.json({ ok: true });
  });

  app.get("/api/responsaveis", (req, res) => {
    try {
      res.json({ ok: true, bases: basesResponsaveis(req.query.cidade, { comEmail: false }) });
    } catch (erro) {
      responderErro(res, erro, "Erro ao listar responsáveis");
    }
  });

  app.post("/api/responsaveis/consultar", (req, res) => {
    const checagem = verificarSenha(req);
    if (!checagem.ok) {
      return res.status(checagem.status).json({ ok: false, erro: checagem.erro });
    }
    try {
      res.json({ ok: true, bases: basesResponsaveis(req.body?.cidade, { comEmail: true }) });
    } catch (erro) {
      responderErro(res, erro, "Erro ao consultar responsáveis");
    }
  });

  app.post("/api/responsaveis", (req, res) => {
    const checagem = verificarSenha(req);
    if (!checagem.ok) {
      return res.status(checagem.status).json({ ok: false, erro: checagem.erro });
    }
    try {
      const { cidade, nome, email } = req.body || {};
      const lista = responsaveis.adicionar(cidade, nome, email);
      res.json({ ok: true, responsaveis: lista });
    } catch (erro) {
      responderErro(res, erro, "Erro ao cadastrar responsável");
    }
  });

  app.delete("/api/responsaveis", (req, res) => {
    const checagem = verificarSenha(req);
    if (!checagem.ok) {
      return res.status(checagem.status).json({ ok: false, erro: checagem.erro });
    }
    try {
      const { cidade, email } = req.body || {};
      const lista = responsaveis.remover(cidade, email);
      res.json({ ok: true, responsaveis: lista });
    } catch (erro) {
      responderErro(res, erro, "Erro ao remover responsável");
    }
  });

  // V-09: 404 em JSON para rotas desconhecidas e handler final que nunca
  // expõe stack trace (JSON malformado, corpo grande demais etc.).
  app.use(naoEncontrado);
  app.use(tratadorDeErros);

  return app;
}

function iniciarServidor() {
  // V-02: sem senha forte definida no ambiente, o painel não sobe.
  const problema = problemaSenhaConfigurada(process.env.DASHBOARD_PASSWORD);
  if (problema) {
    console.error(
      `[CIM] ${problema} O servidor não foi iniciado. Defina no .env ou no ambiente ` +
        "uma DASHBOARD_PASSWORD com pelo menos 12 caracteres (recomendado: 16+ aleatórios)."
    );
    process.exit(1);
  }

  const app = criarApp();
  app.listen(PORTA, () => {
    console.log(`[CIM] Painel disponível em http://localhost:${PORTA}`);
    iniciarAgendamentoDiario();
    agendarEnvioUnicoHoje();
    iniciarMonitorAlertas();
  });
}

if (executadoDiretamente) iniciarServidor();

module.exports = { criarApp, iniciarServidor };

