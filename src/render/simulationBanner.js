function simulado(documento) {
  return Boolean(documento?.simulado || documento?.procedencia?.simulado);
}

function faixaSimulacaoEmail(documento) {
  if (!simulado(documento)) return "";
  return '<tr><td align="center" bgcolor="#B91C1C" style="padding:12px 16px;background:#B91C1C;color:#FFFFFF;font:bold 18px/1.3 Arial,sans-serif;letter-spacing:.4px;">SIMULAÇÃO — NÃO ENVIAR</td></tr>';
}

function faixaSimulacaoDocumento(documento) {
  if (!simulado(documento)) return "";
  return '<div style="margin:0 0 12px;padding:10px 14px;background:#B91C1C;color:#FFFFFF;text-align:center;font:bold 16pt/1.2 Arial,sans-serif;letter-spacing:.5px;">SIMULAÇÃO — NÃO ENVIAR</div>';
}

module.exports = { faixaSimulacaoEmail, faixaSimulacaoDocumento };
