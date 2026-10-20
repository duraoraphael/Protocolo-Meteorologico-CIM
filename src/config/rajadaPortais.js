// Páginas indicadas para a coleta de rajada prevista. Apenas correspondências
// geográficas e usos automatizados confirmados ficam habilitados.

const TT_BASE = "https://petrobras.ttforecast.com.br/bulletin/forecast-chart/Terrestre";

function tetraTech(areaName, slug, fusoHorario = "America/Sao_Paulo", extra = {}) {
  return Object.freeze({
    fonte: "tetratech",
    habilitado: true,
    areaName,
    tipo: "Terrestre",
    pagina: `${TT_BASE}/${slug}`,
    fusoHorario,
    ...extra,
  });
}

module.exports = Object.freeze({
  rio_de_janeiro: tetraTech("Rio de Janeiro", "Rio%20de%20Janeiro"),
  manaus: tetraTech("Manaus", "Manaus", "America/Manaus"),
  macae: tetraTech("Macaé", "Maca%C3%A9"),
  brasilia: tetraTech("Brasília", "Bras%C3%ADlia"),
  santos: tetraTech("Santos", "Santos"),
  vitoria: tetraTech("Vitória", "Vit%C3%B3ria"),
  salvador: tetraTech("Salvador", "Salvador"),
  natal: tetraTech("Natal", "Natal", "America/Fortaleza"),
  oiapoque: tetraTech("Oiapoque", "Oiapoque", "America/Belem"),

  // A página indicada é de Wenceslau Bráz, não de Araucária. Mantida
  // desabilitada até a equivalência meteorológica ser formalmente validada.
  araucaria: tetraTech("Wenceslau Bráz", "Wenceslau%20Br%C3%A1z", "America/Sao_Paulo", {
    habilitado: false,
    motivo: "Correspondência Araucária/Wenceslau Bráz não validada.",
  }),

  // Os termos públicos do Climatempo vedam robôs e extração automatizada.
  // Ativar somente com API/licença escrita que autorize coleta e redistribuição.
  aracaju: Object.freeze({
    fonte: "climatempo",
    habilitado: false,
    pagina: "https://www.climatempo.com.br/previsao-do-tempo/15-dias/cidade/384/aracaju-se",
    fusoHorario: "America/Sao_Paulo",
    motivo: "Scraping automatizado não autorizado pelos termos públicos; requer API/licença.",
  }),
});
