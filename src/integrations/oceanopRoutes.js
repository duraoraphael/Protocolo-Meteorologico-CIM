const express = require("express");
const { buscarOceanop, validarPonto } = require("../sources/oceanop");
const { CIDADES } = require("../config/cities");
const pontos = require("../config/oceanopAreas");

const router = express.Router();

function pontoHabilitado(chave) {
  const ponto = pontos[chave];
  return ponto?.habilitado === true ? ponto : null;
}

router.get("/areas", (_req, res) => res.json({
  ok: true,
  areas: Object.values(CIDADES).map((cidade) => {
    const ponto = pontoHabilitado(cidade.chave);
    return {
      chave: cidade.chave,
      nome: cidade.nome,
      uf: cidade.uf,
      pointId: ponto?.ID || ponto?.pointId || "",
      habilitado: Boolean(ponto),
    };
  }),
}));

router.get("/previsao", async (req, res) => {
  res.set("Cache-Control", "no-store");
  try {
    const chave = String(req.query.cidade || "").trim();
    if (!CIDADES[chave]) return res.status(400).json({ ok: false, erro: "Base CIM inválida." });
    const ponto = pontoHabilitado(chave);
    if (!ponto) {
      return res.status(409).json({
        ok: false,
        erro: "Esta base ainda não possui ponto OCEANOP autorizado e homologado.",
      });
    }
    validarPonto(ponto);
    const resultado = await buscarOceanop([ponto]);
    res.json({ ok: true, cidade: chave, ...resultado });
  } catch (erro) {
    res.status(erro.status === 400 ? 400 : 502).json({ ok: false, erro: erro.message });
  }
});

module.exports = router;
