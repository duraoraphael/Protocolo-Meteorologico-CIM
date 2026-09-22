const express = require('express');
const { buscarOceanop } = require('../sources/oceanop');
const { CIDADES } = require('../config/cities');
const vinculos = require('../config/oceanopAreas');
const router = express.Router();
router.get('/areas', (_req,res) => res.json({ok:true,areas:Object.values(CIDADES).map(c=>({chave:c.chave,nome:c.nome,uf:c.uf,local:vinculos[c.chave]?.local || ''}))}));
router.get('/previsao', async (req,res) => {
  res.set('Cache-Control','no-store');
  try {
    const resultado = await buscarOceanop(req.query.local);
    res.json({ok:true,...resultado});
  } catch (erro) {
    res.status(erro.status === 400 ? 400 : 502).json({ok:false,erro:erro.message});
  }
});
module.exports = router;

