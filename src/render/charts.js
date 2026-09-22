// Gráficos do relatório semanal.
//
// Dois formatos deliberadamente diferentes:
//
// - SVG (svgTemperatura, svgChuva...): usado no PDF. O Puppeteer é um Chrome
//   completo, então renderiza SVG perfeitamente e o resultado fica vetorial
//   (nítido em qualquer zoom/impressão).
//
// - Barras em tabela HTML (barraHtml): usadas no E-MAIL. Gmail, Outlook e
//   boa parte dos clientes REMOVEM <svg> por segurança — um gráfico SVG
//   simplesmente sumiria no e-mail. Barras feitas com <td> e background-color
//   são o que funciona de forma confiável em todos eles.

const brand = require("./brand");

const CORES = {
  critico: "#C0392B",
  atencao: "#E67E22",
  normal: "#00843D",
  chuva: "#2E86C1",
  temperatura: "#E74C3C",
  temperaturaMin: "#5DADE2",
  vento: "#7D3C98",
  grade: "#DDDDDD",
  texto: "#333333",
  textoSuave: "#777777",
};

function esc(v) {
  if (v === null || v === undefined) return "";
  return String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ---------------------------------------------------------------------------
// SVG — para o PDF
// ---------------------------------------------------------------------------

/**
 * Gráfico combinado de temperatura (linhas máx/mín) e chuva (barras) ao longo
 * dos dias. É o gráfico principal de cada base no PDF.
 */
function svgTemperaturaEChuva(dias, largura = 720, altura = 200) {
  if (!dias.length) return "";

  const margem = { topo: 18, direita: 44, baixo: 34, esquerda: 40 };
  const larguraUtil = largura - margem.esquerda - margem.direita;
  const alturaUtil = altura - margem.topo - margem.baixo;
  const passo = larguraUtil / dias.length;

  // Temperatura e chuva ocupam FAIXAS SEPARADAS do gráfico: a linha de
  // temperatura vive na parte de cima, as barras de chuva na de baixo. Quando
  // os dois dividiam a mesma área, os rótulos de milímetros caíam em cima da
  // linha justamente nos dias de chuva forte — os mais importantes de ler.
  const faixaTemp = alturaUtil * 0.6;
  const faixaChuva = alturaUtil * 0.3;
  const baseChuva = margem.topo + alturaUtil;

  const temps = dias.flatMap((d) => [d.tempMin, d.tempMax]).filter((v) => v != null);
  const tMin = Math.floor(Math.min(...temps) - 1);
  const tMax = Math.ceil(Math.max(...temps) + 1);
  const escalaT = (v) => margem.topo + faixaTemp - ((v - tMin) / (tMax - tMin || 1)) * faixaTemp;

  const chuvaMax = Math.max(...dias.map((d) => d.precipitacaoMm || 0), 10);
  const escalaChuva = (v) => (v / chuvaMax) * faixaChuva;

  const centroX = (i) => margem.esquerda + passo * i + passo / 2;

  // Barras de chuva (fundo)
  const barras = dias
    .map((d, i) => {
      const h = escalaChuva(d.precipitacaoMm || 0);
      if (h <= 0) return "";
      const larguraBarra = Math.min(passo * 0.5, 30);
      return `<rect x="${centroX(i) - larguraBarra / 2}" y="${baseChuva - h}"
        width="${larguraBarra}" height="${h}" fill="${CORES.chuva}" opacity="0.55" rx="2" />`;
    })
    .join("");

  // Rótulo do volume DENTRO da barra, junto à base. Colocá-lo acima da barra
  // fazia o texto colidir com a linha de temperatura justamente nos dias de
  // chuva forte — que são os que mais importam ler.
  const rotulosChuva = dias
    .map((d, i) => {
      const mm = d.precipitacaoMm || 0;
      if (mm < 1) return "";
      const h = escalaChuva(mm);
      const cabeDentro = h >= 18;
      return `<text x="${centroX(i)}" y="${cabeDentro ? baseChuva - 5 : baseChuva - h - 3}"
        text-anchor="middle" font-size="8.5" font-weight="bold"
        fill="${cabeDentro ? "#ffffff" : CORES.chuva}">${mm}mm</text>`;
    })
    .join("");

  const linha = (campo, cor) => {
    const pontos = dias
      .map((d, i) => (d[campo] == null ? null : `${centroX(i)},${escalaT(d[campo])}`))
      .filter(Boolean)
      .join(" ");
    return `<polyline points="${pontos}" fill="none" stroke="${cor}" stroke-width="2.2"
      stroke-linejoin="round" stroke-linecap="round" />`;
  };

  const pontosELabels = (campo, cor, deslocamentoY) =>
    dias
      .map((d, i) => {
        if (d[campo] == null) return "";
        const y = escalaT(d[campo]);
        return `<circle cx="${centroX(i)}" cy="${y}" r="3" fill="${cor}" />
          <text x="${centroX(i)}" y="${y + deslocamentoY}" text-anchor="middle"
            font-size="9.5" font-weight="bold" fill="${cor}">${d[campo]}°</text>`;
      })
      .join("");

  // Faixa de fundo marcando fim de semana
  const fundoFimDeSemana = dias
    .map((d, i) =>
      d.ehFimDeSemana
        ? `<rect x="${margem.esquerda + passo * i}" y="${margem.topo}" width="${passo}"
             height="${alturaUtil}" fill="#000000" opacity="0.04" />`
        : ""
    )
    .join("");

  const eixoX = dias
    .map(
      (d, i) => `<text x="${centroX(i)}" y="${altura - 14}" text-anchor="middle" font-size="9.5"
        fill="${d.ehFimDeSemana ? CORES.textoSuave : CORES.texto}" font-weight="${d.ehFimDeSemana ? "normal" : "bold"}">${d.diaSemana}</text>
      <text x="${centroX(i)}" y="${altura - 3}" text-anchor="middle" font-size="8"
        fill="${CORES.textoSuave}">${d.diaMes}</text>`
    )
    .join("");

  // Marcadores de severidade no topo de cada dia
  const severidades = dias
    .map(
      (d, i) =>
        `<rect x="${centroX(i) - 14}" y="4" width="28" height="4" rx="2" fill="${d.severidade.cor}" />`
    )
    .join("");

  return `<svg width="${largura}" height="${altura}" viewBox="0 0 ${largura} ${altura}"
    xmlns="http://www.w3.org/2000/svg" font-family="Arial, sans-serif">
    ${fundoFimDeSemana}
    ${severidades}
    <line x1="${margem.esquerda}" y1="${baseChuva}" x2="${largura - margem.direita}"
      y2="${baseChuva}" stroke="${CORES.grade}" stroke-width="1" />
    ${barras}
    ${rotulosChuva}
    ${linha("tempMax", CORES.temperatura)}
    ${linha("tempMin", CORES.temperaturaMin)}
    ${pontosELabels("tempMax", CORES.temperatura, -7)}
    ${pontosELabels("tempMin", CORES.temperaturaMin, 14)}
    ${eixoX}
  </svg>`;
}

/**
 * Barras horizontais empilhadas: quantas bases estão em cada nível de
 * severidade, dia a dia. Responde "qual dia da semana será o pior".
 */
function svgPanoramaSemana(panoramaDias, largura = 720, altura = 150) {
  if (!panoramaDias.length) return "";

  const margem = { topo: 16, direita: 16, baixo: 34, esquerda: 16 };
  const larguraUtil = largura - margem.esquerda - margem.direita;
  const alturaUtil = altura - margem.topo - margem.baixo;
  const passo = larguraUtil / panoramaDias.length;
  const larguraBarra = Math.min(passo * 0.6, 54);

  const total = (d) => d.basesCriticas + d.basesAtencao + d.basesNormais || 1;

  const colunas = panoramaDias
    .map((d, i) => {
      const x = margem.esquerda + passo * i + (passo - larguraBarra) / 2;
      const t = total(d);
      const hCritico = (d.basesCriticas / t) * alturaUtil;
      const hAtencao = (d.basesAtencao / t) * alturaUtil;
      const hNormal = (d.basesNormais / t) * alturaUtil;
      let y = margem.topo;

      const partes = [];
      if (hCritico > 0) {
        partes.push(`<rect x="${x}" y="${y}" width="${larguraBarra}" height="${hCritico}" fill="${CORES.critico}" />`);
        if (d.basesCriticas > 0 && hCritico > 12)
          partes.push(`<text x="${x + larguraBarra / 2}" y="${y + hCritico / 2 + 4}" text-anchor="middle"
            font-size="11" font-weight="bold" fill="#fff">${d.basesCriticas}</text>`);
        y += hCritico;
      }
      if (hAtencao > 0) {
        partes.push(`<rect x="${x}" y="${y}" width="${larguraBarra}" height="${hAtencao}" fill="${CORES.atencao}" />`);
        if (hAtencao > 12)
          partes.push(`<text x="${x + larguraBarra / 2}" y="${y + hAtencao / 2 + 4}" text-anchor="middle"
            font-size="11" font-weight="bold" fill="#fff">${d.basesAtencao}</text>`);
        y += hAtencao;
      }
      if (hNormal > 0) {
        partes.push(`<rect x="${x}" y="${y}" width="${larguraBarra}" height="${hNormal}" fill="${CORES.normal}" />`);
        if (hNormal > 12)
          partes.push(`<text x="${x + larguraBarra / 2}" y="${y + hNormal / 2 + 4}" text-anchor="middle"
            font-size="11" font-weight="bold" fill="#fff">${d.basesNormais}</text>`);
      }

      partes.push(`<text x="${x + larguraBarra / 2}" y="${altura - 14}" text-anchor="middle"
        font-size="10" font-weight="bold" fill="${CORES.texto}">${d.diaSemana}</text>`);
      partes.push(`<text x="${x + larguraBarra / 2}" y="${altura - 3}" text-anchor="middle"
        font-size="8.5" fill="${CORES.textoSuave}">${d.diaMes}</text>`);

      return partes.join("");
    })
    .join("");

  return `<svg width="${largura}" height="${altura}" viewBox="0 0 ${largura} ${altura}"
    xmlns="http://www.w3.org/2000/svg" font-family="Arial, sans-serif">${colunas}</svg>`;
}

/** Fita compacta de 7 quadrados coloridos — a "cara" da semana de uma base. */
function svgFitaSeveridade(dias, largura = 150, altura = 22) {
  const passo = largura / dias.length;
  const quadrados = dias
    .map(
      (d, i) =>
        `<rect x="${i * passo + 1}" y="2" width="${passo - 2}" height="${altura - 4}" rx="2"
          fill="${d.severidade.cor}" />`
    )
    .join("");
  return `<svg width="${largura}" height="${altura}" viewBox="0 0 ${largura} ${altura}"
    xmlns="http://www.w3.org/2000/svg">${quadrados}</svg>`;
}

// ---------------------------------------------------------------------------
// HTML/tabela — para o E-MAIL (sem SVG, que Gmail/Outlook removem)
// ---------------------------------------------------------------------------

/** Barra proporcional feita com <td>, segura em qualquer cliente de e-mail. */
function barraHtml(valor, maximo, cor, larguraTotal = 120) {
  const proporcao = maximo > 0 ? Math.min(valor / maximo, 1) : 0;
  const preenchido = Math.round(proporcao * larguraTotal);
  const vazio = larguraTotal - preenchido;
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
    <tr>
      ${preenchido > 0 ? `<td style="width:${preenchido}px;height:10px;background:${cor};border-radius:2px;font-size:0;line-height:0;">&nbsp;</td>` : ""}
      ${vazio > 0 ? `<td style="width:${vazio}px;height:10px;background:#EDEFEE;border-radius:2px;font-size:0;line-height:0;">&nbsp;</td>` : ""}
    </tr>
  </table>`;
}

/** Fita de severidade da semana, em células de tabela (versão e-mail). */
function fitaSeveridadeHtml(dias) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:separate;border-spacing:2px;">
    <tr>${dias
      .map(
        (d) =>
          `<td style="width:16px;height:16px;background:${d.severidade.cor};border-radius:3px;font-size:0;line-height:0;">&nbsp;</td>`
      )
      .join("")}</tr>
    <tr>${dias
      .map(
        (d) =>
          `<td style="font-size:8px;color:${CORES.textoSuave};text-align:center;font-family:Arial,sans-serif;">${esc(d.diaSemana[0])}</td>`
      )
      .join("")}</tr>
  </table>`;
}

module.exports = {
  CORES,
  svgTemperaturaEChuva,
  svgPanoramaSemana,
  svgFitaSeveridade,
  barraHtml,
  fitaSeveridadeHtml,
};
