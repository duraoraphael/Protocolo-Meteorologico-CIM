# Relatório de auditoria das APIs meteorológicas — CIM

**Data:** 22/10/2026

**Escopo:** fontes externas, cadastro das bases, normalização, unidades, fusos, caches, prioridade de fontes, regras de alerta e consistência entre painel, PDF e e-mail.

**Restrições:** nenhum e-mail real foi enviado, nenhum upload no GED/SharePoint foi executado, nenhum serviço de produção foi reiniciado e nenhuma validação TLS foi desativada.

## A. Resumo executivo

A auditoria confirmou que o fluxo operacional utiliza um objeto consolidado por base e emissão, posteriormente reutilizado pelo painel, PDF e e-mail. As fontes oficiais e complementares permanecem identificadas por campo; observações não são promovidas como previsões; valores ausentes continuam nulos em vez de receber zero ou número fictício.

Foram encontrados quatro achados nesta rodada:

1. o adaptador OCEANOP validava a estrutura da resposta, mas não confrontava o campo `Local` com a área solicitada antes de armazenar e promover os dados;
2. o script independente de auditoria não carregava a cadeia de certificados corporativos utilizada pelo runtime, produzindo falsos diagnósticos TLS para as APIs Open-Meteo;
3. o README informava nove bases costeiras, enquanto o cadastro executável possui oito;
4. o OCEANOP estava descrito como consulta sem token, mas a verificação real alcançou o serviço e recebeu HTTP 401 nas sete áreas cadastradas.

Os três primeiros achados foram corrigidos. O quarto permanece como pendência externa: a aplicação não deve inventar token, esquema de autenticação ou resposta da API. A documentação foi corrigida para não declarar a integração OCEANOP como operacional enquanto não houver autenticação oficial e resposta real com `success: true`.

Resultado geral:

- **3 correções concluídas** no código, testes e documentação;
- **1 pendência externa principal**: autenticação/homologação operacional do OCEANOP;
- **420 testes aprovados e 0 falhas**;
- INMET, Open-Meteo Weather, Air Quality, Marine, Clima e Saúde, COR-Rio, ANA e IBGE responderam ao vivo nesta auditoria;
- OCEANOP respondeu HTTP 401 em todas as áreas testadas, sem retentativa indevida e sem exposição de corpo privado;
- o sistema não deve ser declarado integralmente homologado enquanto as pendências da seção H não forem resolvidas.

## B. Diagnóstico das APIs

| API/fonte | Endpoint e método | Situação encontrada | Problema identificado | Correção realizada | Status final |
|---|---|---|---|---|---|
| INMET — previsão | `GET https://apiprevmet3.inmet.gov.br/previsao/{codigoIbge}` | HTTP 200 para Rio; períodos e data corretos | Nenhum erro novo comprovado | Mantido parser estrito e prioridade oficial | **Operacional** |
| INMET — avisos | `GET https://apiprevmet3.inmet.gov.br/avisos/ativos` | HTTP 200; 2 avisos nacionais e 1 aplicável ao Rio no instante auditado | Nenhum erro novo comprovado | Mantidos filtro municipal, vigência e deduplicação | **Operacional** |
| INMET — observação | `GET https://apiprevmet3.inmet.gov.br/estacao/proxima/{codigoIbge}` | Contrato, estação, distância, horário UTC e conversão de vento cobertos por testes | A fonte pode omitir campos em determinadas estações | Ausência permanece indisponível e não vira zero | **Operacional com cobertura variável** |
| INMET — catálogo | `GET https://apitempo.inmet.gov.br/estacoes/T` | Usado para validar estação e coordenadas | Pode ficar indisponível sem invalidar uma observação já identificada | Falha é registrada separadamente | **Auxiliar** |
| Open-Meteo Weather | `GET https://api.open-meteo.com/v1/forecast` | HTTP 200 com fuso e unidades esperados | Script de auditoria não carregava CAs do Windows | Auditor passou a carregar `src/security/certificados.js` | **Operacional em teste; licença comercial exigida em produção** |
| Open-Meteo Air Quality/CAMS | `GET https://air-quality-api.open-meteo.com/v1/air-quality` | HTTP 200; janela local e unidades válidas | Mesmo falso diagnóstico TLS do auditor | Mesma correção de certificados | **Operacional em teste; licença comercial exigida em produção** |
| Open-Meteo Marine | `GET https://marine-api.open-meteo.com/v1/marine` | HTTP 200 para Natal; grade marítima e unidades válidas | Documentação contava nove bases costeiras | Contagem corrigida para oito | **Operacional nas bases costeiras; licença comercial exigida em produção** |
| Clima e Saúde | `GET https://clima.saude.gov.br/{uf}/{municipio}?modo=ehf` | HTTP 200; município, UF, data e EHF reconhecidos | Não há API/Swagger público estável; integração depende do HTML oficial | Parser continua falhando de forma segura quando o formato muda | **Operacional, sujeito ao formato do portal** |
| COR-Rio — estágio | `GET https://appcor.cor-rio.work/estagio_cidade` | HTTP 200; Estágio 1 no instante auditado | Nenhum erro novo comprovado | Mantido parser estrito de Estágio 1–5 | **Operacional para Rio de Janeiro** |
| COR-Rio — calor | `GET https://appcor.cor-rio.work/calor_api?formato=texto` | HTTP 200; Estágio de Calor 1 | Nenhum erro novo comprovado | Mantido separado do estágio operacional e do EHF | **Operacional para Rio de Janeiro** |
| COR-Rio — comunicados | `GET https://cor.rio/wp-json/wp/v2/posts` | HTTP 200; um comunicado vigente | Posts não equivalem automaticamente a mudança de estágio | Estado e comunicados continuam separados | **Operacional para Rio de Janeiro** |
| ANA — Monitor de Secas | `GET https://apimsbr.ana.gov.br/rest/cms-msne/mapa-monitor` e mapas S3 | HTTP 200; competência 2026-09, mapa final 308 e 27 mapas estaduais | Nenhum erro novo comprovado | Mantidas validação de competência, UF, PNG e ETag | **Operacional; produto mensal** |
| OCEANOP/Petrobras | `GET https://oceanop-api-disp.petrobras.com.br/api/v1/previsao/JsonPrevisaoAreaAsync?local=...` | TLS válido com CA do Windows; HTTP 401 nas sete áreas; nenhum payload `success:true` obtido | Ausência de autenticação oficial e falta de validação entre área pedida e `Local` retornado | Resposta com local diferente agora é descartada antes do cache; documentação registra o 401 | **Não homologado operacionalmente** |
| Tetra Tech/OCEANOP | `GET /api/v1/areas/json` e `/api/v1/bulletins/{idArea}` | Cliente suporta `X-API-Key` ou OAuth e cache por data | Consulta real depende de credencial oficial | Sem credencial, falha antes da chamada e mantém fallback | **Condicional à credencial** |
| IBGE — Localidades | `GET https://servicodados.ibge.gov.br/api/v1/localidades/municipios/{codigo}` | 11/11 códigos responderam HTTP 200 e coincidiram com município/UF | Código municipal não comprova a posição física da instalação | Mantida ressalva de homologação patrimonial | **Validado para município/UF** |
| Windy | Nenhum endpoint no runtime atual | Não há módulo ou rota executável ativa | Não aplicável | Nenhuma alteração | **Não utilizado** |

### Evidências reais de 22/10/2026

- Open-Meteo Weather, Rio de Janeiro: grade `-22.952549, -43.215027`, fuso `America/Sao_Paulo`, temperatura de modelo 23,4 °C às 14:15, mínima 19,9 °C, máxima 23,7 °C, chuva diária 6 mm e rajada diária 51,1 km/h no payload. O relatório normalizou a janela consultada para 20–24 °C, 3,7 mm e 51 km/h. Essa diferença é de janela/agregação e arredondamento, não erro de associação.
- Open-Meteo Air Quality/CAMS, Rio: UV máximo 3,3; PM2,5 médio 16,3 µg/m³; PM10 médio 20,6 µg/m³; European AQI PM2,5 igual a 43.
- Open-Meteo Marine, Natal: grade `-5.791664, -35.124985`, altura máxima diária 1,1 m e temperatura do mar 28,3 °C.
- INMET, Rio: 19–26 °C, umidade de 50–100%, condição de muitas nuvens com pancadas isoladas e vento textual oficial. O produto não publicou chuva, probabilidade, velocidade ou rajada numéricas; esses campos permanecem ausentes ou recebem complemento explicitamente identificado.
- Clima e Saúde, Rio: EHF 0,91, classificação `Sem excesso`, risco combinado `Normal` e GeoSES 0,38.
- COR-Rio: Estágio operacional 1, Estágio de Calor 1 e um comunicado vigente.
- ANA: publicação de setembro/2026, elaborada em 16/10/2026, com mapas das 27 UFs.

Esses valores registram a consulta daquele instante. Não devem ser reutilizados como valores atuais em documentos futuros.

## C. Auditoria por base

| Base | Geolocalização/código | Dados oceanográficos | OCEANOP | Resultado da validação |
|---|---|---|---|---|
| Rio de Janeiro/RJ | IBGE `3304557`, confirmado | Aplicável (`costeira: true`) | Área cadastrada para vento; resposta real bloqueada por 401 | Cadastro municipal válido; sem evidência de troca com outra base |
| Macaé/RJ | IBGE `3302403`, confirmado | Aplicável | Área cadastrada para vento; resposta real bloqueada por 401 | Cadastro municipal válido; cache identificado por área |
| Brasília/DF | IBGE `5300108`, confirmado; `-15.7939869, -47.8828` | **Não se aplica** | Apenas vento/rajada; `usarMar` não está habilitado; resposta real bloqueada por 401 | Proteção reforçada contra retorno de outra localidade |
| Manaus/AM | IBGE `1302603`, confirmado; fuso `America/Manaus` | Não aplicável no cadastro atual | Área de vento com fuso próprio; resposta real bloqueada por 401 | Conversão temporal isolada por fuso |
| Santos/SP | IBGE `3548500`, confirmado | Aplicável | Área cadastrada para vento; resposta real bloqueada por 401 | Cadastro municipal válido |
| Aracaju/SE | IBGE `2800308`, confirmado | Aplicável | Sem área OCEANOP por área | Usa somente fontes habilitadas/fallback identificado |
| Natal/RN | IBGE `2408102`, confirmado; fuso `America/Fortaleza` | Aplicável | Sem área OCEANOP por área | Marine validado ao vivo; grade marítima coerente com o ponto solicitado |
| Oiapoque/AP | IBGE `1600501`, confirmado; fuso `America/Belem` | Aplicável | Sem área OCEANOP por área | Cadastro municipal válido |
| Vitória/ES | IBGE `3205309`, confirmado | Aplicável | Área cadastrada para vento; resposta real bloqueada por 401 | Cadastro municipal válido |
| Araucária/PR | IBGE `4101804`, confirmado | Não se aplica | Área cadastrada para vento; resposta real bloqueada por 401 | Produto marítimo não é promovido |
| Salvador/BA | IBGE `2927408`, confirmado | Aplicável | Sem área OCEANOP por área | Cadastro municipal válido |

Cabiúnas, Linhares e Anchieta não estão no cadastro meteorológico executável atual. A auditoria não os tratou como bases ativas nem criou mapeamentos implícitos.

As coordenadas cadastradas são referências municipais. A confirmação do ponto físico exato de cada instalação depende de cadastro patrimonial/geoespacial corporativo autorizado; o serviço do IBGE confirmou município e UF, não o ativo industrial.

## D. Investigação específica do OCEANOP e Brasília/DF

### Contrato efetivamente implementado

O código atual não usa o endpoint antigo de lista de pontos por latitude/longitude. O contrato executável é:

`GET /api/v1/previsao/JsonPrevisaoAreaAsync?local={identificador}`

A requisição envia somente `local`, usa `Accept: application/json`, timeout de 15 segundos, retentativas apenas para falhas transitórias, cache de cinco minutos e deduplicação de chamadas simultâneas. HTTP 401, 403 e 404 são tratados como erros permanentes e não são repetidos.

O endpoint antigo `POST .../JsonPrevisaoPorListaDePontosLatLonAsync` aparece em documentação histórica, mas não é chamado pelo runtime atual. Não houve alteração de volta para esse contrato porque sua estrutura, autenticação e autorização não foram comprovadas nesta rodada.

### Diagnóstico de Brasília

Brasília está corretamente cadastrada como localidade interiorana:

- coordenadas municipais: `-15.7939869, -47.8828`;
- código IBGE: `5300108`, confirmado pela API oficial do IBGE;
- não possui `costeira: true`;
- a configuração OCEANOP habilita somente `usarVento: true`;
- não possui `usarMar: true` nem unidades marítimas homologadas;
- `reportBuilder` chama o mapeamento marítimo somente quando a base é costeira **e** a área possui `usarMar: true`.

Portanto, Brasília pode receber vento e rajada de uma área meteorológica autorizada, mas nunca altura de onda, ondulação ou condição de mar. Quando esses dados não são aplicáveis, o relatório segue com o produto marítimo nulo/não aplicável.

### Causa raiz e correção

Não foi possível provar que dados de outra localidade estavam efetivamente sendo exibidos em Brasília, porque a API não forneceu payload autenticado. Foi, porém, comprovada uma vulnerabilidade de associação: qualquer payload estruturalmente válido poderia ser aceito mesmo se cada registro declarasse outro valor em `Local`.

A correção implementada:

1. normaliza somente variações textuais equivalentes do identificador, ignorando caixa, acentos, pontuação e espaços;
2. compara todos os valores `Local` retornados com o `local` solicitado;
3. rejeita campo ausente, vazio ou diferente com `OCEANOP_LOCATION_MISMATCH`;
4. executa a validação antes de gravar no cache;
5. mantém caches separados por identificador de área normalizado;
6. permite aliases apenas quando forem declarados explicitamente em `locaisRetorno`, sem inferência geográfica.

Testes novos comprovaram que uma resposta do Rio solicitada como Brasília é rejeitada, que os caches das duas bases não se misturam e que Brasília não habilita produto marítimo.

### Autenticação e validação real

Com a cadeia certificadora do Windows, DNS, TCP e TLS chegaram corretamente ao serviço. As sete áreas retornaram HTTP 401. O cliente não envia `Authorization` porque o esquema oficial não está documentado no projeto. Não foi introduzido token genérico, bypass TLS ou credencial inventada.

Status: **adaptador validado por contrato e testes; dados reais pendentes de autenticação oficial**.

## E. Processamento, regras e consistência das superfícies

### Prioridade e procedência

- INMET permanece prioritário para previsão oficial, avisos e observações.
- Open-Meteo complementa somente campos numéricos ausentes e mantém a origem explícita.
- Observações INMET permanecem separadas de previsões.
- OCEANOP só substitui vento/rajada quando o produto, local, fuso e unidades são válidos.
- Marine só é consultado para bases marcadas como costeiras.
- EHF do Clima e Saúde não é inferido a partir da temperatura.
- Dados ausentes não são transformados em zero, Normal ou ausência de risco.

### Cache e concorrência

- cache do painel: separado por `cidade.chave`;
- observações INMET: histórico separado por base;
- Marine: cache separado por base;
- COR-Rio: cache próprio e exclusivo do Rio;
- OCEANOP: cache por identificador normalizado, agora validado contra o `Local` retornado;
- chamadas simultâneas da mesma área são deduplicadas; áreas diferentes não compartilham a promessa ou o resultado.

### Fuso, períodos e unidades

- Manaus usa `America/Manaus`, Natal `America/Fortaleza` e Oiapoque `America/Belem`; as demais usam `America/Sao_Paulo` quando não há configuração específica.
- APIs Open-Meteo têm fuso e unidades verificados no payload.
- vento observado INMET em m/s é convertido para km/h; a origem observacional permanece identificada.
- OCEANOP está configurado em km/h e não recebe multiplicação adicional.
- Tetra Tech converte nós para km/h por `km/h = nós × 1,852`.
- direção média utiliza cálculo circular, evitando que 350° e 10° resultem em sul.
- janelas da edição e data civil local são aplicadas antes das agregações.

### Alertas

A ordem operacional validada é:

`EMERGÊNCIA → ALERTA → ATENÇÃO → NORMAL`

Os testes cobrem agravamento, redução, retorno ao normal, primeiro ciclo sem disparo retroativo, falha de fonte sem normalização falsa, deduplicação e isolamento por base. O estado só é confirmado após o envio SMTP ser confirmado; falhas permanecem pendentes para nova tentativa.

### Painel, PDF e e-mail

As três superfícies reutilizam o mesmo relatório consolidado da emissão. A suíte cobre:

- mesma rajada e respectiva fonte;
- mesma condição geral;
- chuva prevista separada da observada;
- qualidade do ar e UV sem classificação inventada;
- calor baseado somente no EHF;
- mar somente quando aplicável;
- avisos oficiais preservados sem reescrever o fenômeno;
- dados armazenados marcados como desatualizados;
- textos externos escapados.

Nenhuma alteração visual foi realizada nesta auditoria.

## F. Modificações no código

| Arquivo | Comportamento anterior | Alteração implementada | Justificativa | Validação |
|---|---|---|---|---|
| `src/sources/oceanop.js` | Aceitava payload válido sem conferir `Local` | Normalização e validação de todos os locais retornados antes do cache | Impedir associação de outra área a Brasília ou qualquer base | Testes de mismatch, cache e contrato |
| `tests/oceanop.test.js` | Não havia regressão de local cruzado nem Brasília marítima | Quatro testes novos e ajuste da fixture válida | Cobrir a causa raiz e aplicabilidade | 20/20 testes focados aprovados |
| `scripts/auditarFontesReais.js` | Não carregava as CAs corporativas do runtime | Passou a carregar `src/security/certificados.js` | Evitar falso negativo TLS sem desativar validação | Auditor executado sem flag extra; fontes responderam HTTP 200 |
| `README.md` | Informava nove bases costeiras e não registrava o 401 OCEANOP | Corrigido para oito; status/autenticação e validação de local documentados | Alinhar documentação ao código e à evidência real | Revisão estática e auditoria ao vivo |
| `OCEANOP.md` | Contrato não registrava a validação de `Local` nem a rodada atual | Incluída proteção e situação de 22/10/2026 | Rastreabilidade operacional | Revisão estática e testes |

## G. Comparação antes e depois

| Base/integração | Variável | Antes | Referência oficial | Depois | Resultado |
|---|---|---|---|---|---|
| Brasília/OCEANOP | Localidade retornada | Um payload válido poderia declarar outra área e ainda ser aceito | O próprio campo `Local` do contrato | Resposta diferente é descartada antes do cache | **Corrigido** |
| Brasília/OCEANOP | Condição marítima | Já era bloqueada pela combinação `costeira`/`usarMar` | Brasília é interiorana | Proteção preservada e coberta por teste explícito | **Validado** |
| OCEANOP | Autenticação | Documentação sugeria uso sem token | Serviço respondeu HTTP 401 | Status alterado para pendente; nenhum token inventado | **Pendente externo** |
| Auditor/Open-Meteo | TLS | `SELF_SIGNED_CERT_IN_CHAIN` no script isolado | Cadeia confiada pelo Windows | HTTP 200 sem desativar TLS | **Corrigido** |
| Open-Meteo/Rio | Temperatura | Payload 19,9–23,7 °C | Mesma resposta oficial da API | Exibição 20–24 °C por arredondamento documentado | **Diferença metodológica legítima** |
| Open-Meteo/Rio | Chuva | Payload diário 6 mm | Total diário 00h–24h | Janela da emissão 3,7 mm | **Diferença temporal legítima** |
| INMET/Rio | Rajada numérica | Campo ausente | Produto municipal retornou apenas intensidade textual | Permanece nulo ou complemento identificado | **Tratamento correto de ausência** |

Nenhum valor foi alterado artificialmente para coincidir com site ou provedor.

## H. Pendências, limitações e conclusão

### Pendências e limitações

1. Obter da responsável pelo OCEANOP o esquema oficial de autenticação, escopo, credencial, limites de uso e contrato atualizado do endpoint por área.
2. Repetir a validação OCEANOP até obter HTTP 2xx com `success:true`, conferir `Local`, fuso, unidades e períodos em cada uma das sete áreas.
3. Homologar coordenadas físicas das instalações em cadastro corporativo; o IBGE confirmou apenas município/UF.
4. Configurar licença e chave comercial Open-Meteo em produção. O código bloqueia uso comercial sem chave quando `NODE_ENV=production`.
5. Homologar as credenciais Tetra Tech/OCEANOP, GED/SharePoint e SMTP em ambiente controlado.
6. A integração Clima e Saúde depende do HTML do portal; alteração de layout deve aparecer como formato alterado, nunca como Normal.
7. Os endpoints `apiprevmet3`, `appcor` e `apimsbr` responderam, mas não possuem contrato público de SLA comprovado no projeto.

### Testes executados

- suíte completa: **420 aprovados, 0 falhas**;
- testes focados OCEANOP e bases: **20 aprovados, 0 falhas**;
- auditoria real somente leitura: Open-Meteo Weather/Air/Marine, INMET previsão/avisos, Clima e Saúde, COR-Rio e ANA com respostas válidas;
- IBGE: **11/11 códigos municipais confirmados**;
- OCEANOP: **7/7 áreas alcançaram o serviço e receberam HTTP 401**;
- nenhum SMTP, GED, deploy ou reinício de servidor executado.

### Conclusão

- **Problemas encontrados nesta rodada:** 4.
- **Problemas corrigidos:** 3.
- **Problemas pendentes por dependência externa:** 1, referente à autenticação/homologação real do OCEANOP.
- **Bases verificadas cadastralmente:** 11.
- **Bases OCEANOP verificadas por configuração e teste:** 7.
- **Bases OCEANOP validadas com dados reais:** 0, devido ao HTTP 401.

O código está consistente com a política de fontes, isolamento por base, tratamento de ausências e apresentação nas três superfícies. A correção impede que um retorno OCEANOP de outra localidade seja atribuído a Brasília ou a qualquer outra base. Contudo, o projeto permanece **condicionalmente apto**: as integrações validadas responderam corretamente, mas o OCEANOP não pode ser considerado operacional até que a autenticação oficial e os payloads reais sejam homologados.
