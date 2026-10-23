# Relatório de Auditoria da Integração OCEANOP

**Projeto:** Protocolo Meteorológico CIM  
**Data da auditoria:** 22/10/2026  
**Escopo:** fontes meteorológicas, remoção de provedores não autorizados,
integração OCEANOP/TTForecast, normalização de vento e regressão do produto.

## Resumo executivo

O fluxo ativo deixou de consumir Open-Meteo e Climatempo. Foram removidos os
adaptadores, fallbacks, variáveis de ambiente, consultas agendadas e referências
operacionais desses provedores. Quando INMET ou outra fonte autorizada não
fornece uma variável equivalente, o produto agora apresenta **Informação
indisponível** e registra diagnóstico, sem reutilizar dado antigo ou fabricar
valor.

O endpoint OCEANOP por coordenadas foi implementado para as 11 bases atuais,
com isolamento de cache, validação da localidade devolvida, timeout, tentativas
limitadas e rastreabilidade. O contrato foi confirmado no Swagger real, mas a
chamada real respondeu HTTP 401; portanto, a integração está corrigida e pronta,
mas não pode ser classificada como operacional sem credencial/permissão oficial.

O portal TTForecast respondeu HTTP 200, enquanto sua API oficial de áreas
respondeu HTTP 403 sem autorização. Como existe uma API estruturada e não havia
sessão corporativa autorizada, não foi implementado scraping/Playwright nem
houve tentativa de contornar SSO, MFA, cookies ou tokens.

## A. Diagnóstico geral

Antes da auditoria, o projeto combinava INMET com serviços suplementares de
previsão, ar, UV e mar, inclusive por fallback. Isso permitia que uma variável
fosse atribuída a uma fonte planejada sem confirmação de equivalência de
localidade, período ou metodologia. Também havia dois caminhos OCEANOP: o
endpoint por nome de área e o portal Tetra Tech, sem cobertura completa das
bases por coordenada.

As fontes remanescentes e seus papéis confirmados são:

| Fonte | Uso no projeto após a auditoria | Evidência/limitação |
|---|---|---|
| INMET PrevMet | Previsão e avisos oficiais | Fonte principal; previsão e observação são mantidas separadas |
| INMET observações | Valores observados disponíveis | Não substitui previsão nem fabrica campos ausentes |
| Clima e Saúde | Excesso de calor/EHF | Uso municipal já existente; não foi tratado como fonte de UV |
| ANA Monitor de Secas | Competência, mapa e classificação de seca | Produto periódico, não é alerta hidrológico em tempo real |
| COR-Rio | Estágio/comunicados do município do Rio | Não é aplicado às demais bases |
| OCEANOP Petrobras | Vento/rajada por coordenada | Contrato confirmado; dados reais pendentes por HTTP 401 |
| Tetra Tech/TTForecast | Rajada operacional adicional por área | Portal acessível; API estruturada pendente por HTTP 403 |
| Qualidade do ar e UV | Sem fonte autorizada comprovada no fluxo atual | Exibidos como informação indisponível |
| Condição marítima | Preparada para OCEANOP | Não promovida antes da homologação real de unidade e cobertura |

## B. Remoção do Open-Meteo e do Climatempo

Foram removidos:

- clientes de forecast, previsão semanal, qualidade do ar e marine;
- configuração, códigos WMO e adaptador diário do Climatempo;
- chamadas do pipeline, `reportBuilder`, relatório semanal e verificação de
  fontes;
- fallback, cache e metadados de procedência associados;
- variáveis de ambiente e configuração por cidade;
- referências operacionais no painel, PDF, e-mail, alertas e scripts;
- testes exclusivos dos adaptadores eliminados.

Foi criado um teste de regressão que percorre `src`, `scripts`, `public` e
`.env.example` e falha se encontrar nomes, endpoints ou configuração desses
provedores. Uma busca estática adicional nesses mesmos artefatos ativos e na
documentação operacional retornou zero ocorrência. Registros históricos de
auditorias e o diretório arquivado `tmp/revert-0918-backup` não fazem parte do
runtime e foram preservados como evidência histórica.

## C. Integração OCEANOP

### Contrato e conectividade

- Swagger: `GET https://oceanop-api-disp.petrobras.com.br/swagger/v1/swagger.json`
  — HTTP 200.
- Endpoint adotado: `POST /api/v1/previsao/JsonPrevisaoPorListaDePontosLatLonAsync`.
- DTO confirmado: lista de `PontoLatLonDTO`, com `ID`, `Lat` e `Lon`.
- Teste real com o ID e as coordenadas exatas de Brasília: HTTP 401, sem payload
  meteorológico utilizável.
- Endpoint legado por nome de área: HTTP 401 nas sete áreas anteriormente
  cadastradas.

O Swagger não publicou esquema de segurança suficiente para concluir o método
de autenticação. O cliente admite, sem expor segredo, `X-API-Key` por
`OCEANOP_API_KEY` e Bearer por `OCEANOP_ACCESS_TOKEN`. A confirmação do método
correto deve vir do responsável pela API.

### Correções implementadas

- um ponto por base, derivado das coordenadas cadastradas;
- `POST` com JSON conforme o Swagger;
- associação obrigatória entre `ID` solicitado e `Local` retornado;
- cache com chave formada por ID, latitude e longitude;
- deduplicação de chamadas simultâneas e TTL de cinco minutos;
- timeout de 15 segundos e retentativas somente para falhas transitórias;
- parsing seguro de números decimais, datas e campos ausentes;
- fuso IANA por base;
- diagnóstico de consulta, cache, sucesso e erro sem conteúdo privado;
- ondas e parâmetros marítimos bloqueados até homologação real.

Os campos descritos pelo contrato incluem temperatura, condição do clima,
direção e velocidade do vento, rajadas em diversas alturas, precipitação,
visibilidade, pressão, nebulosidade, ondas, ondulação e probabilidade de trovão.
Isso demonstra capacidade prevista do contrato, não disponibilidade real por
base. Sem resposta autenticada, nenhum desses campos foi classificado como
validado com dados reais.

## D. Integração TTForecast

- Portal `https://petrobras.ttforecast.com.br/map`: HTTP 200.
- API identificada pelo adaptador: `/api/v1/areas/json` e
  `/api/v1/bulletins/{idArea}`.
- Consulta real a `/api/v1/areas/json`: HTTP 403, mensagem de credencial não
  validada.
- Métodos previstos no cliente: `X-API-Key`, Bearer e OAuth configurado.

TTForecast/Tetra Tech e OCEANOP Petrobras permanecem fontes distintas na
rastreabilidade; não foram declaradas equivalentes. Playwright não foi usado
porque uma API estruturada já existe e não havia autenticação corporativa
autorizada. Implementar navegação autenticada nessas condições seria
tecnicamente desnecessário e contrariaria a proibição de contornar controles.

## E. Validação por base

Todas as consultas OCEANOP são individualizadas. Cabiúnas, Linhares e Anchieta
não constam em `src/config/cities.js` e, por isso, não foram artificialmente
criadas nem associadas a cidades próximas.

| Base | Fontes aplicáveis | Dados disponíveis no fluxo | Divergências/controles | Resultado |
|---|---|---|---|---|
| Brasília/DF | INMET, Clima e Saúde, ANA; OCEANOP preparado | Meteorologia oficial conforme resposta das fontes públicas | Coordenadas conferidas; cache isolado; `Local` divergente é rejeitado; mar desabilitado | Fontes públicas mantidas; OCEANOP pendente de autorização |
| Rio de Janeiro/RJ | INMET, Clima e Saúde, ANA, COR-Rio; OCEANOP/TT preparados | Previsão, avisos, calor, seca e estágio municipal conforme fonte | COR-Rio restrito ao Rio; mar não promovido sem homologação | Públicas funcionando; fontes Petrobras pendentes |
| Macaé/RJ | INMET, Clima e Saúde, ANA; OCEANOP/TT preparados | Previsão, avisos, calor e seca conforme fonte | Ponto próprio; sem reutilização do Rio | Públicas funcionando; fontes Petrobras pendentes |
| Manaus/AM | INMET, Clima e Saúde, ANA; OCEANOP/TT preparados | Meteorologia e seca conforme fonte | Fuso `America/Manaus`; produto oceânico não aplicável | Públicas funcionando; vento OCEANOP pendente |
| Santos/SP | INMET, Clima e Saúde, ANA; OCEANOP/TT preparados | Meteorologia, calor e seca conforme fonte | Mar bloqueado até validar payload/unidades | Públicas funcionando; fontes Petrobras pendentes |
| Aracaju/SE | INMET, Clima e Saúde, ANA; OCEANOP preparado | Meteorologia, calor e seca conforme fonte | Área TT não confirmada e desabilitada | OCEANOP pendente; TT não configurado |
| Natal/RN | INMET, Clima e Saúde, ANA; OCEANOP/TT preparados | Meteorologia, calor e seca conforme fonte | Fuso `America/Fortaleza`; mar ainda não homologado | Públicas funcionando; fontes Petrobras pendentes |
| Oiapoque/AP | INMET, Clima e Saúde, ANA; OCEANOP/TT preparados | Meteorologia, calor e seca conforme fonte | Fuso `America/Belem`; mar ainda não homologado | Públicas funcionando; fontes Petrobras pendentes |
| Vitória/ES | INMET, Clima e Saúde, ANA; OCEANOP/TT preparados | Meteorologia, calor e seca conforme fonte | Ponto próprio; mar ainda não homologado | Públicas funcionando; fontes Petrobras pendentes |
| Araucária/PR | INMET, Clima e Saúde, ANA; OCEANOP preparado | Meteorologia, calor e seca conforme fonte | Interior; mar não aplicável; área TT desabilitada | OCEANOP pendente; TT não configurado |
| Salvador/BA | INMET, Clima e Saúde, ANA; OCEANOP/TT preparados | Meteorologia, calor e seca conforme fonte | Ponto próprio; mar ainda não homologado | Públicas funcionando; fontes Petrobras pendentes |

## F. Conversões para km/h

A conversão foi centralizada em `src/logic/windUnits.js` e reutilizada por INMET,
OCEANOP e Tetra Tech:

| Entrada | Cálculo | Resultado testado |
|---|---|---|
| 5 m/s | `5 × 3,6` | 18 km/h |
| 10 m/s | `10 × 3,6` | 36 km/h |
| 15 m/s | `15 × 3,6` | 54 km/h |
| 20 nós | `20 × 1,852` | 37,04 km/h |
| valor em km/h | sem conversão | valor preservado |

Unidade ausente ou desconhecida é rejeitada. O cálculo conserva precisão e o
arredondamento ocorre apenas na apresentação. Altura de onda e período não
passam por essa função. Site, PDF e e-mail recebem os mesmos valores já
normalizados no backend, evitando conversão dupla.

## G. Arquivos modificados

### Configuração e documentação

- `.env.example`: remove variáveis dos provedores eliminados e documenta as
  credenciais opcionais OCEANOP.
- `render.yaml`: remove as variáveis de implantação do provedor descontinuado
  e inclui somente as credenciais opcionais OCEANOP.
- `README.md`, `OCEANOP.md`, `INSTALACAO_SERVIDOR_PETROBRAS.md` e
  `RELATORIO_AUDITORIA_APIS_METEOROLOGICAS.md`: atualizam fontes, operação,
  autenticação e limitações.
- `RAJADAS_PORTAIS.md` e `RESPOSTAS_SI.md`: retiram orientação operacional e
  regras de firewall obsoletas, substituindo-as pela matriz atual de fontes.
- `src/config/cities.js`: remove configuração Climatempo.
- `src/config/oceanopPontos.js`: novo cadastro automático e individual das 11
  bases por coordenadas.
- `src/config/rajadaPortais.js`: mantém apenas áreas TT confirmadas e desabilita
  associações não comprovadas.

### Coleta, política e processamento

- `src/sources/oceanop.js`: endpoint por coordenadas, autenticação configurável,
  validação de local, cache isolado, deduplicação, diagnóstico e conversão.
- `src/integrations/oceanopRoutes.js`: o monitor autenticado do painel passa a
  consultar o mesmo endpoint por coordenadas usado no relatório.
- `src/logic/windUnits.js`: nova conversão central de m/s, nós e km/h.
- `src/sources/inmetObservations.js` e `src/sources/tetratechGusts.js`: passam a
  usar a conversão central.
- `src/sources/previsaoProximosDias.js`: passa a usar INMET, com complemento
  OCEANOP/TT somente quando válido.
- `src/logic/reportBuilder.js`, `src/pipeline.js` e
  `src/logic/weeklyBuilder.js`: removem coleta/fallback dos provedores excluídos
  e integram a política segura.
- `src/logic/weatherSourcePolicy.js`, `weatherSourceMetadata.js` e
  `sourceProvenance.js`: política por variável, indisponibilidade explícita e
  rastreabilidade de unidade/conversão.
- `src/logic/verificacaoFontes.js`: verifica as fontes restantes e os pontos
  OCEANOP.
- `src/logic/alertWatcher.js`, `riskEngine.js`, `src/render/alertCards.js`,
  templates de e-mail/PDF e `public/dashboard-components.js`: eliminam fallback
  ou rótulo indevido sem alterar a estrutura visual.
- `scripts/auditarFontesReais.js` e `scripts/gerarEvidenciasPdfs0815.js`:
  auditam somente fontes autorizadas e preservam evidências corretas.

### Arquivos removidos

- `src/sources/airQuality.js`, `marine.js`, `openMeteo.js`,
  `openMeteoConfig.js`, `openMeteoSemanal.js`, `climatempoDaily.js` e
  `wmoCodes.js`.
- testes exclusivos desses módulos e do antigo relatório agendado dependente:
  `climatempoDaily.test.js`, `openMeteoConfig.test.js`,
  `openMeteoSupplemental.test.js`, `previsaoProximosDias.test.js` e
  `relatorioAgendado.test.js`.

### Testes ajustados ou criados

- `tests/oceanop.test.js`: contrato POST, todas as bases, Brasília, localidade,
  cache isolado, deduplicação e falhas HTTP/DNS.
- `tests/windUnits.test.js`: fórmulas e rejeição de unidade inválida.
- `tests/removedProviders.test.js`: bloqueio de regressão para provedores
  removidos.
- testes de política, fontes, Tetra Tech, conteúdo, validade, localidades,
  painel, PDF, e-mail, envio e escape foram ajustados à nova política.

## H. Pendências

1. Obter do responsável OCEANOP o método oficial de autenticação, escopo e
   credencial para o endpoint por coordenadas.
2. Executar uma chamada autenticada por base e homologar unidade original,
   cobertura, ciclo, fuso e significado de cada campo antes da promoção.
3. Autorizar a API TTForecast e confirmar IDs de área; Aracaju e Araucária não
   devem ser ativadas sem correspondência formal.
4. Validar campos marítimos OCEANOP por base costeira. Até isso ocorrer, ficam
   indisponíveis; em bases interiores, não se aplicam.
5. Definir fontes corporativamente autorizadas para qualidade do ar e UV ou
   manter esses indicadores indisponíveis.

## I. Resultado final

| Integração | Classificação | Justificativa |
|---|---|---|
| INMET previsão/avisos | Funcionando e validada com dados reais | Endpoints públicos responderam e o contrato já é usado pelo projeto |
| INMET observações | Funcionando e validada com dados reais | Mantida separada da previsão |
| Clima e Saúde | Funcionando e validada com dados reais | Serviço municipal respondeu na auditoria; falhas continuam tratadas |
| ANA Monitor de Secas | Funcionando e validada com dados reais | API e listagem do produto responderam |
| COR-Rio | Funcionando e validada com dados reais | Restrita ao Rio de Janeiro |
| OCEANOP por coordenadas | Corrigida, mas aguardando validação real | Swagger 200; dados bloqueados por HTTP 401 |
| OCEANOP marítimo | Pendente de autorização ou acesso | Sem payload real para homologar unidade/cobertura |
| TTForecast API | Pendente de autorização ou acesso | Portal 200; API HTTP 403 |
| Playwright/TTForecast | Não aplicável neste momento | API estruturada existe e não havia sessão autorizada |
| Qualidade do ar e UV | Indisponível | Nenhuma fonte restante foi comprovada/autorizada |
| Open-Meteo e Climatempo | Não aplicável/removidos | Fora do backend, frontend, jobs e geração de informativos |

## Evidências de teste

- suíte completa com isolamento padrão do Node: 379/379 testes aprovados;
- a execução completa foi feita fora do sandbox exclusivamente para permitir
  os subprocessos do executor de testes; nenhum serviço de produção foi usado;
- testes focados de integração/presentação: 67/67 aprovados na execução final;
- verificação de sintaxe: 146 arquivos JavaScript, zero falha;
- busca estática e teste automatizado: zero referência aos provedores removidos
  no código e configuração ativos.

Não foram realizados envios reais de e-mail, reinicializações, alterações em
produção, captura de credenciais ou contorno de mecanismos de segurança.
