const express = require('express');
const { CIDADES, CIDADE_PADRAO } = require('../config/cities');
const router = express.Router();
router.get('/map-config', (req,res) => {
  res.set('Cache-Control','no-store');
  // Compatibility response for old map links. Never expose the server-side key.
  res.json({ok:true,configurado:false,key:null,
    mensagem:'Mapa Windy desativado. A integração utiliza somente WINDY_API_KEY no servidor.',
    ativa:process.env.CIDADE||CIDADE_PADRAO,
    bases:Object.values(CIDADES).map(({chave,nome,uf,latitude,longitude})=>({chave,nome,uf,latitude,longitude}))});
});
module.exports=router;
