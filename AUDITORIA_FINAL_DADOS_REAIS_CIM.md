# Auditoria final de dados reais — CIM

**Data da auditoria:** 15/10/2026

**Escopo:** fontes meteorológicas, normalização, caches, painel, PDF, e-mail, agendadores, alertas, identidade visual e remoção Windy.
**Regra de execução:** nenhuma mensagem real foi enviada, nenhum upload ao GED foi realizado e nenhuma implantação foi feita.

## Resumo executivo

A integração Windy permanece removida do código executável. A imagem Petrobras foi mantida fora do site e do corpo dos e-mails e restaurada exclusivamente no cabeçalho interno do PDF, reutilizando o asset oficial `Logo/Petrobras_horizontal_logo.svg.png`.

Foi mantida a barreira de procedência no backend. Um campo crítico ausente só é aceito quando aparece como `Indisponível` e possui metadados padronizados com fonte, data, localidade, natureza e estado; ausência sem justificativa continua bloqueando a publicação. Isso permite informar a falta legítima de umidade sem fabricar valor.

Na consulta real de 15/10/2026 para o Rio de Janeiro, a previsão municipal do INMET retornou 22–29 °C, 70–100%, condições distintas para manhã/tarde/noite e direção/intensidade textual do vento. O produto não publicou rajada numérica, velocidade média numérica, probabilidade de chuva nem volume previsto. Pela política vigente, esses números permanecem **indisponíveis**: chuva, vento e rajada previstos não recebem complemento de outro provedor.

Temperatura, umidade, condição, chuva, vento e rajada permanecem prioritariamente no INMET e podem receber complemento numérico identificado da Open-Meteo quando o produto oficial não publicar o campo. Medições da estação automática permanecem separadas dos campos previstos. O Clima e Saúde fornece EHF e risco térmico. O índice UV vem de `uv_index` do Open-Meteo Air Quality/CAMS e a condição do mar vem do Open-Meteo Marine.

**Parecer final:** a matriz de fontes foi ajustada para impedir atribuição cruzada. Ausência numérica no produto municipal do INMET aparece como `Dado indisponível`, sem converter texto qualitativo em número e sem utilizar previsão Open-Meteo para chuva, vento ou rajada. A publicação operacional continua condicionada à licença comercial Open-Meteo para UV/mar e à homologação geográfica/contratual.

### Implementação validada nesta revisão

- `src/logic/reportBuilder.js` consulta INMET, Open-Meteo Weather, Air Quality/CAMS, Marine, Clima e Saúde e avisos; o objeto consolidado alimenta painel, PDF e e-mail.
- `src/logic/weatherSourcePolicy.js` aplica exclusividade INMET para chuva, vento e rajada, registra a origem e explica a indisponibilidade quando o valor oficial não foi publicado.
- `src/sources/airQuality.js` consulta e normaliza `uv_index`, máximo e horário do pico.
- `src/logic/verificacaoFontes.js` passou a verificar Weather e UV e deixou de exigir umidade do Clima e Saúde, campo que o portal não publica.
- `src/sources/previsaoProximosDias.js` e `src/pipeline.js` priorizam chuva/rajada D+3 do INMET e usam complemento identificado da Open-Meteo, além da Open-Meteo para UV.
- `src/logic/weatherSourceMetadata.js`, `sourceProvenance.js`, `scheduledReport.js` e `src/render/pdfTemplate.js` registram natureza, fonte, período e textos coerentes.
- `artifacts/verify-live-weather.cjs` executa as edições 05h/15h sem enviar e-mail e confere a presença dos valores no HTML das duas superfícies.

Resultado real no Rio, em 15/10/2026: INMET 22–29 °C e 70–100%; direção/intensidade do vento pelo INMET; rajada e chuva numéricas indisponíveis no produto municipal; UV 8,4 pelo CAMS/Open-Meteo; mar máximo de 0,5 m pelo Open-Meteo Marine; Clima e Saúde EHF `Sem excesso`.

A verificação ao vivo final percorreu as 12 localidades configuradas. Open-Meteo Weather, INMET Previsão e Clima e Saúde responderam corretamente em todas elas. As observações do INMET também responderam, mas a estação selecionada para Santos não publicou chuva horária, velocidade/direção do vento nem rajada no momento da consulta; esses campos observados permanecem indisponíveis e não são substituídos silenciosamente por previsão.

No D+3, temperatura, umidade, condição, rajada e chuva permanecem prioritariamente no INMET; valores numéricos ausentes podem ser complementados pela Open-Meteo com fonte explícita. O índice UV vem da Open-Meteo.

### Correção complementar — tipografia, chuva e condição por base

- O corpo do e-mail passou a reutilizar o mesmo estilo inline para `Hora da consulta` e `Previsão até as 00h`: Arial, 16 px, peso normal no texto, negrito nos rótulos, `line-height: 1.4`, cor `#222222` e o mesmo espaçamento. A implementação permanece compatível com Gmail e Outlook por usar tabela e estilos inline.
- O corpo do e-mail mantém somente a grade resumida de oito indicadores. As tabelas `Temperatura e umidade`, `Vento por período` e `Chuva por período` ficam restritas ao PDF técnico.
- A grade dos oito indicadores usa uma tabela Outlook-safe de seis colunas lógicas: os seis primeiros cards ocupam `colspan="2"` e os cards `MAR` e `CONDIÇÃO GERAL` ocupam `colspan="3"`, garantindo a divisão 50/50, a mesma altura e bordas contínuas. Valores ausentes aparecem como `Dado indisponível`.
- O indicador diário foi renomeado para `Chuva acumulada/dia`. Seu período adotado é o dia civil local (00h–24h), composto somente pelas leituras horárias oficiais armazenadas cuja hora de referência pertence à data local; cobertura incompleta continua explícita.
- No PDF, `Chuva por período` foi restaurada com manhã, tarde e noite. O resumo textual vem da previsão municipal INMET; probabilidade e volume ficam `Não disponível` quando ausentes. `Chuva acumulada/Hora` continua em bloco observacional separado, com a hora oficial de referência.
- A condição geral deixou de selecionar sempre o período da tarde. Cada relatório cria um contexto meteorológico próprio, vinculado a `cidade.chave`, código IBGE, coordenadas e data da previsão, e usa uma única condição oficial predominante do dia para o respectivo município. Ausência resulta em `Condição indisponível`, sem herdar a condição de outra base.
- A validação real após reiniciar o servidor confirmou contextos separados: Rio de Janeiro (`3304557`), Macaé (`3302403`), Manaus (`1302603`) e Santos (`3548500`) retornaram seus próprios resumos. Cabiúnas e Macaé podem permanecer iguais legitimamente porque compartilham o município/código IBGE de Macaé.

## A. APIs ativas

| API | Variáveis utilizadas | Endpoint | Origem | Última validação | Status |
|---|---|---|---|---|---|
| Open-Meteo Weather | complemento identificado de temperatura/umidade e condição; não alimenta chuva, vento ou rajada | desenvolvimento: `https://api.open-meteo.com/v1/forecast`; produção: `https://customer-api.open-meteo.com/v1/forecast` | OpenMeteo GmbH e modelos meteorológicos listados pela fonte | 15/10/2026, HTTP 200 | **Operacional como complemento identificado; pendência comercial em produção** |
| Open-Meteo Air Quality / CAMS | PM2,5, PM10, European AQI PM2,5, poeira e UV | desenvolvimento: `https://air-quality-api.open-meteo.com/v1/air-quality`; produção: `https://customer-air-quality-api.open-meteo.com/v1/air-quality` | CAMS distribuído pela Open-Meteo | 15/10/2026, HTTP 200 | **Consulta real verificada, inclusive UV; mesma pendência comercial** |
| Open-Meteo Marine | altura, período e direção de ondas; marulho; temperatura da superfície do mar | desenvolvimento: `https://marine-api.open-meteo.com/v1/marine`; produção: `https://customer-marine-api.open-meteo.com/v1/marine` | modelos oceânicos distribuídos pela Open-Meteo | 15/10/2026, HTTP 200 | **Consulta real verificada; mesma pendência comercial** |
| INMET Previsão | condição, temperatura e umidade previstas; direção/intensidade textual do vento; campos numéricos opcionais de rajada/chuva | `https://apiprevmet3.inmet.gov.br/previsao/{codigoIbge}` | Instituto Nacional de Meteorologia | 15/10/2026, HTTP 200 | **Operacional; Rio: 22–29 °C e 70–100%; sem rajada/chuva numérica** |
| INMET Avisos | identificador, fenômeno, severidade, emissão/vigência, área, riscos e instruções | `https://apiprevmet3.inmet.gov.br/avisos/ativos` | Instituto Nacional de Meteorologia | 15/10/2026, HTTP 200 | **Operacional; 2 avisos retornados antes do filtro municipal/temporal** |
| INMET Observação | temperatura/umidade atuais, extremos horários parciais, chuva horária/acumulada e medições de vento/rajada | `https://apiprevmet3.inmet.gov.br/estacao/proxima/{codigoIbge}` | Instituto Nacional de Meteorologia | 15/10/2026, HTTP 200 | **A636/Jacarepaguá; 23,8 km da base; uso observacional separado** |
| INMET Catálogo | validação de estação automática/operante e coordenadas | `https://apitempo.inmet.gov.br/estacoes/T` | Instituto Nacional de Meteorologia | 14/10/2026, HTTP 200 | **Usado para validar representatividade da estação** |
| Clima e Saúde | EHF, classe EHF, risco combinado e GeoSES | `https://clima.saude.gov.br/{uf}/{municipio}?modo=ehf&data=AAAA-MM-DD` | Ministério da Saúde | 15/10/2026, HTTP 200 | **EHF 0,5 / Sem excesso / risco Normal** |
| COR-Rio | estágio da cidade, nível de calor e comunicados | `https://appcor.cor-rio.work/estagio_cidade`, `/calor_api` e `https://cor.rio/wp-json/wp/v2/posts` | Prefeitura do Rio / COR-Rio | 13/10/2026, HTTP 200 | **Dados reais verificados; contrato dos dois endpoints appcor não documentado publicamente** |
| ANA Monitor de Secas | competência mensal, mapa, elaboração e descrições por UF | `https://apimsbr.ana.gov.br/rest/cms-msne/mapa-monitor` | Agência Nacional de Águas e Saneamento Básico | competência 2026-08, consulta em 13/10/2026, HTTP 200 | **Produto oficial mensal verificado; não é previsão diária** |
| Oceanop | previsão por área Petrobras | `https://oceanop-api-disp.petrobras.com.br/api/v1/previsao/JsonPrevisaoAreaAsync` | Petrobras | não executada | **NÃO CONFIGURADA / NÃO VERIFICADA** |

### Condições de uso, documentação e limitações

- **Open-Meteo:** documentação em <https://open-meteo.com/en/docs>, <https://open-meteo.com/en/docs/air-quality-api> e <https://open-meteo.com/en/docs/marine-weather-api>. A página <https://open-meteo.com/en/pricing> informa que a assinatura concede licença comercial, chave e endpoint dedicado; <https://open-meteo.com/en/terms> restringe a API gratuita ao uso não comercial. Atribuição é obrigatória. A fonte fornece resultados de modelos, não observações de estação. O Marine alerta que o produto não substitui navegação costeira.
- **Air Quality:** CAMS europeu tem resolução aproximada de 11 km e atualização diária; o domínio global é mais grosseiro. `european_aqi_pm2_5` permanece identificado como índice europeu, nunca como índice brasileiro.
- **INMET:** o domínio e as respostas reais foram confirmados. O endpoint legado `https://apitempo.inmet.gov.br/estacao/{inicio}/{fim}/{estacao}` retornou HTTP 204 sem série, e o endpoint interno usado pelo portal exige reCAPTCHA. O sistema não contorna essa proteção. O histórico é acumulado somente com observações oficiais recebidas pelo endpoint `estacao/proxima`, com cobertura parcial explícita. Não foi localizada documentação técnica pública que estabilize o contrato de `apiprevmet3`; a homologação contratual permanece pendente.
- **Clima e Saúde:** metodologia consultada em <https://clima.saude.gov.br/perguntas-frequentes>. Não foi localizada API/Swagger pública; o parser usa somente o HTML semântico oficial, valida município/UF/data e não reconstrói EHF. O portal não é usado para UV; esse indicador vem do CAMS/Open-Meteo com fonte própria.
- **ANA:** fonte oficial em <https://monitordesecas.ana.gov.br/dados-sig>. É monitoramento mensal da seca, não previsão meteorológica diária.
- **COR-Rio:** portal oficial em <https://cor.rio/>. Os dados têm validade exclusiva para o município do Rio de Janeiro.
- **Oceanop:** sem `oceanopLocalId`, unidade, fuso, autenticação e contrato confirmados; seus valores não entram nos campos operacionais.

## B. Windy

### Referências encontradas e removidas

- Fontes e fusão: `src/sources/windy.js`, `src/logic/windyMerge.js`.
- Rotas: `src/integrations/windyRoutes.js` e montagem em `server.js`.
- Interface: `public/mapas.html`, `public/mapas.js`, `public/mapas.css` e referências do painel.
- Testes: `tests/windy.test.js`, `tests/windyMap.test.js`.
- Documentação e verificação: `WINDY.md`, `artifacts/verify-windy.cjs` e imagens `artifacts/windy-*`.
- Configuração: `WINDY_API_KEY`, `POINT_FORECAST_MODEL`, `WINDY_SEA_MODEL` e `WINDY_AIR_MODEL` removidas de `.env.example` e do ambiente local sem exposição dos valores.

Não havia dependência npm exclusiva do Windy. As funções meteorológicas principais já possuíam fontes próprias; nenhuma API desconhecida foi adicionada como substituta.

### Comprovação

A busca em `src`, `server.js`, `public`, `tests`, `scripts`, `.env`, `.env.example`, `README.md`, documentação de instalação e `package.json` não retorna referência Windy. Os únicos registros textuais restantes estão em logs históricos versionados sob `tmp/*.err.log`; foram preservados por serem histórico anterior, não código executável. Não há rota `/api/windy`, cliente, chave, SDK ou requisição Windy no runtime atual.

Se a chave Windy chegou a ser provisionada no provedor, ela deve ser **revogada**; remover a variável local não invalida a credencial remota.

## C. Dados simulados

### Ocorrências e medidas

| Ocorrência | Finalidade/origem | Chegava ao runtime? | Risco anterior | Medida |
|---|---|---:|---|---|
| `scripts/gerarExemplosAlertasEmail.js` | cenários artificiais para e-mail | executável manualmente | prévias poderiam ser confundidas com material operacional | arquivo removido |
| `scripts/gerarPreviaCabecalhoEmail.js` | prévias artificiais de cabeçalho | executável manualmente | artefato visual reutilizável fora do contexto | arquivo removido |
| `artifacts/verify-cor-rio.cjs`, `verify-email-cor-rio.cjs`, `verify-pdf-cor-rio.cjs` | cenários simulados COR-Rio | não importados automaticamente, mas executáveis | geração de PDFs/HTMLs plausíveis | arquivos removidos |
| `artifacts/email-cor-rio`, `artifacts/pdf-cor-rio`, `artifacts/header-previa` e prévias em `output/` | HTML, PNG e PDF de teste | arquivos estáticos | possível distribuição humana por engano | artefatos removidos |
| `tests/**/*.test.js` | mocks, fixtures, e-mails `@exemplo.com` e respostas artificiais | não importados pelo código de produção | baixo, desde que isolados | mantidos somente em testes; transporte e chamadas externas são substituídos |
| `/api/preview` e CLI semanal | nome “preview”, mas dados são coletados das fontes reais | sim | confusão terminológica | confirmado que não ativa fixture nem parâmetro de simulação; CLI semanal não envia por padrão |

Não foi encontrado `Math.random()` ou fallback numérico meteorológico fixo no código operacional. Valores fixos remanescentes são coordenadas/configuração, limites do protocolo CIM, códigos WMO, faixas documentadas ou constantes de timeout.

### Bloqueio técnico implementado

`src/logic/documentProvenance.js` mantém um registro interno não copiável por serialização/clonagem e verifica:

- identificador único do conjunto;
- ambiente de origem;
- marca de simulação;
- localidade e data de referência;
- lista de fontes;
- fonte por campo crítico;
- disponibilidade de temperatura, umidade, rajada e precipitação nos documentos completos;
- hash SHA-256 dos metadados;
- hash SHA-256 do conteúdo meteorológico, alertas e seções complementares.

Os bloqueios foram ligados ao envio diário, semanal, alerta CIM, publicação no painel, gravação de PDF, GED e rota manual. Objetos simulados não podem ser promovidos apagando `simulado`; cópias não herdam o selo; alteração de um valor após o registro gera `CONTENT_TAMPERED`.

Os templates de e-mail e PDF usam `src/render/simulationBanner.js`. Quando um documento de teste é deliberadamente renderizado, exibem **SIMULAÇÃO — NÃO ENVIAR**. A faixa visual é complementar; a autorização real ocorre no backend.

## D. Verificação das informações

### Cadeia técnica

O fluxo diário validado é:

`resposta externa → parser/normalização → cache identificado (quando aplicável) → reportBuilder → mesmo objeto rastreado → painel / HTML do PDF / HTML do e-mail`.

Não existe banco meteorológico neste projeto. Clima e Saúde, Marine, COR-Rio e ANA podem usar arquivos de cache com carimbo de consulta e estado degradado. Dado armazenado é identificado como tal e não se torna “atual” silenciosamente.

### Amostra histórica identificável — Rio de Janeiro, 13/10/2026

Esta tabela preserva a evidência da auditoria anterior. Na política vigente, chuva, vento e rajada previstos priorizam o INMET; valores da Open-Meteo alimentam apenas campos numéricos não publicados pelo INMET e permanecem identificados como complemento.

| Variável | Fonte / natureza | Valor original | Transformação | Valor final verificado | Resultado |
|---|---|---|---|---|---|
| Temperatura mín./máx. | Clima e Saúde, **previsão** municipal | texto oficial: média 31,0 °C; hoje 37,3 °C; mín. 24,7 °C | parser decimal, sem arredondar ou fundir modelos | 24,7 / 37,3 °C | **RASTREÁVEL** |
| Temperatura Open-Meteo | modelo de **previsão** na grade -22,952549/-43,215027 | 22,1 / 27,7 °C | arredondamento apenas no normalizador diário: 22 / 28 °C | não substituiu a fonte prioritária de temperatura | **DIVERGÊNCIA DE MODELOS REGISTRADA, sem média artificial** |
| Sensação térmica | não solicitada nem exibida | — | nenhuma | não disponível | **NÃO UTILIZADA** |
| Umidade | Open-Meteo, série horária em `%` | série local `America/Sao_Paulo` | mínimo/máximo da janela da edição | 76 / 96% na edição das 15h | **RASTREÁVEL** |
| Rajada | Open-Meteo `wind_gusts_10m`, previsão em km/h | máximo diário bruto 31,3 km/h | máximo da janela e arredondamento inteiro | 31 km/h | **RASTREÁVEL** |
| Vento/direção | Open-Meteo horário + INMET textual | km/h e graus; INMET `S-SE`, “Fraco/Moderado” para tarde | máximo por período; graus em 16 pontos cardeais; valores do INMET preservados como texto oficial | tabela 05h–00h com fonte por campo | **RASTREÁVEL** |
| Precipitação | Open-Meteo `precipitation`, previsão em mm | agregado diário bruto 0,9 mm | soma apenas das horas completas da janela | 0,9 mm (05h) e 0,1 mm (15h) | **RASTREÁVEL** |
| Probabilidade de chuva | Open-Meteo, previsão em `%` | série horária | máximo por período | valor do período, sem conversão em milímetros | **RASTREÁVEL** |
| Condição meteorológica | Open-Meteo `weather_code` | código WMO | tabela WMO documentada | texto de previsão | **RASTREÁVEL** |
| PM2,5 / PM10 | CAMS via Open-Meteo, **modelo** | séries horárias em µg/m³ | média das amostras válidas; uma casa | 35,2 / 36,8 µg/m³ | **RASTREÁVEL** |
| Qualidade do ar | European AQI PM2,5, **modelo** | máximo 61 | faixas europeias documentadas | “Ruim”; identificado como índice europeu/CAMS | **RASTREÁVEL; não é índice brasileiro** |
| Índice UV | Open-Meteo Air, **previsão** | máximo 9 | máximo diário e faixa UV | 9, “Muito alto” | **RASTREÁVEL** |
| Ondas | Open-Meteo Marine, **modelo oceânico** | amostras em m/s/graus; amostra específica de Linhares abaixo | máximo por período e direção circular | Rio 0,5 m na validação das bases | **RASTREÁVEL; não é boia observada** |
| Excesso de calor | Clima e Saúde, classificação oficial | EHF 5,09; badge “Sem excesso”; risco combinado “Normal” | classe EHF preservada; protocolo CIM separado | Sem excesso / NORMAL | **RASTREÁVEL; EHF não inferido localmente** |
| Aviso meteorológico | INMET, **alerta oficial** | `urn:oid:2.49.0.0.76.0.2026.28482.1`, Tempestade, Perigo Potencial, 08:57–23:59 | filtro por município, vigência e deduplicação | 1 aviso aplicável ao Rio | **RASTREÁVEL** |
| Alerta CIM | regra interna | chuva, vento, UV, ar, mar e códigos válidos | limites documentados em `riskEngine.js`/`cimProtocol.js` | chuva/vento atuais usam o rótulo “Classificação interna baseada em observação oficial” | **NÃO É APRESENTADO COMO AVISO OFICIAL** |

### Amostra marítima real

Para Linhares foi utilizado o ponto marítimo cadastrado de referência, -19,6486/-39,8258. A grade retornada foi -19,708336/-39,791656. A série de 13/10/2026 resultou em altura máxima de 1,2 m, temperatura média da superfície de 26,9 °C e estado do mar “Leve”. A escala é classificação calculada; altura e temperatura são previsão de modelo.

### Validação real das 12 bases — edição 15h

“Aprovada” nesta tabela significa que a consulta retornou campos críticos com fonte e passou pela validação de integridade. Não substitui a homologação geográfica nem a licença comercial.

| Base | Temp. mín./máx. °C | Umidade mín./máx. % | Chuva 15h–00h mm | Rajada km/h | Onda máx. m | Avisos INMET | Resultado |
|---|---:|---:|---:|---:|---:|---:|---|
| Rio de Janeiro/RJ | 24,7 / 37,3 | 76 / 96 | 0,1 | 31 | 0,5 | 1 | Aprovada |
| Macaé/RJ | 23,5 / 36,1 | 73 / 97 | 0,9 | 23 | 0,6 | 1 | Aprovada |
| Cabiúnas/RJ | 23,5 / 36,1 | 77 / 94 | 0,2 | 29 | 0,7 | 1 | Aprovada |
| Brasília/DF | 18,6 / 30,4 | 38 / 78 | 0,8 | 22 | n/a | 1 | Aprovada |
| Manaus/AM | 24,2 / 35,2 | 53 / 79 | 0,0 | 25 | n/a | 0 | Aprovada |
| Santos/SP | 23,0 / 36,5 | 79 / 96 | 0,0 | 17 | 1,1 | 1 | Aprovada |
| Aracaju/SE | 23,7 / 30,9 | 62 / 72 | 0,0 | 54 | 0,7 | 0 | Aprovada |
| Linhares/ES | 14,0 / 22,8 | 51 / 83 | 0,0 | 41 | 1,2 | 0 | Aprovada |
| Anchieta/ES | 17,7 / 29,8 | 60 / 99 | 5,3 | 26 | 0,7 | 1 | Aprovada |
| Vitória/ES | 17,4 / 28,4 | 69 / 84 | 0,2 | 50 | 1,1 | 0 | Aprovada |
| Araucária/PR | 15,5 / 23,8 | 64 / 97 | 31,8 | 33 | n/a | 2 | Aprovada |
| Salvador/BA | 22,0 / 30,9 | 55 / 70 | 0,0 | 52 | 0,9 | 0 | Aprovada |

Os valores acima registram a coleta histórica de 13/10/2026. Hoje, a tabela de previsão prioriza o produto municipal INMET; medições da estação ficam em indicadores observacionais separados e campos numéricos ausentes podem usar Open-Meteo com metadados e diagnóstico explícitos.

## E. Resultados dos testes

### Aprovados

- Suíte final em 15/10/2026: **328 aprovados, 0 falhas**.
- Sintaxe/“build” aplicável ao projeto Node sem etapa de compilação: **todos os arquivos JavaScript de `src/` e `public/` validados com `node --check`**.
- Consultas reais: Weather, Air, Marine, INMET Previsão/Avisos, Clima e Saúde, COR-Rio e ANA responderam.
- Um relatório real do Rio, edição 15h, foi montado com Clima e Saúde + INMET e o PDF final de 8 páginas foi gravado e inspecionado visualmente (**951.173 bytes**). Nenhum SMTP foi chamado.
- Painel validado em Chromium a **1920 × 1080**: previsão 21–33 °C / 50–100%, condição diária própria da base, `Chuva acumulada/dia` e `Chuva acumulada/Hora` com referência 15:00–16:00. O cabeçalho do site permanece sem Petrobras.
- PDF validado visualmente: logo Petrobras nítida e proporcional somente no documento; e-mail e site sem a marca.
- As 12 bases foram consultadas e validadas na edição 15h.
- Segurança exercitada: mock não registrado, simulação com marca removida, clone de objeto operacional, mutação posterior de valor, fonte ausente, campo crítico ausente, cache antigo, API indisponível, unidade/fuso inválidos, aviso vencido, isolamento de fonte secundária e transporte SMTP substituído.
- Busca operacional confirmou ausência de chamadas Windy.
- O HTML do e-mail foi renderizado em Chromium a **390 px** e **900 px**. Após a correção responsiva do valor de rajada indisponível, `scrollWidth === clientWidth` nos dois tamanhos, sem estouro horizontal.

### Reprovados

- Nenhum teste automatizado reprovado.
- A aptidão operacional permanece condicionada às pendências externas/contratuais listadas na seção F.

### Não executados por decisão de segurança ou falta de configuração

- envio SMTP real;
- upload real para GED/SharePoint;
- implantação/reinício de produção;
- Oceanop real;
- navegação costeira/decisão marítima baseada no modelo;
- confirmação física das coordenadas por cadastro patrimonial autorizado.

## F. Pendências

1. Contratar ou confirmar formalmente a licença comercial da Open-Meteo e preencher `OPEN_METEO_API_KEY` no ambiente de produção. Sem isso, o bloqueio `OPEN_METEO_COMMERCIAL_LICENSE_REQUIRED` impede a coleta.
2. Confirmar que o plano contratado cobre Weather, Air Quality e Marine, bem como volume e SLA esperados.
3. Manter as atribuições exigidas por Open-Meteo/CAMS/provedores de modelos nos documentos operacionais.
4. Obter documentação/anuência para uso operacional dos endpoints `apiprevmet3.inmet.gov.br`, `appcor.cor-rio.work` e `apimsbr.ana.gov.br`; as respostas foram reais, mas os contratos técnicos públicos não foram comprovados.
5. Homologar as coordenadas das 12 bases e os pontos marítimos contra cadastro corporativo oficial. Código IBGE municipal não confirma o ponto físico da instalação.
6. Obter contrato Oceanop com IDs de área, unidades, fuso, atualização, autenticação e limites; manter desativada até isso ocorrer.
7. Homologar GED/SharePoint e SMTP em ambiente próprio, com destinatários de teste autorizados. Esta auditoria não enviou nada.
8. Avaliar operacionalmente divergências relevantes entre produtos. Exemplo real: Clima e Saúde indicou máxima de 37,8 °C para seu produto de calor, enquanto a previsão municipal do INMET publicou 33 °C. O sistema preserva cada valor no seu contexto e fonte.
9. Revogar qualquer chave Windy antiga no provedor.
10. Os logs históricos `tmp/*.err.log` ainda citam Windy. Não são executáveis e foram preservados para não apagar histórico; definir política de retenção antes de removê-los.

## G. Declaração final

1. **Existem dados fictícios acessíveis na produção? — Não foi encontrado caminho operacional ativo.** Fixtures permanecem apenas em `tests/`; geradores e artefatos de demonstração foram removidos; documento não registrado é bloqueado.
2. **Os documentos simulados podem ser enviados? — Não.** O backend rejeita simulação mesmo após remoção das marcações visíveis, e o transporte valida procedência antes do SMTP.
3. **O Windy foi removido? — Sim, do runtime, configuração, UI, testes e documentação ativa.** Restam apenas menções em logs históricos sem capacidade de execução. A credencial remota ainda precisa ser revogada pelo responsável.
4. **Todas as APIs restantes foram validadas? — Não.** Oceanop não está configurada; contratos/licenças de endpoints auxiliares não foram plenamente comprovados; Open-Meteo exige regularização comercial.
5. **Todos os dados meteorológicos exibidos são rastreáveis? — Os campos operacionais exercitados, sim.** Cada campo crítico possui fonte, localidade, data e transformação; a assinatura detecta adulteração. Não há comprovação ponta a ponta do Oceanop porque ele não alimenta o relatório.
6. **Existem previsões sendo apresentadas como medições? — Não nos caminhos auditados.** A previsão municipal e os extremos horários observados do INMET aparecem em linhas distintas; a leitura atual informa estação e horário.
7. **Existem alertas internos sendo apresentados como oficiais? — Não nos caminhos auditados.** Aviso oficial exige objeto INMET/COR; regras CIM derivadas de chuva/vento recebem o rótulo “Classificação interna baseada em observação oficial”.
8. **Existem informações críticas sem fonte validada? — O índice UV está legitimamente indisponível.** O portal Clima e Saúde não publica o indicador nem documenta serviço público de UV, e o sistema não troca de fornecedor nem inventa valor.
9. **O sistema está apto à publicação operacional? — Não ainda.** O código passou nos testes e nas consultas reais, mas licença/chave comercial, coordenadas e contratos pendentes impedem uma declaração de conformidade total.

## H. Relatório da atualização definitiva — 15/10/2026

### Arquivos alterados neste ciclo

- Fontes e política meteorológica: `src/sources/inmet.js`, `src/logic/weatherSourcePolicy.js`, `src/logic/weatherSourceMetadata.js`, `src/logic/sourceProvenance.js`, `src/logic/verificacaoFontes.js` e `src/logic/weeklyBuilder.js`.
- Construção e contexto: `src/logic/reportBuilder.js`, `src/logic/sectorWeatherContext.js`, `src/logic/forecastAlertContext.js`, `src/logic/alertWatcher.js`, `src/logic/inmetAlertRules.js`, `src/logic/ocorrenciasPainel.js` e `src/logic/scheduledReport.js`.
- PDF, e-mail e painel: `src/render/pdfTemplate.js`, `src/render/emailTemplate.js`, `src/render/emailComponents.js`, `src/render/alertEmailTemplate.js`, `src/render/weeklyPdfTemplate.js` e `public/dashboard-components.js`.
- Documentação: `README.md` e `AUDITORIA_FINAL_DADOS_REAIS_CIM.md`.
- Testes atualizados ou adicionados: `tests/alertasInmet.test.js`, `tests/climaSaudeService.test.js`, `tests/emailInformativoCompleto.test.js`, `tests/pdfInformativoCards.test.js`, `tests/previsaoProximosDias.test.js`, `tests/relatorioAgendado.test.js`, `tests/sectorWeatherContext.test.js`, `tests/verificacaoFontes.test.js` e `tests/weatherSourcePolicy.test.js`.

### Endpoints efetivamente exercitados

| Serviço | Endpoint/consulta | Resultado em 15/10/2026 |
|---|---|---|
| INMET — previsão municipal | `https://apiprevmet3.inmet.gov.br/previsao/3304557` | HTTP 200; manhã, tarde e noite presentes; 22–29 °C; 70–100%; sem rajada, velocidade média, probabilidade ou chuva numérica |
| INMET — estação próxima | `https://apiprevmet3.inmet.gov.br/estacao/proxima/3304557` | HTTP 200; A636/Jacarepaguá; observações mantidas fora dos campos previstos |
| INMET — avisos | `https://apiprevmet3.inmet.gov.br/avisos/ativos` | HTTP 200; aviso municipal filtrado e exibido com severidade oficial |
| Clima e Saúde | `https://clima.saude.gov.br/rj/rio-de-janeiro?modo=ehf&data=2026-10-15` | HTTP 200; EHF 0,5; Sem excesso; risco Normal; UV não publicado |
| Open-Meteo Marine | `https://marine-api.open-meteo.com/v1/marine` para o ponto cadastrado do Rio | HTTP 200; 0,5 m no relatório validado |
| Open-Meteo Air Quality/CAMS | `https://air-quality-api.open-meteo.com/v1/air-quality` | integração preservada; valores de PM2,5, PM10 e AQI exibidos com identificação CAMS/Open-Meteo |
| COR-Rio | `https://appcor.cor-rio.work/estagio_cidade`, `/calor_api` e API pública do portal | estágio, calor e comunicados consultados para o PDF real |

### Confirmações funcionais

1. Chuva, vento, rajada, temperatura, umidade e condição previstos priorizam a previsão municipal do INMET. Campos numéricos ausentes podem receber complemento identificado da Open-Meteo; observações da estação são campos separados e nunca preenchem previsão ausente.
2. Excesso de calor usa EHF, classificação e risco do Clima e Saúde. Índice UV usa Open-Meteo Air Quality/CAMS.
3. Qualidade do ar continua na integração Open-Meteo Air Quality/CAMS; ondas e condições do mar usam Open-Meteo Marine enquanto OCEANOP não possui áreas, unidades, fuso e acesso corporativo homologados.
4. No PDF, a tabela `Temperatura e umidade` voltou a ter quatro colunas horizontais; `Vento por período` mostra direção, velocidade média, rajada prevista e referência oficial; `Chuva por período` mostra probabilidade, acumulado do período e resumo INMET. Essas tabelas não são repetidas no corpo do e-mail.
5. `Rajada observada` foi removida das superfícies de previsão. Quando o INMET não fornece máximo numérico previsto, o campo fica `Não disponível`; a rajada medida permanece identificada apenas em contexto observacional.
6. A seção indevida `Acumulados de precipitação opservção` e variantes não existe no PDF. O bloco válido `Chuva acumulada/Hora (observada)` foi preservado com horas de referência explícitas.
7. A condição geral é produzida por contexto de base/setor e exibe uma única condição oficial predominante do dia, sem repetir os rótulos `Manhã`, `Tarde` e `Noite`; o detalhamento por período permanece nas tabelas próprias.
8. O PDF usa o mesmo relatório validado do e-mail, preserva a marca Petrobras somente no documento e não apresenta cortes ou sobreposições nas oito páginas inspecionadas.
9. O e-mail usa Arial 16 px e `line-height: 1.4` tanto em `Hora da consulta` quanto em `Previsão até as 00h`. A renderização a 390 px e 900 px não apresenta rolagem horizontal.
10. A suíte automatizada encerrou com **335/335 testes aprovados**; a checagem de sintaxe dos arquivos alterados também passou.
11. Foi gerado `output/pdf/Informativo_Meteorologico_CIM_Rio_2026-10-15_validado.pdf`, com dados reais da edição das 15h. Nenhum e-mail, upload GED ou implantação foi executado.

### Limitações oficiais preservadas

- O produto municipal INMET consultado não forneceu valores numéricos de rajada prevista, velocidade média, probabilidade ou volume de chuva. A intensidade `Fraco/Moderado com Rajadas` foi preservada como texto e não convertida para km/h; esses números permanecem `Não disponível` e não recebem complemento de outro provedor.
- O Clima e Saúde não publicou índice UV no produto acessível. O sistema usa CAMS/Open-Meteo para UV e não atribui esse dado ao Ministério da Saúde.
- INMET e Clima e Saúde não oferecem, nos produtos utilizados, granularidade específica por instalação dentro do mesmo município. Instalações do mesmo município podem ter condições iguais legitimamente.
- Air Quality e Marine continuam sujeitos à licença e às condições comerciais da Open-Meteo para uso em produção.
- A verificação preventiva real aprovou Weather, Air Quality/UV, Marine, INMET Previsão, Clima e Saúde, COR-Rio e ANA. A observação INMET de Santos respondeu sem chuva, vento, direção e rajada; esses campos observados permanecem indisponíveis e são reportados como limitação da estação/resposta, não preenchidos por previsão.
- OCEANOP continua bloqueado por ausência de `oceanopLocalId`, unidades, fuso, autenticação e acesso/VPN homologados. Open-Meteo Marine permanece explicitamente identificado; não é apresentado como OCEANOP.

## Plano de reversão e implantação

As alterações não foram implantadas. Para reversão, os arquivos versionados removidos podem ser recuperados pelo histórico Git. Artefatos gerados e ignorados que foram apagados não devem ser restaurados como conteúdo operacional. Antes de implantar, criar backup do ambiente, configurar a chave comercial em cofre de segredos, executar `npm test`, repetir `node --use-system-ca scripts/auditarFontesReais.js`, validar uma base de homologação sem SMTP e só então promover o código mediante aprovação operacional.
