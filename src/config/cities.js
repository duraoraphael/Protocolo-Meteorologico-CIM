// Cadastro de instalações/bases monitoradas pelo CIM.
// Para adicionar uma nova instalação, copie um bloco, ajuste os dados e
// inclua a chave na lista CIDADE_ATIVA (env CIDADE) ou selecione no painel.
//
// codigoIbge: código IBGE de 7 dígitos usado pela API de previsão do INMET
// (mesmo código usado na URL publica https://previsao.inmet.gov.br/<codigo>).
// Códigos e coordenadas conferidos em servicodados.ibge.gov.br e OpenStreetMap.

const CIDADES = {
  rio_de_janeiro: {
    chave: "rio_de_janeiro",
    costeira: true,
    nome: "Rio de Janeiro",
    uf: "RJ",
    latitude: -22.9068,
    longitude: -43.1729,
    codigoIbge: "3304557",
    links: {
      inmet: "https://previsao.inmet.gov.br/3304557",
      alertaRio:
        "https://websempre.rio.rj.gov.br/procedimentos/previsao/mural/boletim",
      corRio: "https://cor.rio/category/estagios/",
      climatempo:
        "https://www.climatempo.com.br/previsao-do-tempo/15-dias/cidade/321/riodejaneiro-rj",
      defesaCivilTelefone: "199",
    },
  },

  macae: {
    chave: "macae",
    costeira: true,
    nome: "Macaé",
    uf: "RJ",
    latitude: -22.2828305,
    longitude: -41.9649091,
    codigoIbge: "3302403",
    links: {
      inmet: "https://previsao.inmet.gov.br/3302403",
      defesaCivilTelefone: "199",
    },
  },

  cabiunas: {
    chave: "cabiunas",
    costeira: true,
    nome: "Cabiúnas (Terminal)",
    uf: "RJ",
    // Coordenadas do Terminal de Cabiúnas (Petrobras/Transpetro), distrito de
    // Macaé — mais precisas que o centro do município para a base numérica
    // (Open-Meteo). A previsão oficial do INMET é por município, então usa o
    // mesmo código IBGE de Macaé (não existe código IBGE próprio de distrito).
    latitude: -22.2877258,
    longitude: -41.719347,
    codigoIbge: "3302403",
    links: {
      inmet: "https://previsao.inmet.gov.br/3302403",
      defesaCivilTelefone: "199",
    },
  },

  brasilia: {
    chave: "brasilia",
    nome: "Brasília",
    uf: "DF",
    latitude: -15.7939869,
    longitude: -47.8828,
    codigoIbge: "5300108",
    links: {
      inmet: "https://previsao.inmet.gov.br/5300108",
      defesaCivilTelefone: "199",
    },
  },

  manaus: {
    chave: "manaus",
    nome: "Manaus",
    uf: "AM",
    latitude: -3.1316333,
    longitude: -59.9825041,
    codigoIbge: "1302603",
    links: {
      inmet: "https://previsao.inmet.gov.br/1302603",
      defesaCivilTelefone: "199",
    },
  },

  santos: {
    chave: "santos",
    costeira: true,
    nome: "Santos",
    uf: "SP",
    latitude: -23.9609448,
    longitude: -46.3166316,
    codigoIbge: "3548500",
    links: {
      inmet: "https://previsao.inmet.gov.br/3548500",
      defesaCivilTelefone: "199",
    },
  },

  aracaju: {
    chave: "aracaju",
    costeira: true,
    nome: "Aracaju",
    uf: "SE",
    latitude: -10.9162061,
    longitude: -37.0774655,
    codigoIbge: "2800308",
    links: {
      inmet: "https://previsao.inmet.gov.br/2800308",
      defesaCivilTelefone: "199",
    },
  },

  linhares: {
    chave: "linhares",
    costeira: true,
    nome: "Linhares",
    uf: "ES",
    latitude: -19.3796775,
    longitude: -40.0610087,
    // O centro de Linhares fica ~50 km da costa, fora da grade do modelo de
    // ondas. O litoral do município (foz do Rio Doce, em Regência) é o ponto
    // usado só para os dados de mar — a previsão de tempo continua sendo a
    // do município.
    pontoMar: { latitude: -19.6486, longitude: -39.8258, referencia: "Regência (foz do Rio Doce)" },
    codigoIbge: "3203205",
    links: {
      inmet: "https://previsao.inmet.gov.br/3203205",
      defesaCivilTelefone: "199",
    },
  },

  anchieta: {
    chave: "anchieta",
    costeira: true,
    nome: "Anchieta",
    uf: "ES",
    latitude: -20.8057672,
    longitude: -40.6454564,
    codigoIbge: "3200409",
    links: {
      inmet: "https://previsao.inmet.gov.br/3200409",
      defesaCivilTelefone: "199",
    },
  },

  vitoria: {
    chave: "vitoria",
    costeira: true,
    nome: "Vitória",
    uf: "ES",
    latitude: -20.3200917,
    longitude: -40.3376682,
    codigoIbge: "3205309",
    links: {
      inmet: "https://previsao.inmet.gov.br/3205309",
      defesaCivilTelefone: "199",
    },
  },

  araucaria: {
    chave: "araucaria",
    nome: "Araucária",
    uf: "PR",
    latitude: -25.5861107,
    longitude: -49.4051209,
    codigoIbge: "4101804",
    links: {
      inmet: "https://previsao.inmet.gov.br/4101804",
      defesaCivilTelefone: "199",
    },
  },

  salvador: {
    chave: "salvador",
    costeira: true,
    nome: "Salvador",
    uf: "BA",
    latitude: -12.9777,
    longitude: -38.5016,
    codigoIbge: "2927408",
    links: {
      inmet: "https://previsao.inmet.gov.br/2927408",
      codesal: "https://codesal.salvador.ba.gov.br/",
      climatempo:
        "https://www.climatempo.com.br/previsao-do-tempo/15-dias/cidade/56/salvador-ba",
      defesaCivilTelefone: "199",
    },
  },
};

// Cidade usada por padrão quando a env CIDADE não é definida.
const CIDADE_PADRAO = "rio_de_janeiro";

function getCidade(chave) {
  const c = CIDADES[chave || CIDADE_PADRAO];
  if (!c) {
    throw new Error(
      `Cidade "${chave}" não cadastrada em src/config/cities.js. Cidades disponíveis: ${Object.keys(CIDADES).join(", ")}`
    );
  }
  return c;
}

module.exports = { CIDADES, CIDADE_PADRAO, getCidade };
