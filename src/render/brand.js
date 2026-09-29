// Paleta e identidade visual do Informativo. Centralizado aqui para que o
// PDF e o e-mail fiquem sempre visualmente consistentes entre si e entre
// execuções diárias.
const status = Object.freeze({
  NORMAL: Object.freeze({ cor: "#FBC02D", fundo: "#FFFDE7" }),
  "ATENÇÃO": Object.freeze({ cor: "#F57C00", fundo: "#FFF3E0" }),
  ALERTA: Object.freeze({ cor: "#D32F2F", fundo: "#FFEBEE" }),
  "EMERGÊNCIA": Object.freeze({ cor: "#B71C1C", fundo: "#FFEBEE" }),
});

module.exports = {
  verde: "#00843D",
  verdeEscuro: "#00612C",
  amarelo: "#FFCC00",
  cinzaTexto: "#333333",
  cinzaClaro: "#F2F2F2",
  cinzaBorda: "#DDDDDD",
  vermelhoAlerta: "#C0392B",
  status,
  statusVisual(grau) {
    return status[grau] || status.NORMAL;
  },
  fontePrincipal:
    "'Calibri', 'Segoe UI', Arial, sans-serif",
};
