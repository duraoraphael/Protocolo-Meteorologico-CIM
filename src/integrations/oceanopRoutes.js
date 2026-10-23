const express = require("express");
const { buscarOceanopPorCoordenadas, validarPonto, obterDiagnosticoOceanop } = require("../sources/oceanop");
const { CIDADES } = require("../config/cities");
const pontos = require("../config/oceanopPontos");

function pontoHabilitado(chave) {
  const ponto = pontos[chave];
  return ponto?.habilitado === true ? ponto : null;
}

function criarOceanopRouter({ verificarSenha } = {}) {
  if (typeof verificarSenha !== "function") throw new TypeError("OCEANOP: verificador de acesso obrigatório.");
  const router = express.Router();

  // A listagem pública não revela identificadores locais corporativos.
  router.get("/areas", (_req, res) => res.json({
    ok: true,
    areas: Object.values(CIDADES).map((cidade) => ({
      chave: cidade.chave,
      nome: cidade.nome,
      uf: cidade.uf,
      habilitado: Boolean(pontoHabilitado(cidade.chave)),
    })),
  }));

  // A previsão bruta e o diagnóstico ficam sob a mesma senha operacional
  // usada pelas demais ações restritas do painel.
  router.post("/previsao", async (req, res) => {
    res.set("Cache-Control", "no-store");
    const acesso = await verificarSenha(req, req.body?.senha);
    if (!acesso.ok) return res.status(acesso.status).json({ ok: false, erro: acesso.erro });
    try {
      const chave = String(req.body?.cidade || "").trim();
      if (!CIDADES[chave]) return res.status(400).json({ ok: false, erro: "Base CIM inválida." });
      const ponto = pontoHabilitado(chave);
      if (!ponto) {
        return res.status(409).json({
          ok: false,
          erro: "Esta base ainda não possui ponto OCEANOP autorizado e homologado.",
        });
      }
      validarPonto(ponto);
      const resultado = await buscarOceanopPorCoordenadas(ponto);
      res.json({ ok: true, cidade: chave, ...resultado, diagnostico: obterDiagnosticoOceanop() });
    } catch (erro) {
      res.status(erro.status === 400 ? 400 : 502).json({
        ok: false,
        erro: "Não foi possível obter uma previsão OCEANOP válida.",
        diagnostico: obterDiagnosticoOceanop(),
      });
    }
  });

  return router;
}

module.exports = { criarOceanopRouter };
