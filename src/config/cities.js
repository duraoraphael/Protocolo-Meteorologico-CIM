// Cadastro de instalações/bases monitoradas pelo CIM.
// Para adicionar uma nova instalação, copie um bloco, ajuste os dados e
// inclua a chave na lista CIDADE_ATIVA (env CIDADE) ou selecione no painel.
//
// codigoIbge: código IBGE de 7 dígitos usado pela API de previsão do INMET
// (mesmo código usado na URL publica https://previsao.inmet.gov.br/<codigo>).
// Códigos e coordenadas conferidos em servicodados.ibge.gov.br e OpenStreetMap.
// climaSaudeUrl: página municipal pública conferida por HTTP 200 e título da
// localidade. Campo manual; não derivar URL automaticamente da chave da base.
// integracaoCorRio: exibe o painel de comunicados e estágio do COR-Rio. O
// COR-Rio cobre só o município do Rio de Janeiro — não habilitar em outras bases.

const CIDADES = {
  rio_de_janeiro: {
    chave: "rio_de_janeiro",
    costeira: true,
    nome: "Rio de Janeiro",
    uf: "RJ",
    latitude: -22.9068,
    longitude: -43.1729,
    pontoMar: { latitude: -23.10, longitude: -43.12, referencia: "Atlântico ao sul da costa do Rio de Janeiro" },
    codigoIbge: "3304557",
    climaSaudeUrl: "https://clima.saude.gov.br/rj/rio-de-janeiro?modo=ehf",
    integracaoCorRio: true,
    links: {
      inmet: "https://previsao.inmet.gov.br/3304557",
      alertaRio:
        "https://websempre.rio.rj.gov.br/procedimentos/previsao/mural/boletim",
      corRio: "https://cor.rio/category/estagios/",
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
    pontoMar: { latitude: -22.40, longitude: -41.70, referencia: "Atlântico a leste da costa de Macaé" },
    codigoIbge: "3302403",
    climaSaudeUrl: "https://clima.saude.gov.br/rj/macae?modo=ehf",
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
    climaSaudeUrl: "https://clima.saude.gov.br/df/brasilia?modo=ehf",
    links: {
      inmet: "https://previsao.inmet.gov.br/5300108",
      defesaCivilTelefone: "199",
    },
  },

  manaus: {
    chave: "manaus",
    nome: "Manaus",
    uf: "AM",
    // Fuso IANA da localidade (padrão: America/Sao_Paulo). Define o dia civil
    // local da seção "Previsão para os próximos 3 dias".
    fusoHorario: "America/Manaus",
    latitude: -3.1316333,
    longitude: -59.9825041,
    codigoIbge: "1302603",
    climaSaudeUrl: "https://clima.saude.gov.br/am/manaus?modo=ehf",
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
    pontoMar: { latitude: -24.10, longitude: -46.25, referencia: "Atlântico ao largo de Santos" },
    codigoIbge: "3548500",
    climaSaudeUrl: "https://clima.saude.gov.br/sp/santos?modo=ehf",
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
    fusoHorario: "America/Maceio",
    latitude: -10.9162061,
    longitude: -37.0774655,
    pontoMar: { latitude: -11.05, longitude: -36.98, referencia: "Atlântico ao largo de Aracaju" },
    codigoIbge: "2800308",
    climaSaudeUrl: "https://clima.saude.gov.br/se/aracaju?modo=ehf",
    links: {
      inmet: "https://previsao.inmet.gov.br/2800308",
      defesaCivilTelefone: "199",
    },
  },

  natal: {
    chave: "natal",
    costeira: true,
    nome: "Natal",
    uf: "RN",
    fusoHorario: "America/Fortaleza",
    latitude: -5.8115,
    longitude: -35.2415,
    pontoMar: { latitude: -5.82, longitude: -35.10, referencia: "Atlântico a leste de Natal" },
    codigoIbge: "2408102",
    climaSaudeUrl: "https://clima.saude.gov.br/rn/natal?modo=ehf",
    links: {
      inmet: "https://previsao.inmet.gov.br/2408102",
      defesaCivilTelefone: "199",
    },
  },

  oiapoque: {
    chave: "oiapoque",
    costeira: true,
    nome: "Oiapoque",
    uf: "AP",
    fusoHorario: "America/Belem",
    latitude: 3.861224,
    longitude: -51.796699,
    pontoMar: { latitude: 4.10, longitude: -51.20, referencia: "Atlântico na costa do Amapá, referência para Oiapoque" },
    codigoIbge: "1600501",
    climaSaudeUrl: "https://clima.saude.gov.br/ap/oiapoque?modo=ehf",
    links: {
      inmet: "https://previsao.inmet.gov.br/1600501",
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
    pontoMar: { latitude: -20.38, longitude: -40.20, referencia: "Atlântico ao largo de Vitória" },
    codigoIbge: "3205309",
    climaSaudeUrl: "https://clima.saude.gov.br/es/vitoria?modo=ehf",
    links: {
      inmet: "https://previsao.inmet.gov.br/3205309",
      defesaCivilTelefone: "199",
    },
  },

  araucaria: {
    chave: "araucaria",
    nome: "Wenceslau Bráz",
    uf: "PR",
    // 23°52'05.5"S, 49°48'16.2"W. A chave "araucaria" é mantida por
    // compatibilidade com destinatários, .env e histórico.
    latitude: -23.868194,
    longitude: -49.8045,
    codigoIbge: "4128500",
    climaSaudeUrl: "https://clima.saude.gov.br/pr/wenceslau-braz?modo=ehf",
    links: {
      inmet: "https://previsao.inmet.gov.br/4128500",
      defesaCivilTelefone: "199",
    },
  },

  salvador: {
    chave: "salvador",
    costeira: true,
    nome: "Salvador",
    uf: "BA",
    fusoHorario: "America/Bahia",
    latitude: -12.9777,
    longitude: -38.5016,
    pontoMar: { latitude: -13.05, longitude: -38.30, referencia: "Atlântico a leste de Salvador" },
    codigoIbge: "2927408",
    climaSaudeUrl: "https://clima.saude.gov.br/ba/salvador?modo=ehf",
    links: {
      inmet: "https://previsao.inmet.gov.br/2927408",
      codesal: "https://codesal.salvador.ba.gov.br/",
      defesaCivilTelefone: "199",
    },
  },
};

// Cidade usada por padrão quando a env CIDADE não é definida.
const CIDADE_PADRAO = "rio_de_janeiro";

// Chaves de base válidas: só letras minúsculas e "_", 2 a 40 caracteres, e
// que existam como propriedade PRÓPRIA de CIDADES (V-10). Object.hasOwn
// impede que "constructor", "__proto__", "toString" etc. passem pela
// validação por serem herdadas do protótipo.
const CHAVE_BASE_REGEX = /^[a-z_]{2,40}$/;

function baseExiste(chave) {
  return typeof chave === "string" && CHAVE_BASE_REGEX.test(chave) && Object.hasOwn(CIDADES, chave);
}

/** Erro com mensagem genérica, seguro para devolver ao cliente (HTTP 400). */
function erroBaseInvalida() {
  return Object.assign(new Error("Base inválida."), { status: 400, publico: true, code: "BASE_INVALIDA" });
}

function getCidade(chave) {
  const efetiva = chave === undefined || chave === null || chave === "" ? CIDADE_PADRAO : chave;
  if (!baseExiste(efetiva)) throw erroBaseInvalida();
  return CIDADES[efetiva];
}

module.exports = { CIDADES, CIDADE_PADRAO, getCidade, baseExiste, erroBaseInvalida };
