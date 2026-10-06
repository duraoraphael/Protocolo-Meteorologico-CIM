// Gera as logos do cabeçalho institucional (e-mail e PDF) a partir dos
// arquivos originais em Logo/:
//   - Logo/Logo_PDF.png  -> src/assets/header/cim-header.png
//   - Logo/Petrobras_horizontal_logo.svg.png -> src/assets/header/petrobras-header.png
//
// Petrobras: a logo colorida (fundo transparente) vai num cartão branco de
// cantos arredondados, embutido na própria imagem — assim o cartão aparece
// igual em Gmail, Outlook e no PDF, sem depender de padding/border-radius.
//
// CIM:
// O verde de fundo de cada logo é substituído exatamente pelo verde do
// cabeçalho (o fundo do próprio petrobras.png), para que as imagens fiquem
// integradas ao header sem retângulo de cor diferente. Bordas suavizadas são
// recompostas pela mistura fundo/tinta, sem serrilhado. As margens vazias
// são recortadas; as proporções da marca são preservadas.
//
// Uso: node scripts/gerarLogosHeader.js
const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer");
const { HEADER_VERDE } = require("../src/config/headerAssets");

const RAIZ = path.join(__dirname, "..");
const DESTINO = path.join(RAIZ, "src", "assets", "header");

const TRABALHOS = [
  { origem: "Logo/Logo_PDF.png", destino: "cim-header.png", larguraFinal: 960, folga: 0.05 },
];

const CARTAO_PETROBRAS = {
  origem: "Logo/Petrobras_horizontal_logo.svg.png",
  destino: "petrobras-header.png",
  larguraFinal: 640,
  margemX: 40,
  margemY: 28,
  raio: 18,
};

async function cartaoBranco(pagina, { origem, larguraFinal, margemX, margemY, raio }) {
  const uri = `data:image/png;base64,${fs.readFileSync(path.join(RAIZ, origem)).toString("base64")}`;
  return pagina.evaluate(async ({ uri, larguraFinal, margemX, margemY, raio }) => {
    const img = new Image();
    img.src = uri;
    await img.decode();
    const tela = document.createElement("canvas");
    tela.width = img.width;
    tela.height = img.height;
    const ctx = tela.getContext("2d");
    ctx.drawImage(img, 0, 0);
    // Recorta as margens transparentes, preservando a proporção da marca.
    const d = ctx.getImageData(0, 0, img.width, img.height).data;
    let minX = img.width, minY = img.height, maxX = 0, maxY = 0;
    for (let y = 0; y < img.height; y++) {
      for (let x = 0; x < img.width; x++) {
        if (d[(y * img.width + x) * 4 + 3] > 8) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    const sw = maxX - minX + 1, sh = maxY - minY + 1;
    const larguraLogo = larguraFinal - 2 * margemX;
    const alturaLogo = Math.round(sh * (larguraLogo / sw));
    const saida = document.createElement("canvas");
    saida.width = larguraFinal;
    saida.height = alturaLogo + 2 * margemY;
    const s = saida.getContext("2d");
    s.fillStyle = "#ffffff";
    s.beginPath();
    s.roundRect(0, 0, saida.width, saida.height, raio);
    s.fill();
    s.imageSmoothingEnabled = true;
    s.imageSmoothingQuality = "high";
    s.drawImage(tela, minX, minY, sw, sh, margemX, margemY, larguraLogo, alturaLogo);
    return { png: saida.toDataURL("image/png").split(",")[1], largura: saida.width, altura: saida.height };
  }, { uri, larguraFinal, margemX, margemY, raio });
}

function hexParaRgb(hex) {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

async function processar(pagina, { origem, larguraFinal, folga }) {
  const uri = `data:image/png;base64,${fs.readFileSync(path.join(RAIZ, origem)).toString("base64")}`;
  return pagina.evaluate(async ({ uri, novoFundo, larguraFinal, folga }) => {
    const img = new Image();
    img.src = uri;
    await img.decode();
    const w = img.width;
    const h = img.height;
    const tela = document.createElement("canvas");
    tela.width = w;
    tela.height = h;
    const ctx = tela.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const dados = ctx.getImageData(0, 0, w, h);
    const d = dados.data;

    // Fundo original: mediana das bordas da imagem.
    const borda = [];
    for (let x = 0; x < w; x += 4) borda.push((x) * 4, ((h - 1) * w + x) * 4);
    for (let y = 0; y < h; y += 4) borda.push((y * w) * 4, (y * w + w - 1) * 4);
    const mediana = (canal) => {
      const v = borda.map((i) => d[i + canal]).sort((a, b) => a - b);
      return v[v.length >> 1];
    };
    const fundo = [mediana(0), mediana(1), mediana(2)];

    // Tintas da marca: branco e (se existir) o amarelo do "I" do CIM.
    const amarelos = [];
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] > 200 && d[i + 1] > 150 && d[i + 2] < 90) amarelos.push(i);
    }
    const tintas = [[255, 255, 255]];
    if (amarelos.length > 500) {
      const med = (c) => {
        const v = amarelos.map((i) => d[i + c]).sort((a, b) => a - b);
        return v[v.length >> 1];
      };
      tintas.push([med(0), med(1), med(2)]);
    }

    // Para cada pixel: escolhe a tinta cuja reta fundo→tinta melhor explica a
    // cor, estima a cobertura (alfa) e recompõe sobre o novo fundo.
    const alfas = new Float32Array(w * h);
    let minX = w, minY = h, maxX = 0, maxY = 0;
    for (let p = 0, i = 0; p < w * h; p += 1, i += 4) {
      const dr = d[i] - fundo[0], dg = d[i + 1] - fundo[1], db = d[i + 2] - fundo[2];
      let melhor = null;
      for (const t of tintas) {
        const vr = t[0] - fundo[0], vg = t[1] - fundo[1], vb = t[2] - fundo[2];
        const k = (dr * vr + dg * vg + db * vb) / (vr * vr + vg * vg + vb * vb);
        const er = dr - k * vr, eg = dg - k * vg, eb = db - k * vb;
        const residuo = er * er + eg * eg + eb * eb;
        if (!melhor || residuo < melhor.residuo) melhor = { residuo, k, t };
      }
      let a = Math.min(1, Math.max(0, melhor.k));
      if (a < 0.08) a = 0;
      else if (a > 0.92) a = 1;
      alfas[p] = a;
      d[i] = Math.round(a * melhor.t[0] + (1 - a) * novoFundo[0]);
      d[i + 1] = Math.round(a * melhor.t[1] + (1 - a) * novoFundo[1]);
      d[i + 2] = Math.round(a * melhor.t[2] + (1 - a) * novoFundo[2]);
      d[i + 3] = 255;
      if (a > 0.5) {
        const x = p % w, y = (p / w) | 0;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    ctx.putImageData(dados, 0, 0);

    const margem = Math.round((maxY - minY) * folga);
    const sx = Math.max(0, minX - margem), sy = Math.max(0, minY - margem);
    const sw = Math.min(w, maxX + margem + 1) - sx, sh = Math.min(h, maxY + margem + 1) - sy;
    const escala = larguraFinal / sw;
    const saida = document.createElement("canvas");
    saida.width = larguraFinal;
    saida.height = Math.round(sh * escala);
    const sctx = saida.getContext("2d");
    sctx.fillStyle = `rgb(${novoFundo.join(",")})`;
    sctx.fillRect(0, 0, saida.width, saida.height);
    sctx.imageSmoothingEnabled = true;
    sctx.imageSmoothingQuality = "high";
    sctx.drawImage(tela, sx, sy, sw, sh, 0, 0, saida.width, saida.height);
    return {
      png: saida.toDataURL("image/png").split(",")[1],
      largura: saida.width,
      altura: saida.height,
      fundoOriginal: fundo,
      tintas,
    };
  }, { uri, novoFundo: hexParaRgb(HEADER_VERDE), larguraFinal, folga });
}

(async () => {
  fs.mkdirSync(DESTINO, { recursive: true });
  const navegador = await puppeteer.launch({ headless: true });
  try {
    const pagina = await navegador.newPage();
    for (const trabalho of TRABALHOS) {
      const r = await processar(pagina, trabalho);
      fs.writeFileSync(path.join(DESTINO, trabalho.destino), Buffer.from(r.png, "base64"));
      console.log(`${trabalho.destino}: ${r.largura}x${r.altura} (fundo original rgb(${r.fundoOriginal}), tintas ${JSON.stringify(r.tintas)})`);
    }
    const cartao = await cartaoBranco(pagina, CARTAO_PETROBRAS);
    fs.writeFileSync(path.join(DESTINO, CARTAO_PETROBRAS.destino), Buffer.from(cartao.png, "base64"));
    console.log(`${CARTAO_PETROBRAS.destino}: ${cartao.largura}x${cartao.altura} (cartão branco)`);
  } finally {
    await navegador.close();
  }
})().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
