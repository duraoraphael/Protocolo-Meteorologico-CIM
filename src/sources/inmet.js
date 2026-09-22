// Fonte: INMET — API pública oficial (sem necessidade de chave), usada como
// fonte OFICIAL de validação cruzada e como fonte de avisos de perigo
// (equivalente aos alertas de Defesa Civil coordenados nacionalmente).
//
// Endpoints confirmados manualmente em 25/08/2026:
//   Previsão por município (código IBGE): https://apiprevmet3.inmet.gov.br/previsao/<codigoIbge>
//   Avisos de perigo ativos (nacional):    https://apiprevmet3.inmet.gov.br/avisos/ativos
//
// OBS: apitempo.inmet.gov.br (usado em versões antigas de tutoriais) está
// fora do ar / não resolve mais rotas de previsão — não usar.

const HEADERS = { "User-Agent": "Mozilla/5.0 (ProtocoloMeteorologicoCIM/1.0)" };

function hojeDDMMAAAA() {
  const agora = new Date(
    new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" })
  );
  const dd = String(agora.getDate()).padStart(2, "0");
  const mm = String(agora.getMonth() + 1).padStart(2, "0");
  const yyyy = agora.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

async function buscarPrevisaoInmet(codigoIbge) {
  const url = `https://apiprevmet3.inmet.gov.br/previsao/${codigoIbge}`;
  const resposta = await fetch(url, {
    headers: HEADERS,
    signal: AbortSignal.timeout(15000),
  });
  if (!resposta.ok) {
    throw new Error(`INMET (previsão) respondeu HTTP ${resposta.status}`);
  }
  const json = await resposta.json();
  const porData = json[codigoIbge];
  if (!porData) {
    throw new Error(`INMET não retornou previsão para o código ${codigoIbge}`);
  }

  const dataAlvo = hojeDDMMAAAA();
  const diaEscolhido = porData[dataAlvo] || porData[Object.keys(porData)[0]];
  if (!diaEscolhido) {
    throw new Error("INMET retornou payload sem períodos de previsão");
  }

  const limpar = (p) =>
    p && {
      resumo: p.resumo || null,
      tempMax: p.temp_max ?? null,
      tempMin: p.temp_min ?? null,
      umidadeMax: p.umidade_max ?? null,
      umidadeMin: p.umidade_min ?? null,
      direcaoVento: p.dir_vento || null,
      intensidadeVento: p.int_vento || null,
    };

  return {
    fonte: "INMET (previsão oficial)",
    url: `https://previsao.inmet.gov.br/${codigoIbge}`,
    data: dataAlvo,
    periodos: {
      manha: limpar(diaEscolhido.manha),
      tarde: limpar(diaEscolhido.tarde),
      noite: limpar(diaEscolhido.noite),
    },
  };
}

async function buscarAvisosInmet(codigoIbge) {
  const url = "https://apiprevmet3.inmet.gov.br/avisos/ativos";
  const resposta = await fetch(url, {
    headers: HEADERS,
    signal: AbortSignal.timeout(15000),
  });
  if (!resposta.ok) {
    throw new Error(`INMET (avisos) respondeu HTTP ${resposta.status}`);
  }
  const json = await resposta.json();
  const todosHoje = json.hoje || [];

  const relevantes = todosHoje.filter((aviso) => {
    const geocodes = (aviso.geocodes || "").split(",");
    return geocodes.includes(String(codigoIbge));
  });

  return {
    fonte: "INMET (avisos de perigo ativos)",
    url: "https://apiprevmet3.inmet.gov.br/avisos/ativos",
    totalAvisosPais: todosHoje.length,
    avisos: relevantes.map((a) => ({
      descricao: a.descricao,
      severidade: a.severidade,
      cor: a.aviso_cor,
      inicio: a.inicio,
      fim: a.fim,
      riscos: a.riscos || [],
      instrucoes: a.instrucoes || [],
    })),
  };
}

module.exports = { buscarPrevisaoInmet, buscarAvisosInmet };
