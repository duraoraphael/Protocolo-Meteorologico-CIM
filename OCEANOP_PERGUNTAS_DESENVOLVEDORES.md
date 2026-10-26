# OCEANOP — integração do CIM e perguntas para a equipe da API

Documento para a equipe de desenvolvimento do OCEANOP. Descreve como o
Protocolo Meteorológico CIM consome o endpoint de previsão por pontos e lista o
que precisamos confirmar para ativar a integração em produção.

## 1. Objetivo

Usar a **rajada de vento prevista** do OCEANOP nos informativos do CIM (painel,
PDF e e-mail das 08h e 15h) e nos alertas, para 11 bases: Rio de Janeiro,
Macaé, Brasília, Manaus, Santos, Aracaju, Natal, Oiapoque, Vitória, Wenceslau Bráz e
Salvador. Quando o OCEANOP não responde, o sistema usa a Open-Meteo como
contingência e indica a fonte utilizada.

## 2. Situação atual

Último teste real (22/10/2026): DNS, TCP/443 e TLS funcionam, o Swagger abre
(HTTP 200), mas o `POST` com as coordenadas da base retorna **HTTP 401**. O
sistema não enviou nenhuma credencial porque não sabemos qual é o método de
autenticação. Por isso ainda não foi possível validar uma resposta real.

## 3. Como o CIM chama a API hoje

Cada base é consultada de um destes modos (tabela na seção 7.4). Modo
`coordenadas` (Rio, Santos, Aracaju, Oiapoque, Vitória, Salvador), uma
requisição por base e por ciclo de coleta:

```
POST https://oceanop-api-disp.petrobras.com.br/api/v1/previsao/JsonPrevisaoPorListaDePontosLatLonAsync
Accept: application/json
Content-Type: application/json
X-API-Key: <OCEANOP_API_KEY>             (somente se configurada)
Authorization: Bearer <OCEANOP_ACCESS_TOKEN>   (somente se configurado)

[ { "ID": "santos", "Lat": -23.9609448, "Lon": -46.3166316 } ]
```

Modo `area` (Macaé, Natal, Brasília): `GET .../JsonPrevisaoAreaAsync?local=<nome>`
com os mesmos cabeçalhos, usando só os locais aceitos da resposta. Manaus e
a base Manaus não tem ponto cadastrado e usa apenas a Open-Meteo.

- `ID`: hoje enviamos a chave interna da base (`santos`, `macae`, `brasilia`…).
- `Lat`/`Lon`: coordenadas oficiais da base (`src/config/cities.js`).
- As credenciais ficam só no servidor (variáveis de ambiente), nunca no
  navegador, em logs ou no repositório.
- TLS sempre validado; redirecionamentos recusados; timeout de 15 s;
  retentativas apenas para falhas transitórias; cache de 5 minutos por base e
  deduplicação de chamadas simultâneas. Com 11 bases, o volume esperado é de
  no máximo cerca de uma chamada por base a cada 5 minutos.

## 4. Como a resposta é usada

Campos lidos (os demais são ignorados): `PointID`, `Local`, `DataInicial`,
`DataFinal`, `DataEscrita`, `DirecaoVento`, `VelocidadeVento`,
`VelocidadeVento_10M_Rajada`.

1. **Validação:** a resposta só é aceita com HTTP 2xx, `success: true`, `data`
   em array e `PointID` igual ao `ID` enviado. `Local` é só o nome do campo e
   pode ser diferente (como em "P-68" → "Sururu" na documentação). Resposta de
   outro ponto é descartada. Números com vírgula decimal são aceitos; valores
   fora de faixa (ex.: direção > 360) viram "sem dado".
2. **Unidade:** o payload não declara a unidade, então ela vem de configuração
   (`OCEANOP_UNIDADE_VENTO`, padrão `nós`). A rajada é convertida para km/h
   (m/s × 3,6; nós × 1,852).
3. **Horário:** `DataInicial`/`DataFinal` (`dd/mm/aaaa hh:mm:ss`) são
   interpretados em **UTC** (`OCEANOP_FUSO_DADOS`), pois a resposta não informa
   o fuso; a janela por edição e a divisão manhã/tarde/noite usam o horário
   local da base. UTC foi deduzido comparando com a Open-Meteo hora a hora.
4. **Janela por edição:** informativo das 08h usa 08h–15h; o das 15h usa
   15h–00h; as demais edições seguem a janela da edição. Só entram registros
   que ainda não terminaram.
5. **Rajada usada:** a maior `VelocidadeVento_10M_Rajada` da janela, por
   período do dia (manhã 05–12h, tarde 12–18h, noite 18–00h) e no total. Ficam
   registrados fonte ("Petrobras — OCEANOP"), ponto, horário do pico e o
   intervalo do registro.
6. **Próximos 3 dias:** máxima diária da rajada, por data local da base.
7. **Prioridade e contingência:** onde há rajada válida do OCEANOP, ela
   substitui a da Open-Meteo. Onde não há (falha, 401, sem registros), a
   Open-Meteo é mantida e a falha aparece no monitoramento das APIs do painel.
   Nada é inventado nem misturado entre bases.
8. `VelocidadeVento_50M_Rajada` e demais campos de vento por altura, ondas,
   temperatura etc. **não são usados** por enquanto.

Código: `src/sources/oceanop.js` (consulta, validação e janelas),
`src/config/oceanopPontos.js` (ponto de cada base),
`src/logic/weatherSourcePolicy.js` (prioridade da rajada) e
`src/logic/reportBuilder.js` (integração ao relatório). Testes em
`tests/oceanop.test.js`.

## 5. Perguntas para a equipe do OCEANOP

1. **Autenticação.** Qual é o esquema (chave `X-API-Key`, Bearer token, OAuth,
   certificado, liberação por IP/rede)? Como solicitamos acesso para o serviço
   do CIM?
2. **Credencial de serviço.** A API aceita conta/chave técnica? O envio é
   automático (08h, 15h e monitor de alertas a cada 5 min), então um token
   pessoal que expira não atende.
3. **ID do ponto.** O `ID` aceita qualquer texto (hoje `santos`, `macae`…) ou
   só unidades cadastradas, como "P-68"? Para bases em terra (Brasília,
   Manaus), existe ponto equivalente ou a previsão por coordenada é válida?
4. **Unidade do vento.** `VelocidadeVento` e `VelocidadeVento_10M_Rajada` vêm em
   nós, m/s ou km/h? Concluímos que é nós (comparação com a Open-Meteo e com os 20 nós do site); confirmam?
5. **Fuso.** `DataInicial` e `DataFinal` estão em horário local ou UTC? E
   `DataEscrita`?
6. **Cobertura da resposta.** Quantas horas ou dias à frente a previsão cobre?
   Com que frequência o modelo é atualizado?
7. **Limites de uso.** Há limite de chamadas por minuto/dia? O volume previsto
   do CIM (item 3) é aceitável?
8. **Campos vazios.** Quando `VelocidadeVento_10M_Rajada` vem vazio ou o ponto
   está fora da área de cobertura, qual é o comportamento esperado (campo vazio,
   erro, `success: false`)?
9. **Ambiente.** `oceanop-api-disp` é de produção ou de homologação? Existe
   outro endereço para produção?

## 6. Como ativar e testar (assim que houver credencial)

1. No `.env` do servidor (nunca no repositório), preencher o que a equipe
   OCEANOP indicar:
   ```
   OCEANOP_API_KEY=...            # enviada em X-API-Key
   OCEANOP_ACCESS_TOKEN=...       # enviado em Authorization: Bearer
   OCEANOP_UNIDADE_VENTO=nós      # nós, m/s ou km/h
   # Alternativa: login usuário/senha (HTTP Basic), usado só se chave e token estiverem vazios
   OCEANOP_USUARIO=...
   OCEANOP_SENHA=...
   ```
2. Teste manual de uma base (não imprime credenciais):
   `node --use-system-ca scripts/testarOceanop.js santos`
   Sem credencial, hoje o resultado é `HTTP_401`.
3. Reiniciar o servidor. O monitoramento de APIs do painel passa a exibir
   "Petrobras — OCEANOP" como operacional ou indisponível.

## 7. Anexo — código atual

### 7.1 Chamada à API e despacho por base (`src/sources/oceanop.js`)

```js
// Modo "coordenadas": POST com ID/Lat/Lon. A API só responde para coordenadas
// exatamente cadastradas; ponto desconhecido volta com `data` vazio.
async function buscarOceanopPorCoordenadas(ponto, opcoes = {}) {
  const o = { ...PADRAO_HTTP, ...opcoes };
  const consulta = validarPonto(ponto);
  const chave = `ponto:${normalizarIdentificador(consulta.id)}:${consulta.latitude}:${consulta.longitude}`;
  return consultarComCache(chave, o, async () => {
    const json = await buscarJsonComRetentativa(ENDPOINT_PONTOS, {
      ...opcoesHttp(ponto, o),
      requestInit: {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json", ...cabecalhosAutorizacao(o.env), ...o.headers },
        body: JSON.stringify([{ ID: consulta.id, Lat: consulta.latitude, Lon: consulta.longitude }]),
        redirect: "error",
      },
    });
    const previsoes = normalizarResposta(json, { fusoHorario: fusoDosDados(ponto) });
    validarPontoRetornado(previsoes, consulta.id);
    return { endpoint: ENDPOINT_PONTOS, modo: "coordenadas", consulta, previsoes };
  });
}

// Modo "area": GET por nome de área, para bases sem coordenada cadastrada. A
// resposta não tem PointID e pode trazer vários locais; só os de
// `locaisAceitos` (ex.: "Macaé", "Macaé (SBME)") são usados.
async function buscarOceanopPorArea(ponto, opcoes = {}) {
  const o = { ...PADRAO_HTTP, ...opcoes };
  const local = texto(ponto?.localArea, 100);
  if (!local || !Array.isArray(ponto?.locaisAceitos) || !ponto.locaisAceitos.length) {
    throw erroConfiguracao("OCEANOP: área sem nome ou locais aceitos.", "OCEANOP_INVALID_AREA");
  }
  return consultarComCache(`area:${normalizarIdentificador(local)}`, o, async () => {
    const url = new URL(ENDPOINT_AREA);
    url.searchParams.set("local", local);
    const json = await buscarJsonComRetentativa(url, {
      ...opcoesHttp(ponto, o),
      requestInit: { method: "GET", headers: { Accept: "application/json", ...cabecalhosAutorizacao(o.env), ...o.headers }, redirect: "error" },
    });
    const aceitos = new Set(ponto.locaisAceitos.map(normalizarIdentificador));
    const previsoes = normalizarResposta(json, { fusoHorario: fusoDosDados(ponto) }).filter((p) => aceitos.has(normalizarIdentificador(p.local)));
    if (!previsoes.length) throw erroParser("OCEANOP não retornou o local esperado para esta área; a resposta foi descartada.", "OCEANOP_NO_COVERAGE");
    return { endpoint: ENDPOINT_AREA, modo: "area", consulta: { local }, previsoes };
  });
}

// Ponto único de entrada: cada base declara seu `modo` em oceanopPontos.js.
function buscarOceanopDaBase(ponto, opcoes = {}) {
  if (ponto?.habilitado !== true) {
    return Promise.reject(erroConfiguracao(ponto?.motivo || "OCEANOP: base sem ponto cadastrado.", "OCEANOP_NOT_CONFIGURED"));
  }
  return ponto.modo === "area" ? buscarOceanopPorArea(ponto, opcoes) : buscarOceanopPorCoordenadas(ponto, opcoes);
}
```

### 7.2 Cabeçalhos de autenticação

```js
function cabecalhosAutorizacao(env = process.env) {
  const apiKey = String(env.OCEANOP_API_KEY || "").trim();
  const accessToken = String(env.OCEANOP_ACCESS_TOKEN || "").trim();
  const usuario = String(env.OCEANOP_USUARIO || "").trim();
  const senha = String(env.OCEANOP_SENHA || "");
  const basic = !apiKey && !accessToken && usuario && senha
    ? { Authorization: `Basic ${Buffer.from(`${usuario}:${senha}`, "utf8").toString("base64")}` }
    : {};
  return {
    ...(apiKey ? { "X-API-Key": apiKey } : {}),
    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    ...basic,
  };
}
```

### 7.3 Validação do ponto retornado

```js
// O retorno só é aceito se pertencer ao ponto solicitado. O PointID é o
// identificador contratual; `Local` é apenas o nome do campo/plataforma.
function validarPontoRetornado(previsoes, id) {
  const esperado = normalizarIdentificador(id);
  if (!previsoes.length) {
    throw erroParser("OCEANOP não possui previsão cadastrada para estas coordenadas.", "OCEANOP_NO_COVERAGE");
  }
  if (previsoes.some((p) => normalizarIdentificador(p.pointId) !== esperado)) {
    throw erroParser("OCEANOP retornou dados de outro ponto; a resposta foi descartada.", "OCEANOP_POINT_MISMATCH");
  }
}
```

### 7.4 Acesso de cada base (`src/config/oceanopPontos.js`)

```js
const { CIDADES } = require("./cities");
const { unidadeVelocidadeSuportada } = require("../logic/windUnits");

// Unidade do vento/rajada do OCEANOP (a resposta não a declara): nós, confirmado
// ao comparar com a Open-Meteo (erro ~3–6 km/h em nós; ~20 km/h se fosse m/s).
// Ajustável por OCEANOP_UNIDADE_VENTO (nós, m/s ou km/h).
function unidadeVento(env = process.env) {
  const bruta = String(env.OCEANOP_UNIDADE_VENTO || "nós").trim();
  return unidadeVelocidadeSuportada(bruta) ? bruta : "nós";
}
// Fuso de DataInicial/DataFinal. A resposta não o declara; UTC é o que melhor
// reproduz a Open-Meteo hora a hora. Ajustável por OCEANOP_FUSO_DADOS (IANA).
function fusoDados(env = process.env) {
  return String(env.OCEANOP_FUSO_DADOS || "UTC").trim() || "UTC";
}

// Como cada base é consultada no OCEANOP. O ID enviado é livre (a API o devolve
// como PointID), mas a coordenada precisa ser exatamente uma cadastrada:
//  - coordenadas: POST por Lat/Lon (Rio, Santos, Aracaju, Oiapoque, Vitória, Salvador);
//  - area: GET por nome de área, com os locais aceitos na resposta;
//  - sem ponto: base ainda não cadastrada no OCEANOP — usa a Open-Meteo.
const ACESSO = Object.freeze({
  rio_de_janeiro: { modo: "coordenadas" },
  santos: { modo: "coordenadas" },
  aracaju: { modo: "coordenadas" },
  oiapoque: { modo: "coordenadas" },
  vitoria: { modo: "coordenadas" },
  salvador: { modo: "coordenadas" },
  macae: { modo: "area", localArea: "macaé", locaisAceitos: ["Macaé", "Macaé (SBME)"] },
  natal: { modo: "area", localArea: "Natal", locaisAceitos: ["Natal"] },
  brasilia: { modo: "area", localArea: "Brasília", locaisAceitos: ["Brasília"] },
  manaus: { modo: "ausente", motivo: "Manaus ainda não tem ponto cadastrado no OCEANOP (coordenada e nome de área não retornam dados)." },
  araucaria: { modo: "area", localArea: "Wenceslau Bráz", locaisAceitos: ["Wenceslau Bráz"] },
});

module.exports = Object.freeze(Object.fromEntries(Object.entries(CIDADES).map(([chave, cidade]) => {
  const acesso = ACESSO[chave] || { modo: "ausente", motivo: "Base sem ponto OCEANOP cadastrado." };
  const unidade = unidadeVento();
  return [chave, Object.freeze({
    ...acesso,
    habilitado: acesso.modo !== "ausente",
    id: chave,
    latitude: cidade.latitude,
    longitude: cidade.longitude,
    referencia: `${cidade.nome} — ${cidade.uf}`,
    fusoHorario: cidade.fusoHorario || "America/Sao_Paulo",
    fusoDados: fusoDados(),
    usarVento: true,
    unidades: Object.freeze({ VelocidadeVento: unidade, VelocidadeVento_10M_Rajada: unidade, DirecaoVento: "graus" }),
  })];
})));
```

## 8. Atualização de 26/10/2026 — resultados dos testes

Com acesso autenticado (usuário/senha, HTTP Basic) executamos o teste nas 11 bases:

| Base | Resultado |
|---|---|
| Rio de Janeiro, Santos, Aracaju, Oiapoque, Vitória, Salvador | OK por coordenadas |
| Macaé, Natal, Brasília | `POST` por coordenadas retorna `data` vazio; OK por `JsonPrevisaoAreaAsync?local=macaé/Natal/Brasília` |
| Manaus | `data` vazio por coordenadas e por nome de área |
| Wenceslau Bráz (antes Araucária) | coordenadas vazias; OK por área `Wenceslau Bráz` |

Observações e perguntas adicionais:

1. **Coordenadas exatas.** A API só devolve dados para coordenadas idênticas às
   cadastradas (arredondar para 1 casa zera o retorno). Qual é a lista oficial de
   pontos/coordenadas para Macaé, Natal, Brasília, Wenceslau Bráz e Manaus?
2. **Manaus:** quais são o nome de área (`local`) e/ou as coordenadas
   cadastradas? `embarcacao/Regiao` retorna 403 para o nosso usuário; existe
   outra forma de listar as áreas disponíveis?
3. **Unidade e fuso (inferidos).** Comparando com a Open-Meteo hora a hora, a rajada
   está em **nós** e as datas parecem estar em **UTC**. Podem confirmar?
4. **Duplicidade no Rio:** para cada hora vêm dois registros ("Rio de Janeiro" e
   "Santos Dumont (SBRJ)") com o mesmo `PointID`. É esperado? Qual representa a base?
5. **Atualização:** `DataEscrita` indica uma corrida por dia (~06h). Confirmam?
