# Relatório de auditoria das APIs meteorológicas

**Projeto:** Protocolo Meteorológico CIM  
**Data da auditoria:** 13/10/2026  
**Escopo:** backend, painel, rotas HTTP, agendadores, fontes externas, caches, regras de risco, PDF, e-mail, configurações e testes.  
**Restrição relevante:** nenhum e-mail real foi enviado. O ambiente bloqueou a saída de rede do processo Node e o pedido de liberação não pôde ser analisado por limite do revisor de permissões. Por isso, este relatório diferencia teste automatizado, conferência documental/página oficial e consulta real do endpoint.

## A. Resumo executivo

- **Integrações externas encontradas:** 16 canais/endpoints (incluindo SMTP, OAuth e Graph).
- **Rotas HTTP internas encontradas:** 15.
- **Integrações rastreadas no código:** 16 de 16.
- **Integrações cobertas por testes automatizados de contrato/falha:** 12; as exceções são a conectividade real de OAuth, Graph, SMTP e o serviço Oceanop.
- **Fontes confrontadas com documentação ou página oficial:** Open-Meteo Weather, Air Quality/CAMS, Clima e Saúde, ANA, IBGE e COR-Rio.
- **Falhas de implementação comprovadas:** 4.
- **Falhas corrigidas nesta auditoria:** 4.
- **Verificações externas pendentes:** 5 grupos: execução ao vivo de todos os endpoints pelo processo da aplicação; coordenadas físicas das instalações; contrato Oceanop; SharePoint/GED; entrega SMTP.

Conclusão executiva: não foi encontrado gerador aleatório nem valor meteorológico fictício no caminho de produção. Foram encontrados dados simulados apenas em testes e artefatos de verificação visual, claramente identificados e não importados pelo runtime. Quatro problemas podiam produzir atribuição ou classificação enganosa; todos foram corrigidos. O sistema **não pode ser declarado 100% validado** enquanto as consultas reais de ponta a ponta e as coordenadas físicas das instalações não forem confirmadas em ambiente com rede e documentação operacional.

## B. Inventário de APIs

### B.1 Serviços externos

| API/serviço | Finalidade | Endpoint e método | Autenticação | Status | Última verificação |
|---|---|---|---|---|---|
| Open-Meteo Forecast | condição de modelo, temperatura, umidade, chuva, vento, rajada e previsão diária | `GET https://api.open-meteo.com/v1/forecast` | não | Contrato e transformação verificados; teste ao vivo pendente | 13/10/2026 |
| Open-Meteo Air Quality / CAMS | PM2,5, PM10, European AQI PM2,5, UV, poeira e CO | `GET https://air-quality-api.open-meteo.com/v1/air-quality` | não | Contrato e faixas oficiais conferidos; teste ao vivo pendente | 13/10/2026 |
| Open-Meteo Marine | ondas, marulho, período, direção e temperatura do mar | `GET https://marine-api.open-meteo.com/v1/marine` | não | Parser, unidades, ausência e cache testados; teste ao vivo pendente | 13/10/2026 |
| INMET Previsão | previsão municipal por código IBGE | `GET https://apiprevmet3.inmet.gov.br/previsao/{codigoIbge}` | não | Parser e falhas testados; endpoint ao vivo pendente | 13/10/2026 |
| INMET Avisos | avisos oficiais ativos | `GET https://apiprevmet3.inmet.gov.br/avisos/ativos` | não | CAP/legado, município, vigência e deduplicação testados; endpoint ao vivo pendente | 13/10/2026 |
| Windy Point Forecast | fallback de meteorologia, PM2,5/AQI US e mar | `POST https://api.windy.com/api/point-forecast/v2` | chave `WINDY_API_KEY` | Configurado; cliente, unidades, cache e erros testados; chamada real pendente | 13/10/2026 |
| Clima e Saúde — MS | EHF, risco combinado, temperatura prevista e vulnerabilidade | `GET https://clima.saude.gov.br/{uf}/{municipio}?modo=ehf&data=AAAA-MM-DD` | não | Página oficial e semântica conferidas; parser/testes completos; consulta Node ao vivo pendente | 13/10/2026 |
| ANA Monitor de Secas | metadados mensais, data de elaboração e descrição por UF | `GET https://apimsbr.ana.gov.br/rest/cms-msne/mapa-monitor?...` | não | Validação de competência/finalização testada; há cache validado de agosto/2026; nova chamada pendente | 13/10/2026 |
| ANA arquivos de mapas | mapa PNG oficial referenciado pela API | `GET https://ana-monitor-secas-files.s3.sa-east-1.amazonaws.com/uploads/mapas/...` | não | Assinatura PNG, caminho e hash testados; nova chamada pendente | 13/10/2026 |
| COR-Rio estágio | estágio operacional da cidade | `GET https://appcor.cor-rio.work/estagio_cidade` | não | Parser estrito e cache testados; páginas oficiais acessíveis; endpoint JSON ao vivo pendente | 13/10/2026 |
| COR-Rio calor | nível municipal de calor | `GET https://appcor.cor-rio.work/calor_api?formato=texto` | não | Parser estrito e cache testados; página oficial acessível; endpoint ao vivo pendente | 13/10/2026 |
| COR-Rio WordPress | comunicados meteorológicos vigentes | `GET https://cor.rio/wp-json/wp/v2/posts?...` | não | filtragem temporal/conteúdo testada; portal publicou conteúdo de 13/10/2026; endpoint ao vivo da aplicação pendente | 13/10/2026 |
| Oceanop / Petrobras | previsão por área Petrobras | `GET https://oceanop-api-disp.petrobras.com.br/api/v1/previsao/JsonPrevisaoAreaAsync?local=...` | contrato não informa | Parser testado; nenhum `oceanopLocalId` vinculado e unidades/fuso não documentados | 13/10/2026 |
| Microsoft OAuth 2.0 | token do GED | `POST https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token` | client credentials | Não configurado no ambiente auditado | 13/10/2026 |
| Microsoft Graph Drive | gravação do PDF no SharePoint/GED | `PUT https://graph.microsoft.com/v1.0/drives/{drive}/root:/...:/content` | bearer token | Não configurado no ambiente auditado | 13/10/2026 |
| SMTP | envio de informativos e alertas | Gmail `smtp.gmail.com:587` ou relay configurável | credencial SMTP | Credenciais presentes, `EMAIL_ACTIVE=false`; deliberadamente não conectado | 13/10/2026 |

Locais de chamada: `src/sources/openMeteo.js`, `airQuality.js`, `marine.js`, `inmet.js`, `windy.js`, `climaSaudeService.js`, `monitorSecas.js`, `corRio.js`, `oceanop.js`, `src/integrations/sharepointGed.js` e `src/email/transport.js`.

### B.2 Rotas internas

Foram localizadas 15 rotas: `GET /api/preview`, `GET /api/cor-rio`, `GET /relatorios/:arquivo`, `POST /api/gerar-relatorio`, `GET /api/logos`, `GET /api/cidades`, `POST /api/verificar-senha`, cinco rotas de responsáveis (`GET`, consulta, criação, alteração e exclusão), `GET /api/windy/map-config`, `GET /api/oceanop/areas` e `GET /api/oceanop/previsao`.

### B.3 Contratos, frequência, fuso e unidades

| Integração | Dados/retorno consumido | Atualização usada pelo sistema | Fuso | Unidades validadas |
|---|---|---|---|---|
| Open-Meteo | séries `current`, `hourly` e `daily` | a cada coleta; modelos atualizam em ciclos próprios | fuso IANA da base | °C, %, mm, km/h, graus |
| Air Quality/CAMS | série horária do dia | a cada coleta | fuso IANA da base | µg/m³, European AQI, índice UV |
| Marine | série horária do dia | a cada coleta; último válido pode ser usado com carimbo de data | fuso IANA da base | m, s, °C, graus |
| INMET previsão | manhã/tarde/noite do dia | a cada coleta | data civil de Brasília | campos oficiais; números só quando publicados explicitamente |
| INMET avisos | lista nacional ativa | a cada coleta | horário oficial normalizado para Brasília | severidade/texto oficial; sem conversão numérica inventada |
| Windy | série geralmente trihorária | cache de 10 min | fuso IANA da base | K→°C; m/s→km/h; m/mm; µg/m³; graus |
| Clima e Saúde | hoje + quatro dias | pipeline oficial diário: coleta 04h, painel 05h | data do município/painel | °C, EHF e classes oficiais |
| ANA | competência mensal | mensal; cache estrito por `AAAA-MM` | não aplicável | categorias S0–S4 e descrição oficial |
| COR-Rio | estado atual e posts das últimas 24 h | TTL interno e horários próprios por parte | Brasília | níveis textuais 1–5 |
| Oceanop | campos numéricos/textuais do contrato observado | sob demanda | **não documentado** | **não documentadas**; por isso não alimenta os campos meteorológicos principais |

Documentação oficial consultada: [Open-Meteo Forecast](https://open-meteo.com/en/docs), [Air Quality API](https://open-meteo.com/en/docs/air-quality-api), [Marine API](https://open-meteo.com/en/docs/marine-weather-api), [Clima e Saúde — perguntas frequentes](https://clima.saude.gov.br/perguntas-frequentes), [ANA — Monitor de Secas](https://www.gov.br/ana/pt-br/assuntos/monitoramento-e-eventos-criticos/eventos-criticos/monitor-de-secas), [IBGE — códigos dos municípios](https://www.ibge.gov.br/explica/codigos-dos-municipios.php), [COR-Rio](https://cor.rio/), [estágios operacionais](https://cor.rio/estagios-operacionais-da-cidade/) e [níveis de calor](https://cor.rio/niveis-de-calor/).

## C. Rastreabilidade dos dados

| Informação | Fonte e campo original | Localidade | Transformação | Site/PDF/e-mail | Resultado |
|---|---|---|---|---|---|
| Condição do tempo | Open-Meteo `weather_code` (`current`, `hourly` ou `daily`) | coordenadas da base | tabela WMO; agora marcada como previsão de modelo | mesmo objeto `report` | VERIFICADO |
| Temperatura mín./máx. | Clima e Saúde `temperatura.minima/maxima`; fallback Open-Meteo `temperature_2m_min/max` | município MS ou coordenadas da base | arredondamento documentado; fonte por campo | mesmo `report` | VERIFICADO |
| Umidade mín./máx. | Clima e Saúde quando publicada; fallback `relative_humidity_2m` | base | mínimo/máximo da janela; % | mesmo `report` | VERIFICADO |
| Vento médio | Open-Meteo `wind_speed_10m`; INMET fornece direção/intensidade textual | base/período | máximo do período e faixa textual | tabelas do relatório | VERIFICADO |
| Rajada | INMET somente se houver campo numérico oficial; fallback `wind_gusts_10m` | base/período | máximo em km/h; sem valor vira `null` | cards/tabelas | VERIFICADO |
| Chuva horária/período | INMET somente se publicar mm; fallback Open-Meteo `precipitation` | base/período | soma apenas de série completa; máximo horário separado | site/PDF/e-mail | VERIFICADO |
| Probabilidade de chuva | Open-Meteo `precipitation_probability` | base/período | máximo do período | site/PDF | VERIFICADO |
| Tempestade | código WMO de trovoada | base/período | conjunto explícito de códigos | classificação interna, nunca aviso oficial | VERIFICADO |
| PM2,5/PM10 | CAMS via Open-Meteo `pm2_5`/`pm10`; fallback Windy só para concentração PM2,5 | coordenadas | média das amostras; uma casa decimal | PDF; resumo do e-mail usa apenas AQI oficial | VERIFICADO |
| Qualidade do ar | `european_aqi_pm2_5` | coordenadas | máximo diário e faixas europeias oficiais | site/PDF/e-mail | VERIFICADO após correção |
| Índice UV | Open-Meteo Air `uv_index` | coordenadas | máximo e horário do pico; faixas técnicas | site/PDF/e-mail | VERIFICADO |
| Ondas/marulho | Marine `wave_height`, `wave_period`, `wave_direction`, `swell_wave_height`, `swell_wave_period` | ponto costeiro | máximo/média/direção circular | site/PDF/e-mail | VERIFICADO por contrato/teste |
| EHF | HTML oficial Clima e Saúde, rótulos semânticos por data | município | nenhuma inferência por temperatura; mapeia classe oficial para prontidão CIM | site/PDF/e-mail | VERIFICADO por página/contrato/teste |
| Risco combinado | Clima e Saúde/GeoSES | município | preservado como informação de saúde; não substitui EHF | seção técnica | VERIFICADO |
| Aviso oficial | INMET `/avisos/ativos` | código IBGE/geocodes | preserva fenômeno, severidade, vigência, riscos e instruções | tabelas/cards quando aplicável | VERIFICADO por parser/teste |
| Classificação CIM | `riskEngine.js` e protocolos internos | base | limiares documentados de chuva, vento, UV, ar e mar | identificada como classificação interna | VERIFICADO |
| Monitor de Secas | ANA, competência e descrição por UF | UF | sem interpolar município; mapa mensal validado por hash | PDF | VERIFICADO por cache/contrato |

O fluxo diário é `fonte → normalização → reportBuilder → mesmo snapshot em memória → painel/PDF/e-mail`. `geradoEmISO`, `horaConsulta`, `fontesPorCampo`, os diagnósticos de fallback e os horários de cache fornecem a referência do snapshot. Gerações feitas em horários distintos podem legitimamente divergir.

## D. Verificação de dados reais

- **VERIFICADO:** origem e transformação de temperatura, umidade, vento, rajada, chuva, probabilidade, condição WMO, PM, AQI, UV, ondas, EHF, avisos INMET e classificações internas. “Verificado” aqui significa contrato + código + testes; não significa que todos os endpoints responderam ao vivo nesta execução.
- **DIVERGENTE:** nenhum valor numérico concreto pôde ser comparado ponta a ponta com uma resposta ao vivo, porque a rede do processo estava bloqueada. As divergências de semântica encontradas foram corrigidas: `current` de modelo, classificação de ar no fallback e fuso Windy.
- **INDISPONÍVEL:** SharePoint/GED não configurado; Oceanop sem vínculo de área; consultas ao vivo indisponíveis nesta sessão; SMTP intencionalmente desativado.
- **NÃO VERIFICADO:** correspondência das coordenadas com o ponto físico exato de cada instalação e unidades/fuso do contrato Oceanop.

Classificação de natureza:

- Open-Meteo Weather, Air, Marine e Windy: **previsões/estimativas de modelo**, não estações observadas.
- Clima e Saúde para hoje e D+1…D+4: **previsão oficial do painel**; o próprio MS informa que hoje só vira observado no dia seguinte.
- ANA: **produto mensal de monitoramento/classificação regional**.
- INMET `/avisos/ativos`: **aviso oficial**.
- Regras de `riskEngine.js`, `weeklyBuilder.js` e `alertWatcher.js`: **classificações internas CIM**, mesmo quando calculadas de dados legítimos.
- COR-Rio: **estado e comunicados oficiais municipais**, exclusivos do Rio e com distribuição própria.

## E. Falhas identificadas

| Arquivo/função | Problema | Impacto | Evidência | Correção |
|---|---|---|---|---|
| `src/sources/openMeteo.js` — `buscarOpenMeteo` | bloco `current` não indicava que era saída de modelo | painel podia chamar previsão de “condição atual” como se fosse observação | documentação Open-Meteo diz que current usa dados de modelo de 15 min | adicionados `fonte: Open-Meteo` e `previsao: true` |
| `src/sources/windy.js` + `src/logic/windyMerge.js` | concentração PM2,5 do fallback Windy recebia classificação interna e podia parecer European AQI/CAMS | atribuição indevida da classificação | o Windy fornecia PM2,5/AQI US, não `european_aqi_pm2_5` | fallback mantém concentração, remove classificação; render exige AQI oficial |
| `src/sources/windy.js` — `bounds`/cache | dia civil era sempre São Paulo e o fuso não fazia parte da chave | Manaus podia usar horas/data erradas e compartilhar entrada incompatível | limite fixo `-03:00` e `America/Sao_Paulo` | cálculo por IANA da base e chave de cache com fuso |
| `src/logic/weeklyBuilder.js` — `avaliarDia` | ausência de indicadores podia resultar em “Normal” | normalidade presumida sem dados | `null ?? 0` e redutor iniciado em NORMAL | novo estado INDISPONÍVEL; Normal exige os indicadores; risco confirmado ainda prevalece |

### Dados simulados e hardcoded

- Não há `Math.random()` nem gerador meteorológico aleatório no código de produção.
- Fixtures e mocks estão em `tests/`.
- `artifacts/verify-*.cjs` e arquivos sob `artifacts/` contêm textos simulados explicitamente marcados para validação visual e não são importados pelas rotas ou agendadores.
- Limiares hardcoded encontrados são regras do protocolo CIM ou faixas oficiais, não medições meteorológicas.
- Placeholders encontrados são apenas exemplos de campos HTML.

## F. Comparação das informações

Não é apresentado “exemplo real” numérico, pois nenhuma resposta de endpoint pôde ser obtida pelo processo nesta execução. Inventar um exemplo contrariaria o objetivo da auditoria.

As comparações matemáticas comprovadas com fixtures identificadas como teste foram:

- velocidade Windy: `10 m/s × 3,6 = 36 km/h`;
- temperatura Windy: `300 K − 273,15 = 26,85 °C`, exibida como `26,9 °C`;
- direção circular: 359° e 1° resultam em Norte, não em 180°;
- chuva Windy: só soma janelas trihorárias completas e não preenche lacunas com zero;
- Open-Meteo: somas/máximos usam as mesmas janelas 05h–12h, 12h–18h e 18h–00h exibidas;
- AQI: a classe só é calculada quando `european_aqi_pm2_5` é numérico.

Esses números são evidência de transformação do software, **não evidência de produção**.

## G. Alterações realizadas

- `src/sources/openMeteo.js`: marcou `current` como previsão de modelo e registrou a fonte.
- `src/logic/informativoValidity.js`: exportou utilitários existentes de conversão de fuso para reutilização segura.
- `src/sources/windy.js`: passou a respeitar o fuso da base, incluiu fuso na chave de cache e removeu classificação local de PM2,5.
- `src/logic/windyMerge.js`: limitou o fallback de ar a concentração/AQI US e impediu classificação falsa como CAMS.
- `src/render/emailTemplate.js`: mostra qualidade do ar classificada apenas com AQI oficial.
- `src/render/pdfTemplate.js`: não atribui classificação Open-Meteo/CAMS quando o AQI oficial está ausente.
- `src/logic/weeklyBuilder.js`: impede que dado ausente vire “Normal”.
- `tests/relatorioAgendado.test.js`, `tests/windy.test.js`, `tests/emailInformativoCompleto.test.js`, `tests/pdfInformativoCards.test.js` e `tests/weeklyBuilder.test.js`: regressões específicas.

As demais alterações já existentes no worktree não foram revertidas nem reivindicadas como parte desta auditoria.

## H. Resultados dos testes

### Executados

- Suíte completa final: **313 aprovados, 0 falhas**.
- Testes focados nas correções: **52 aprovados, 0 falhas**.
- Cobertura exercitada: resposta válida mockada, vazio, HTTP 204/400/401/403/429/500/503, timeout real/simulado, DNS/reset, unidade e fuso divergentes, campos ausentes, cache antigo identificado, isolamento por base, deduplicação, avisos oficiais, classes internas, geração HTML/PDF e montagem de e-mail com transporte mockado.
- Nenhum teste disparou e-mail real; testes de envio substituem o transporte.

### Não executados

- Consulta real dos endpoints a partir do processo Node: egress bloqueado; tentativa direta resultou em `fetch failed` e a liberação externa não pôde ser processada pelo ambiente.
- SMTP real: proibido pelo escopo e `EMAIL_ACTIVE=false`.
- Upload Graph/SharePoint: variáveis ausentes.
- Oceanop real: nenhuma área vinculada e contrato incompleto.

## I. Localidades e pendências

### I.1 Bases cadastradas

| Base | Município/UF para APIs municipais | Coordenadas meteorológicas | IBGE | Fuso | Observação |
|---|---|---:|---:|---|---|
| Rio de Janeiro | Rio de Janeiro/RJ | -22.9068, -43.1729 | 3304557 | America/Sao_Paulo | COR-Rio só nesta base |
| Macaé | Macaé/RJ | -22.2828305, -41.9649091 | 3302403 | America/Sao_Paulo | costeira |
| Cabiúnas (Terminal) | Macaé/RJ | -22.2877258, -41.719347 | 3302403 | America/Sao_Paulo | município compartilhado legitimamente; coordenada própria |
| Brasília | Brasília/DF | -15.7939869, -47.8828 | 5300108 | America/Sao_Paulo | não costeira |
| Manaus | Manaus/AM | -3.1316333, -59.9825041 | 1302603 | America/Manaus | fuso especial coberto pela correção Windy |
| Santos | Santos/SP | -23.9609448, -46.3166316 | 3548500 | America/Sao_Paulo | costeira |
| Aracaju | Aracaju/SE | -10.9162061, -37.0774655 | 2800308 | America/Sao_Paulo | costeira |
| Linhares | Linhares/ES | -19.3796775, -40.0610087 | 3203205 | America/Sao_Paulo | mar usa ponto Regência: -19.6486, -39.8258 |
| Anchieta | Anchieta/ES | -20.8057672, -40.6454564 | 3200409 | America/Sao_Paulo | costeira |
| Vitória | Vitória/ES | -20.3200917, -40.3376682 | 3205309 | America/Sao_Paulo | costeira |
| Araucária | Araucária/PR | -25.5861107, -49.4051209 | 4101804 | America/Sao_Paulo | não costeira |
| Salvador | Salvador/BA | -12.9777, -38.5016 | 2927408 | America/Sao_Paulo | costeira |

Os 11 municípios/códigos distintos correspondem à tabela oficial do IBGE; Cabiúnas usa corretamente Macaé. Isso valida o identificador municipal, **não a posição física exata da instalação**. A confirmação patrimonial/geográfica das coordenadas, especialmente Terminal Cabiúnas e o ponto marítimo de Regência, depende de cadastro oficial da organização.

Caches: painel, Clima e Saúde e Marine são indexados por `cidade.chave`; Windy agora usa latitude, longitude, grupo, modelo, fuso e chave; ANA usa competência `AAAA-MM`; COR-Rio mantém partes independentes para estágio, calor e comunicados. Não foi encontrado cruzamento acidental de cache entre bases.

### I.2 Pendências obrigatórias

1. Reexecutar uma matriz ao vivo para as 12 bases em ambiente com egress: Open-Meteo, Air, Marine, INMET, Windy e Clima e Saúde; registrar payload bruto sanitizado, horário, ponto de grade e valor renderizado.
2. Validar as coordenadas das instalações contra cadastro corporativo/geodésico autorizado.
3. Obter contrato Oceanop com unidade, fuso, atualização, autenticação e identificadores; só então vincular áreas.
4. Configurar e testar GED/SharePoint em tenant de homologação.
5. Testar SMTP apenas em caixa de homologação e mediante autorização expressa; não usar destinatários operacionais para auditoria.
6. Considerar um `snapshotId` persistente se for necessário comparar uma geração do painel com outra geração posterior. Hoje, `geradoEmISO` rastreia cada objeto, mas não há hash persistido do payload integral.

## J. Conclusão

1. **Existem dados fictícios sendo utilizados em produção?** Não foi encontrado caminho de produção que gere ou importe valores meteorológicos fictícios. Há simulações isoladas em testes/artefatos, identificadas e fora do runtime.
2. **Todas as APIs estão funcionando?** Não é possível afirmar. A conectividade real dos endpoints não pôde ser executada nesta sessão; Oceanop e SharePoint também não estão operacionalmente configurados.
3. **Todas as informações exibidas possuem origem rastreável?** Após as correções, os campos principais têm origem e fallback rastreáveis no código. A lacuna restante é contratual/operacional: Oceanop, coordenadas físicas e prova ao vivo.
4. **Existem divergências entre API, site, PDF e e-mail?** Não nos testes automatizados que reutilizam o mesmo `report`. Não houve comparação numérica real com API ao vivo; portanto, a ausência de divergência de produção não está provada.
5. **Existem alertas incorretos ou sem sustentação?** Não após as correções testadas. Avisos INMET permanecem oficiais; regras CIM permanecem internas. A qualidade do ar sem European AQI deixa de receber classificação atribuída à CAMS, e o semanal deixa de tratar ausência como normal.
6. **O que impede considerar o sistema totalmente confiável?** Falta da bateria real de endpoints nas 12 bases, validação corporativa das coordenadas, contrato Oceanop, homologação SharePoint/SMTP e evidência ponta a ponta com payload real contemporâneo.

**Parecer:** o código ficou mais seguro quanto a proveniência, fuso e ausência de dados, e todos os testes executados passaram. Ainda assim, o sistema está **tecnicamente auditado, mas não 100% validado em produção**.
