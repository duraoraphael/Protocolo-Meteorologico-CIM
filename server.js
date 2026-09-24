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
} = {}) {
  const senhaConfere = criarComparadorSenha(senhaPainel);
  const app = express();
  app.use(express.json());
  app.use("/api/windy", require("./src/integrations/windyRoutes"));
  app.use("/api/oceanop", require("./src/integrations/oceanopRoutes"));
  app.use(express.static(path.join(__dirname, "public"), { index: "dashboard.html" }));
  app.use("/relatorios", express.static(PASTA_SAIDA));
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

  async function obterPreview(cidadeChave) {
    const cidade = getCidade(cidadeChave);
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
    try {
      const report = await obterPreview(req.query.cidade || CIDADE_ATIVA);
      res.json({ ok: true, report });
    } catch (erro) {
      res.status(502).json({ ok: false, erro: erro.message });
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
  function verificarSenha(req) {
    const ip = req.ip;
    if (ipBloqueado(ip)) {
      return {
        ok: false,
        status: 429,
        erro: "Muitas tentativas de senha incorretas. Aguarde alguns minutos e tente novamente.",
      };
    }

    const { senha } = req.body || {};

    if (!senhaConfere(senha)) {
      registrarTentativaFalha(ip);
      return { ok: false, status: 401, erro: "Senha incorreta." };
    }
    limparTentativas(ip);
    return { ok: true };
  }

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

    geracaoEmAndamento = true;
    try {
      const cidadeChave = req.body?.cidade || CIDADE_ATIVA;
      const resultado = await executarPipeline({ cidadeChave, enviarEmail: true });
      // atualiza o cache dessa base na hora, sem esperar o próximo /api/preview
      previewCachePorBase.set(resultado.report.cidade.chave, { dados: resultado.report, timestamp: Date.now() });
      res.json({
        ok: true,
        arquivo: resultado.arquivoPdf,
        urlArquivo: `/relatorios/${resultado.arquivoPdf}`,
        destinatarios: resultado.envio?.destinatarios || [],
        geradoEmISO: resultado.report.geradoEmISO,
        avisosColeta: resultado.report.avisosColeta,
      });
    } catch (erro) {
      console.error("[CIM] Erro ao gerar/enviar relatório sob demanda:", erro);
      res.status(500).json({ ok: false, erro: erro.message });
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
  // Leitura é pública (fica à mostra no painel da TV); cadastrar/remover
  // exige a mesma senha operacional do botão de gerar relatório.
  // -----------------------------------------------------------------------
  app.post("/api/verificar-senha", (req, res) => {
    const checagem = verificarSenha(req);
    if (!checagem.ok) {
      return res.status(checagem.status).json({ ok: false, erro: checagem.erro });
    }
    res.json({ ok: true });
  });

  app.get("/api/responsaveis", (req, res) => {
    try {
      if (req.query.cidade) {
        const cidade = getCidade(req.query.cidade);
        return res.json({
          ok: true,
          bases: [{ chave: cidade.chave, nome: cidade.nome, uf: cidade.uf, responsaveis: responsaveis.listarPorCidade(cidade.chave) }],
        });
      }
      res.json({ ok: true, bases: responsaveis.listarTodos() });
    } catch (erro) {
      res.status(400).json({ ok: false, erro: erro.message });
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
      res.status(400).json({ ok: false, erro: erro.message });
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
      res.status(400).json({ ok: false, erro: erro.message });
    }
  });

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

