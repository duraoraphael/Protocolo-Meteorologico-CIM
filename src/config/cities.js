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
    codigoIbge: "3304557",
    climatempo: { localeIdEnv: "CLIMATEMPO_LOCALE_ID_RIO_DE_JANEIRO", municipio: "Rio de Janeiro" },
    climaSaudeUrl: "https://clima.saude.gov.br/rj/rio-de-janeiro?modo=ehf",
    integracaoCorRio: true,
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
    climatempo: { localeIdEnv: "CLIMATEMPO_LOCALE_ID_MACAE", municipio: "Macaé" },
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
    climatempo: { localeIdEnv: "CLIMATEMPO_LOCALE_ID_BRASILIA", municipio: "Brasília" },
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
    climatempo: { localeIdEnv: "CLIMATEMPO_LOCALE_ID_MANAUS", municipio: "Manaus" },
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
    codigoIbge: "3548500",
    climatempo: { localeIdEnv: "CLIMATEMPO_LOCALE_ID_SANTOS", municipio: "Santos" },
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
    latitude: -10.9162061,
    longitude: -37.0774655,
    codigoIbge: "2800308",
    climatempo: { localeIdEnv: "CLIMATEMPO_LOCALE_ID_ARACAJU", municipio: "Aracaju" },
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
    codigoIbge: "2408102",
    climatempo: { localeIdEnv: "CLIMATEMPO_LOCALE_ID_NATAL", municipio: "Natal" },
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
    codigoIbge: "1600501",
    climatempo: { localeIdEnv: "CLIMATEMPO_LOCALE_ID_OIAPOQUE", municipio: "Oiapoque" },
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
    codigoIbge: "3205309",
    climatempo: { localeIdEnv: "CLIMATEMPO_LOCALE_ID_VITORIA", municipio: "Vitória" },
    climaSaudeUrl: "https://clima.saude.gov.br/es/vitoria?modo=ehf",
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
    // A validação do retorno exige explicitamente Araucária/PR; um ID de
    // Wenceslau Braz ou de qualquer outra cidade é rejeitado.
    climatempo: { localeIdEnv: "CLIMATEMPO_LOCALE_ID_ARAUCARIA", municipio: "Araucária" },
    climaSaudeUrl: "https://clima.saude.gov.br/pr/araucaria?modo=ehf",
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
    climatempo: { localeIdEnv: "CLIMATEMPO_LOCALE_ID_SALVADOR", municipio: "Salvador" },
    climaSaudeUrl: "https://clima.saude.gov.br/ba/salvador?modo=ehf",
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
