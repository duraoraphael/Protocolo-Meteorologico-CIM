# Auditoria de divergências e dados indisponíveis — Protocolo Meteorológico CIM

**Data da coleta:** 23/10/2026, aproximadamente 10:45–10:49 BRT  
**Escopo:** cadastro executável (11 bases), integrações meteorológicas, normalização, fusos, cache, proveniência e renderização compartilhada pelo painel, PDF e e-mail.  
**Modo:** leitura e chamadas GET autorizadas. Nenhum e-mail foi enviado, nenhum PDF operacional foi publicado e nenhum dado meteorológico foi fabricado.

## Resumo

As previsões meteorológicas e marítimas da Open‑Meteo foram obtidas para todas as bases cadastradas nesta execução: 11/11 pontos meteorológicos e 8/8 pontos costeiros com ponto de mar cadastrado. INMET previsão e Clima e Saúde responderam para as 11 localidades. Os retornos são previsões de modelo ou produtos próprios das fontes, e não devem ser igualados entre provedores diferentes.

Não foi possível homologar rajadas previstas Tetra Tech: o portal público respondeu HTTP 200, mas o endpoint de áreas respondeu HTTP 403; além disso, o processo não dispõe de credenciais oficiais (`TETRATECH_CREDENTIALS_MISSING`). Portanto, nenhuma rajada Tetra Tech foi extraída e nenhuma rajada média, observada ou de outra localidade foi usada como substituta. A API OCEANOP por coordenadas não resolveu DNS neste ambiente (`ENOTFOUND`). Esses bloqueios não provam defeito do serviço dentro da rede corporativa.

Foi corrigida uma falha de diagnóstico na integração Open‑Meteo: antes, HTTP 200 com série horária/diária ausente ou desalinhada podia virar vários campos nulos sem indicar erro de integração. Agora o parser rejeita esse payload como `OPEN_METEO_INVALID_SERIES`. Zero e nulos dentro de séries alinhadas continuam válidos e distintos.

Não há captura histórica auditável dos valores exibidos antes desta rodada, nem snapshot bruto da emissão que estava anteriormente no painel/PDF/e-mail. Assim, o relatório não inventa “valor antes” nem declara divergência com um site original sem uma comparação de mesma emissão, hora, ponto e produto. A tabela abaixo registra o valor normalizado recebido nesta coleta e deixa o baseline anterior explicitamente sem evidência.

## Constatações e correções

| Base | Variável | Fonte | Problema | Causa identificada | Correção | Status |
|---|---|---|---|---|---|---|
| Todas (11) | Séries horárias e diárias Open‑Meteo | Open‑Meteo Forecast | Resposta HTTP bem-sucedida incompleta poderia deixar campos vazios sem indicar erro de integração | `validarResposta` verificava timestamps e fuso, mas não presença/alinhamento de cada série solicitada | Validar séries horárias e diárias e rejeitar ausência/desalinhamento com código de parser; nulos e zero em arrays válidos são preservados | Corrigido; teste de regressão aprovado |
| Rio, Macaé, Santos, Vitória, Aracaju, Natal, Oiapoque, Salvador | Rajada máxima prevista | Tetra Tech TTForecast | Sem valor confirmado nesta coleta | O endpoint de áreas retornou 403 e faltam credenciais oficiais; o cliente recusa seguir sem chave/token | Sem substituição por vento médio/observado. Mantido como indisponível até credencial e resposta autorizadas | Pendente externo |
| Todas (11) | Produtos OCEANOP | Petrobras OCEANOP | Sem resposta nesta execução | Falha de DNS (`ENOTFOUND`) para `oceanop-api-disp.petrobras.com.br` neste ambiente | Nenhum valor foi aceito; manter falha visível e repetir em rede corporativa autorizada | Pendente de rede; sem conclusão sobre disponibilidade corporativa |
| Brasíla, Manaus, Araucária | Ondas | Open‑Meteo Marine | Não se aplica ao cadastro atual | Não há ponto marítimo configurado e as bases são interiores | Não atribuir coordenada oceânica arbitrária nem apresentar onda | Correto / não se aplica |
| Todas as bases | Valores entre painel, PDF e e-mail | Objeto do relatório CIM | Não foi possível reconstituir divergência histórica nesta rodada | Não havia snapshot da mesma emissão nem cópias dos documentos enviados | Painel, PDF e e-mail compartilham o relatório montado; continuam associados ao valor e fonte registrados no objeto. Comparação histórica permanece sem baseline | Não comprovado como divergência |

> “Corrigido” na primeira linha refere-se à mudança desta rodada. As demais proteções e regras descritas a seguir já estavam implementadas no estado encontrado do projeto e foram auditadas, não reaplicadas.

## APIs, parâmetros e respostas

| Fonte | Endpoint/parâmetros usados pelo runtime | Evidência desta rodada | Parser, atualização e limitações |
|---|---|---|---|
| Open‑Meteo Forecast | `GET https://api.open-meteo.com/v1/forecast`; latitude/longitude da base, `current=temperature_2m,weather_code,is_day`, hourly `temperature_2m,relative_humidity_2m,precipitation_probability,precipitation,wind_speed_10m,wind_direction_10m,weather_code,uv_index`, daily `temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,weather_code,uv_index_max`, `wind_speed_unit=kmh`, fuso da base e `forecast_days=4` | HTTP 200 confirmado em 11/11 chamadas; resposta JSON com blocos `current`, `hourly`, `hourly_units`, `daily`, `daily_units`, fuso e séries alinhadas. Datas da coleta: 23–26/10. Hora do bloco `current`: 10:45 BRT (Manaus 09:45 no fuso `America/Manaus`) | Temperatura °C, precipitação mm, probabilidade %, vento km/h, direção ° e UV índice. Probabilidade não é multiplicada por 100. UV diário usa `uv_index_max` e expõe horário do pico horário quando encontrado. `forecast_days=4` inclui hoje + D+1, D+2 e D+3. Unidade comercial/customer exige credencial em produção. A chamada de aplicação não captura o ciclo de emissão do modelo; horário `current.time` é timestamp local do dado, não hora de inicialização do modelo. |
| Open‑Meteo Marine | `GET https://marine-api.open-meteo.com/v1/marine`; ponto `pontoMar`, fuso local, `forecast_days=1`, hourly `wave_height,wave_period,wave_direction,wind_wave_height,swell_wave_height,swell_wave_direction,swell_wave_period,sea_surface_temperature` | HTTP 200 confirmado em 8/8 chamadas; oito pontos costeiros retornaram ondas com séries em três períodos do dia | Alturas em metros, período em segundos, direção em graus, temperatura da superfície em °C. Falta de ponto, série vazia ou coordenada sem cobertura gera erro separado; cache é identificado pela chave da base. A validação não substitui homologação patrimonial dos pontos costeiros. |
| Tetra Tech TTForecast | Cliente usa `/api/v1/areas/json`, `/api/v1/bulletins/{idArea}` e autenticação via `X-API-Key`, token Bearer ou OAuth configurado. Campo previsto: `10_metre_wind_gust_since_previous_post_processing` (série base m/s), convertido para km/h; maior valor diário selecionado na data local | Página do portal HTTP 200; áreas HTTP 403. Cliente local não encontrou credencial. Nenhuma resposta de boletim foi lida | Links/cidades habilitados no cadastro: Rio, Macaé, Santos, Vitória, Oiapoque, Natal, Brasília, Manaus, Salvador e Aracaju. Araucária/Wenceslau Bráz permanece desabilitada por equivalência não validada. Sem dados reais não foi possível confirmar IDs, variável da tabela no boletim nem horários/valores máximos. Cache por área/data, TTL de 10 min e reutilização por datas válidas; sem credencial não há chamada autenticada. |
| INMET previsão | `GET https://apiprevmet3.inmet.gov.br/previsao/{codigoIbge}` | HTTP 200 em 11/11 bases; a resposta normalizada continha data local, períodos manhã/tarde/noite e cinco dias | Parser municipal pelo código IBGE; campos não publicados permanecem ausentes. Este produto publica previsão municipal por turnos e não fornece necessariamente probabilidade, chuva numérica, UV ou rajada. A documentação pública do INMET descreve previsão municipal para as próximas 48h em turnos. |
| INMET avisos | `GET https://apiprevmet3.inmet.gov.br/avisos/ativos` | HTTP 200; um aviso retornado na consulta usada pelo relatório ao consultar Rio | Aplicação depende de município/UF, geometria, vigência e período. Não foi realizada comparação dos avisos vigentes em cada base nesta execução. |
| INMET observação | `GET https://apiprevmet3.inmet.gov.br/estacao/proxima/{codigoIbge}` e catálogo de estações | Não consultado ao vivo nesta rodada | Conversões e ausência de campos têm cobertura de testes existente. Observação medida fica separada da previsão; zero observado não deve ser confundido com ausência. |
| Clima e Saúde | Página oficial municipal `https://clima.saude.gov.br/{uf}/{municipio}?modo=ehf` | HTTP 200 e status da fonte operacional em 11/11 bases; resposta interpretada para data de 23/10/2026 | Integração lê HTML, não foi identificada API/Swagger público estável. Mudança do HTML pode produzir erro de parsing; a ausência é mostrada como indisponível, sem valor fabricado. |
| ANA — Monitor de Secas | API `https://apimsbr.ana.gov.br/rest/cms-msne/mapa-monitor` e objetos PNG estaduais no bucket público | Sem consulta ao vivo nesta execução. Relatório anterior `RELATORIO_AUDITORIA_APIS_METEOROLOGICAS.md` registra resposta HTTP 200 em 22/10/2026, mapa final 2026-09 e mapas estaduais | Cache mensal com validação de competência, mapa final, UF, PNG, CRC/ETag e última cópia válida. Evidência anterior não equivale a uma checagem da publicação de 23/10. O dado não é previsão diária meteorológica. |
| OCEANOP por área/coordenação | Runtime possui consulta de previsão e endpoint por local; requisição exige correspondência da área/base no payload antes de promover ou armazenar | `ENOTFOUND` neste ambiente; swagger não acessível. Documento anterior registra HTTP 401 em 22/10/2026 para consulta por área autenticada | Sem resposta autorizada nesta rodada não foi possível analisar estrutura, HTTP de aplicação, variáveis retornadas ou unidades. Falha é isolada, não reaproveitada entre localidades. |
| Qualidade do ar/CAMS (PM2,5/PM10/AQI) | **Inativo no código atual**: `src/sources/airQuality.js` está removido na árvore de trabalho e `reportBuilder` não chama `buscarQualidadeAr`; o host permitido em `openMeteoConfig.js` não ativa uma coleta por si só | Nenhuma requisição de qualidade do ar foi feita nesta rodada; a indisponibilidade exibida é consequência da integração não estar ligada ao fluxo, não uma resposta vazia comprovada da API | O objeto ainda é renderizado, mas só recebe UV do endpoint Weather; concentrações e AQI ficam nulos. O UV meteorológico não substitui PM2,5/PM10. A versão removida do conector exigia chave comercial em produção. Reativação requer restaurar a coleta e confirmar credencial/licença antes de publicar em produção. |
| COR‑Rio | Integração municipal de estágio, calor e comunicados | Rio consultado no relatório de APIs de 22/10/2026; não consultado nesta rodada | Aplicável apenas ao Rio. Estágio operacional, estágio de calor e comunicados são estados separados. |

As variáveis e unidades de Open‑Meteo foram conferidas com a [documentação atual da Weather Forecast API](https://open-meteo.com/en/docs) e da [Marine Weather API](https://open-meteo.com/en/docs/marine-weather-api). O portal oficial do [INMET descreve a previsão por município e turnos](https://portal.inmet.gov.br/servicos/previs%C3%A3o-do-tempo). A fonte Open‑Meteo concatena modelos na previsão contínua; não se deve tratar uma atualização do endpoint como identificação exata do ciclo de um modelo. Para comparação de emissão específica é necessário solicitar uma API/run apropriada ou preservar o payload daquela coleta.

### Inspeção pública da página dinâmica TTForecast

A página Rio `/bulletin/forecast-table/Terrestre/Rio%20de%20Janeiro` respondeu HTTP 200 (`text/html`, título “Portal Previsão Meteoceanográfica - Tetra Tech”) e carregou bundles `runtime`, `polyfills` e `main`. O bundle principal respondeu HTTP 200 e contém `https://petrobras.ttforecast.com.br/api/v1`, a rota de boletim `${base}/bulletins/${areaId}` e o campo `10_metre_wind_gust_since_previous_post_processing`. Isso confirma que os dados da tabela são carregados por JavaScript e que o cliente procura uma série de rajada específica.

Também foi feita uma chamada pública sem credencial para `/api/v1/areas/json`, que retornou HTTP 403. Não foi usado navegador automatizado nem tentativa de contornar o controle de acesso; sem autorização, página autenticada/boletim não foi acessado. O código existente já usa a API e não exige Playwright para obter a resposta quando dispõe de credencial oficial. Sem payload não se confirmam nomes/IDs de áreas, unidade efetivamente declarada no boletim, horários ou máximas dos dez locais.

## Matriz de disponibilidade por base

`OK` significa que a coleta normalizada respondeu na execução de 23/10; não é uma garantia futura nem confirmação de valores do portal de terceiros. “Indisponível” indica dado não obtido ou sem proveniência autorizada. Ondas interiores são “não se aplica”.

| Base | Temperatura | Umidade | Chuva | Prob. chuva | UV | Vento médio/direção | Rajada prevista | Condições gerais | Ondas | Excesso de calor | Avisos oficiais |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Rio de Janeiro | OK | OK | OK | OK | OK | OK | Indisponível (Tetra sem credencial) | OK | OK | OK (Clima e Saúde) | INMET respondeu; filtro específico não revalidado |
| Macaé | OK | OK | OK | OK | OK | OK | Indisponível (Tetra sem credencial) | OK | OK (Clima e Saúde) | INMET respondeu; filtro específico não revalidado |
| Brasília | OK | OK | OK | OK | OK | OK | Indisponível (Tetra sem credencial) | Não se aplica | OK (Clima e Saúde) | INMET respondeu; filtro específico não revalidado |
| Manaus | OK | OK | OK | OK | OK | OK | Indisponível (Tetra sem credencial) | Não se aplica | OK (Clima e Saúde) | INMET respondeu; filtro específico não revalidado |
| Santos | OK | OK | OK | OK | OK | OK | Indisponível (Tetra sem credencial) | OK | OK (Clima e Saúde) | INMET respondeu; filtro específico não revalidado |
| Aracaju | OK | OK | OK | OK | OK | OK | Indisponível (Tetra sem credencial) | OK | OK (Clima e Saúde) | INMET respondeu; filtro específico não revalidado |
| Natal | OK | OK | OK | OK | OK | OK | Indisponível (Tetra sem credencial) | OK | OK (Clima e Saúde) | INMET respondeu; filtro específico não revalidado |
| Oiapoque | OK | OK | OK | OK | OK | OK | Indisponível (Tetra sem credencial) | OK | OK (Clima e Saúde) | INMET respondeu; filtro específico não revalidado |
| Vitória | OK | OK | OK | OK | OK | OK | Indisponível (Tetra sem credencial) | OK | OK (Clima e Saúde) | INMET respondeu; filtro específico não revalidado |
| Araucária | OK | OK | OK | OK | OK | OK | Não configurada (local de referência não validado) | Não se aplica | OK (Clima e Saúde) | INMET respondeu; filtro específico não revalidado |
| Salvador | OK | OK | OK | OK | OK | OK | Indisponível (Tetra sem credencial) | OK | OK (Clima e Saúde) | INMET respondeu; filtro específico não revalidado |

Open‑Meteo Marine respondeu nas oito bases com `costeira: true` e `pontoMar` cadastrado. Clima e Saúde respondeu nas 11 bases. A consulta corrente da API OCEANOP falhou por DNS, portanto não se promoveu dado OCEANOP nesta matriz.

## Comparação de valores observados nesta coleta

### Coordenadas do ponto efetivamente retornado pela grade Open‑Meteo

| Base | Coordenada solicitada | Coordenada retornada pela API | Fuso |
|---|---:|---:|---|
| Rio de Janeiro | -22.9068, -43.1729 | -22.952549, -43.215027 | `America/Sao_Paulo` |
| Macaé | -22.2828305, -41.9649091 | -22.31986, -41.97519 | `America/Sao_Paulo` |
| Brasília | -15.7939869, -47.8828 | -15.782073, -47.88678 | `America/Sao_Paulo` |
| Manaus | -3.1316333, -59.9825041 | -3.1282952, -59.95163 | `America/Manaus` |
| Santos | -23.9609448, -46.3166316 | -23.936731, -46.334747 | `America/Sao_Paulo` |
| Aracaju | -10.9162061, -37.0774655 | -10.931458, -37.068207 | `America/Sao_Paulo` |
| Natal | -5.8115, -35.2415 | -5.7996483, -35.266235 | `America/Fortaleza` |
| Oiapoque | 3.861224, -51.796699 | 3.8312829, -51.8049 | `America/Belem` |
| Vitória | -20.3200917, -40.3376682 | -20.351494, -40.341705 | `America/Sao_Paulo` |
| Araucária | -25.5861107, -49.4051209 | -25.623901, -49.40219 | `America/Sao_Paulo` |
| Salvador | -12.9777, -38.5016 | -12.970122, -38.45456 | `America/Sao_Paulo` |

Para o Marine, a API também informa a célula costeira efetivamente usada. Ela consta da lista de pontos marítimos abaixo; a célula devolvida pode diferir do ponto solicitado por discretização da grade.

Valores Open‑Meteo do dia local **23/10/2026**, consultados às **10:45 BRT** (Manaus 09:45 local), com `forecast_days=4` e fusos da tabela. “Valor na fonte” abaixo é o valor devolvido pela API já lido pelo adaptador, com a transformação declarada; não é uma captura independente do portal gráfico. O ciclo de execução do modelo não veio exposto no objeto interpretado. “Valor antes” não foi preservado e por isso aparece como não registrado.

| Base | Variável | Valor no sistema antes | Valor na fonte | Valor após correção |
|---|---|---|---|---|
| Rio de Janeiro (-22.9068, -43.1729; `America/Sao_Paulo`) | Tmáx diária | Não registrado | 25 °C | 25 °C; consulta 23/10 10:45 BRT; dia 23/10; ciclo do modelo não exposto |
| Macaé (-22.2828305, -41.9649091; `America/Sao_Paulo`) | Tmáx diária | Não registrado | 26 °C | 26 °C; consulta 23/10 10:45 BRT; dia 23/10; ciclo do modelo não exposto |
| Brasília (-15.7939869, -47.8828; `America/Sao_Paulo`) | Tmáx diária | Não registrado | 31 °C | 31 °C; consulta 23/10 10:45 BRT; dia 23/10; ciclo do modelo não exposto |
| Manaus (-3.1316333, -59.9825041; `America/Manaus`) | Tmáx diária | Não registrado | 35 °C | 35 °C; consulta 23/10 09:45 local; dia 23/10; ciclo do modelo não exposto |
| Santos (-23.9609448, -46.3166316; `America/Sao_Paulo`) | Tmáx diária | Não registrado | 24 °C | 24 °C; consulta 23/10 10:45 BRT; dia 23/10; ciclo do modelo não exposto |
| Aracaju (-10.9162061, -37.0774655; `America/Sao_Paulo`) | Tmáx diária | Não registrado | 28 °C | 28 °C; consulta 23/10 10:45 BRT; dia 23/10; ciclo do modelo não exposto |
| Natal (-5.8115, -35.2415; `America/Fortaleza`) | Tmáx diária | Não registrado | 30 °C | 30 °C; consulta 23/10 10:45 local; dia 23/10; ciclo do modelo não exposto |
| Oiapoque (3.861224, -51.796699; `America/Belem`) | Tmáx diária | Não registrado | 33 °C | 33 °C; consulta 23/10 10:45 local; dia 23/10; ciclo do modelo não exposto |
| Vitória (-20.3200917, -40.3376682; `America/Sao_Paulo`) | Tmáx diária | Não registrado | 26 °C | 26 °C; consulta 23/10 10:45 BRT; dia 23/10; ciclo do modelo não exposto |
| Salvador (-12.9777, -38.5016; `America/Sao_Paulo`) | Tmáx diária | Não registrado | 29 °C | 29 °C; consulta 23/10 10:45 BRT; dia 23/10; ciclo do modelo não exposto |

Os valores acima não são comparáveis diretamente com INMET ou outro modelo, pois produto, hora de emissão e janela podem diferir. Para o mar, as alturas máximas diárias normalizadas nesta mesma coleta foram: Rio 1,7 m; Macaé 1,2 m; Santos 1,6 m; Aracaju 1,5 m; Natal 1,3 m; Oiapoque 0,4 m; Vitória 1,3 m; Salvador 1,4 m. Pontos oceânicos configurados: Rio (-23.1, -43.12), Macaé (-22.4, -41.7), Santos (-24.1, -46.25), Aracaju (-11.05, -36.98), Natal (-5.82, -35.1), Oiapoque (4.1, -51.2), Vitória (-20.38, -40.2), Salvador (-13.05, -38.3). São referências de grade/ponto de mar do cadastro, não coordenadas das estações terrestres.

## Fluxo de dados e indisponibilidade

- O parser meteorológico gera um objeto consolidado associado a `cidade.chave`; o atualizador mantém cache por base e preserva o último relatório válido em falha. Painel lê `/api/preview`; a geração operacional usa o mesmo relatório para PDF e e-mail.
- Os renderizadores recebem `fontesPorCampo`, mantendo fonte da previsão, observação, rajada e mar separadas. `0` permanece número válido em filtros `Number.isFinite`; ausências seguem nulas/indisponíveis.
- Mar usa chave de cache por base. O ponto precisa estar cadastrado e responder com dados. Brasília, Manaus e Araucária não têm ponto marítimo.
- Rajada Open‑Meteo é intencionalmente `null`: vento sustentado não equivale a rajada. O dado previsto priorizado pelo cliente é Tetra Tech quando credencial e boletim autorizados estão disponíveis.
- D+1 a D+3 é obtido usando hoje + três dias (`forecast_days=4`) e as datas locais. O relatório semanal tem integração distinta; não se devem comparar janelas diárias sem alinhar datas e fusos.
- INMET é fonte municipal oficial para previsão em turnos. Campos que não vieram na previsão não são inferidos da observação da estação.
- ANA é um produto mensal de secas, e Clima e Saúde fornece indicador de calor/EHF; nenhum deles substitui variáveis horárias da previsão.

## Testes e validação

- Ao vivo, `npm run validar-integracao-meteo`: 11/11 meteorologia Open‑Meteo com resposta válida; 8/8 pontos Marine com ondas válidas; 3 bases interiores sem consulta Marine; rajada Tetra falhou por credencial ausente (10 cidades habilitadas) e Araucária permaneceu não configurada.
- Ao vivo, `node scripts/auditarFontesReais.js`: previsão INMET HTTP 200 em todas as 11 bases; Clima e Saúde HTTP 200 em todas; avisos INMET consultados para Rio; OCEANOP por coordenadas com DNS `ENOTFOUND`; portal TT HTTP 200 e API de áreas HTTP 403. ANA e INMET Observação não foram chamados nesse script.
- Testes diretos: `openMeteoIntegration` 4/4; `openMeteoConfig` 4/4; `previsaoProximosDias` 1/1; `tetratechGusts` 8/8; `oceanop` 20/20.
- `npm test` (runner Node em lote) não pôde iniciar seus workers: os 58 arquivos encerraram com `spawn EPERM` antes da execução. Executando os arquivos diretamente, 57/58 passaram; `senhaObrigatoria.test.js` teve 3/4 testes aprovados e falhou no teste que cria `node server.js` como subprocesso (`spawnSync` retorna `status: null`), coerente com a restrição do ambiente. Logo, a suíte completa não está aprovada nem foi integralmente executada.
- Foram cobertos nos testes existentes conversão de unidades, zero/nulo, falta de credencial, timeouts/erros HTTP, cache, localidade, horários e agregações; a nova verificação cobre séries Open‑Meteo ausentes/desalinhadas. Não foi possível fazer teste de envio real de e-mail (intencionalmente não executado) nem comparar um PDF/e-mail emitido na mesma coleta contra uma captura arquivada do portal.

## Arquivos alterados nesta auditoria

- `src/sources/openMeteo.js` — valida séries horárias e diárias solicitadas antes de transformar o JSON.
- `tests/openMeteoIntegration.test.js` — regressão para resposta HTTP 200 com série ausente/desalinhada.
- `scripts/validarIntegracaoOpenMeteo.js` — saída da validação inclui coordenadas solicitadas e de grade retornadas, fuso, HTTP, séries presentes, datas e hora local de previsão.
- `RELATORIO_AUDITORIA_DIVERGENCIAS_CIM.md` — este relatório.

O diretório já continha várias alterações antes desta auditoria. Elas foram preservadas e não estão atribuídas a este trabalho. Nenhuma mudança foi feita em destinatários, agendamento de e-mails, cadastro de bases ou layouts.

## Pendências para homologação completa

1. Executar a coleta Tetra Tech na rede autorizada e configurar credencial oficial; guardar status HTTP, payload anonimizado, `info`/atualização, séries de rajada e horários dos dez boletins pedidos. Confirmar os identificadores e unidades mostrados nas tabelas do portal.
2. Repetir OCEANOP no contexto de rede onde DNS e autenticação corporativos estejam disponíveis; auditar HTTP, corpo e `Local` de retorno por base.
3. Fazer captura sincronizada de uma emissão CIM e das respectivas páginas oficiais, preservando hora, fuso, coordenadas, data do produto, unidades e valor bruto. Sem essa captura não há “valor antes” confiável para comparação.
4. Rodar suíte completa em ambiente que permita subprocessos do Node e validar geração do PDF sem envio SMTP.
5. Confirmar com cadastro geoespacial corporativo que coordenadas municipais e pontos de mar correspondem às instalações/áreas operacionais pretendidas.

**Conclusão:** as previsões Open‑Meteo e os produtos Marine cadastrados responderam e passaram pelo parser, e a validação Open‑Meteo agora explicita payloads parciais incompatíveis. As divergências históricas entre documentos e páginas oficiais não podem ser afirmadas sem a emissão anterior. A rajada Tetra Tech e os dados OCEANOP continuam não homologados nesta execução devido à falta de credencial e ao bloqueio de rede/autorização observados.
