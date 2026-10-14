function valorFinito(valor) {
  return Number.isFinite(valor) ? valor : null;
}

function periodosDoRelatorio(report, tipo) {
  const prontos = tipo === "vento" ? report?.ventoPorPeriodo : report?.chuvaPorPeriodo;
  if (Array.isArray(prontos) && prontos.length) return prontos;
  return Object.values(report?.periodos || {}).filter(Boolean);
}

function periodoDoMaiorValor(report, tipo) {
  const campos = tipo === "vento"
    ? ["rajadaMaxKmh"]
    : ["precipitacaoHorariaMaxMm", "precipitacaoMm"];
  let selecionado = null;
  let maior = -Infinity;
  for (const periodo of periodosDoRelatorio(report, tipo)) {
    const valor = campos.map((campo) => valorFinito(periodo?.[campo])).find((item) => item !== null);
    if (valor !== undefined && valor !== null && valor > maior) {
      maior = valor;
      selecionado = periodo;
    }
  }
  if (!selecionado) return null;
  const nome = selecionado.periodo || null;
  const janela = selecionado.janela || null;
  return [nome, janela ? `(${janela})` : null].filter(Boolean).join(" ") || null;
}

function fontesUnicas(...fontes) {
  return [...new Set(fontes.flat().filter((fonte) =>
    typeof fonte === "string" && fonte.trim() && fonte !== "Indisponível"
  ).map((fonte) => fonte.trim()))];
}

function contextoVento(report) {
  const rajada = valorFinito(report?.rajadaMaxKmh);
  if (rajada === null) return null;
  const fontes = fontesUnicas(
    report?.fontesPorCampo?.rajadaMaxKmh,
    Object.entries(report?.fontesPorCampo || {})
      .filter(([campo]) => /^periodos\..+\.rajadaMaxKmh$/.test(campo))
      .map(([, fonte]) => fonte)
  );
  return {
    detalhe: `Rajada prevista: ${rajada} km/h`,
    janela: periodoDoMaiorValor(report, "vento"),
    fonteDados: fontes.join(" / ") || "Previsão meteorológica integrada",
  };
}

function contextoChuva(report) {
  const horaria = valorFinito(report?.precipitacaoHorariaMaxMm);
  const diaria = valorFinito(report?.precipitacaoTotalMm);
  if (horaria === null && diaria === null) return null;
  const partes = [];
  if (horaria !== null) partes.push(`Intensidade horária máxima prevista: ${horaria} mm/h`);
  if (diaria !== null) partes.push(`Acumulado diário previsto: ${diaria} mm`);
  const fontes = fontesUnicas(
    report?.fontesPorCampo?.precipitacaoHorariaMaxMm,
    report?.fontesPorCampo?.precipitacaoTotalMm,
    Object.entries(report?.fontesPorCampo || {})
      .filter(([campo]) => /^periodos\..+\.precipitacao(?:HorariaMaxMm|Mm)$/.test(campo))
      .map(([, fonte]) => fonte)
  );
  return {
    detalhe: partes.join(" · "),
    janela: periodoDoMaiorValor(report, "chuva"),
    fonteDados: fontes.join(" / ") || "Previsão meteorológica integrada",
  };
}

function contextoPrevisao(report, fenomeno) {
  if (fenomeno === "vento") return contextoVento(report);
  if (fenomeno === "chuva") return contextoChuva(report);
  if (fenomeno === "tempestade") {
    const vento = contextoVento(report);
    const chuva = contextoChuva(report);
    if (!vento && !chuva) return null;
    return {
      detalhe: [chuva?.detalhe, vento?.detalhe].filter(Boolean).join(" · "),
      janela: chuva?.janela || vento?.janela || null,
      fonteDados: fontesUnicas(chuva?.fonteDados, vento?.fonteDados).join(" / "),
    };
  }
  return null;
}

module.exports = { contextoPrevisao, periodoDoMaiorValor };
