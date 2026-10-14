# Auditoria final de dados reais — CIM

**Data da auditoria:** 13/10/2026  
**Escopo:** fontes meteorológicas, normalização, caches, painel, PDF, e-mail, agendadores, alertas, artefatos de teste e remoção Windy.  
**Regra de execução:** nenhuma mensagem real foi enviada, nenhum upload ao GED foi realizado e nenhuma implantação foi feita.

## Resumo executivo

A integração Windy foi removida do código executável. Os geradores manuais e artefatos estáticos que continham cenários simulados foram removidos. Os mocks restantes estão limitados a `tests/`.

Foi criada uma barreira de procedência no backend. Um documento só pode ser publicado, salvo ou enviado quando possui registro interno, ambiente operacional, fontes, localidade, data, rastreabilidade dos campos críticos e assinatura de integridade. Objetos simulados, clonados, adulterados ou sem campos críticos são rejeitados. Simulações renderizadas localmente recebem a faixa visível **SIMULAÇÃO — NÃO ENVIAR**.

As consultas reais de 13/10/2026 responderam para Open-Meteo Weather, Air Quality/CAMS, Marine, INMET Previsão, INMET Avisos, Clima e Saúde, COR-Rio e ANA. As 12 bases cadastradas foram consultadas na edição das 15h e passaram pela validação estrita de procedência. Oceanop não foi consultada porque não há identificador de área confirmado.

Existe, porém, uma pendência impeditiva para produção: o código anterior utilizava os endpoints gratuitos da Open-Meteo, cujo uso é limitado a finalidades não comerciais. O sistema agora exige `OPEN_METEO_API_KEY` quando `NODE_ENV=production`, troca automaticamente para os hosts `customer-*` e não persiste nem devolve a chave. Enquanto a organização não contratar/confirmar a licença e configurar a chave, o sistema fica deliberadamente bloqueado em produção.

**Parecer final:** as proteções técnicas e a rastreabilidade ficaram substancialmente mais fortes, mas o sistema **ainda não está apto para publicação operacional** até a regularização da licença Open-Meteo, a validação corporativa das coordenadas e a homologação das integrações sem contrato técnico público.

## A. APIs ativas

| API | Variáveis utilizadas | Endpoint | Origem | Última validação | Status |
|---|---|---|---|---|---|
| Open-Meteo Weather | previsão de temperatura, umidade, chuva, probabilidade, vento, rajada, direção e código WMO | desenvolvimento: `https://api.open-meteo.com/v1/forecast`; produção: `https://customer-api.open-meteo.com/v1/forecast` | OpenMeteo GmbH e modelos meteorológicos listados pela fonte | 13/10/2026 20:30 BRT, HTTP 200 | **Consulta real verificada; produção bloqueada sem licença/chave comercial** |
| Open-Meteo Air Quality / CAMS | PM2,5, PM10, European AQI PM2,5, UV e poeira | desenvolvimento: `https://air-quality-api.open-meteo.com/v1/air-quality`; produção: `https://customer-air-quality-api.open-meteo.com/v1/air-quality` | CAMS distribuído pela Open-Meteo | 13/10/2026 20:30 BRT, HTTP 200 | **Consulta real verificada; mesma pendência comercial** |
| Open-Meteo Marine | altura, período e direção de ondas; marulho; temperatura da superfície do mar | desenvolvimento: `https://marine-api.open-meteo.com/v1/marine`; produção: `https://customer-marine-api.open-meteo.com/v1/marine` | modelos oceânicos distribuídos pela Open-Meteo | 13/10/2026 20:30 BRT, HTTP 200 | **Consulta real verificada; mesma pendência comercial** |
| INMET Previsão | previsão municipal textual e valores publicados pela fonte | `https://apiprevmet3.inmet.gov.br/previsao/{codigoIbge}` | Instituto Nacional de Meteorologia | 13/10/2026, HTTP 200 | **Operacional na consulta; contrato/licença do endpoint não verificados publicamente** |
| INMET Avisos | identificador, fenômeno, severidade, emissão/vigência, área, riscos e instruções | `https://apiprevmet3.inmet.gov.br/avisos/ativos` | Instituto Nacional de Meteorologia | 13/10/2026, HTTP 200 | **Operacional na consulta; filtragem municipal e temporal testada** |
| Clima e Saúde | EHF, classe EHF, risco combinado, GeoSES e temperatura prevista | `https://clima.saude.gov.br/{uf}/{municipio}?modo=ehf&data=AAAA-MM-DD` | Ministério da Saúde | 13/10/2026, HTTP 200 | **Página oficial verificada; é HTML SSR, não API pública contratada** |
| COR-Rio | estágio da cidade, nível de calor e comunicados | `https://appcor.cor-rio.work/estagio_cidade`, `/calor_api` e `https://cor.rio/wp-json/wp/v2/posts` | Prefeitura do Rio / COR-Rio | 13/10/2026, HTTP 200 | **Dados reais verificados; contrato dos dois endpoints appcor não documentado publicamente** |
| ANA Monitor de Secas | competência mensal, mapa, elaboração e descrições por UF | `https://apimsbr.ana.gov.br/rest/cms-msne/mapa-monitor` | Agência Nacional de Águas e Saneamento Básico | competência 2026-08, consulta em 13/10/2026, HTTP 200 | **Produto oficial mensal verificado; não é previsão diária** |
| Oceanop | previsão por área Petrobras | `https://oceanop-api-disp.petrobras.com.br/api/v1/previsao/JsonPrevisaoAreaAsync` | Petrobras | não executada | **NÃO CONFIGURADA / NÃO VERIFICADA** |

### Condições de uso, documentação e limitações

- **Open-Meteo:** documentação em <https://open-meteo.com/en/docs>, <https://open-meteo.com/en/docs/air-quality-api> e <https://open-meteo.com/en/docs/marine-weather-api>. A página <https://open-meteo.com/en/pricing> informa que a assinatura concede licença comercial, chave e endpoint dedicado; <https://open-meteo.com/en/terms> restringe a API gratuita ao uso não comercial. Atribuição é obrigatória. A fonte fornece resultados de modelos, não observações de estação. O Marine alerta que o produto não substitui navegação costeira.
- **Air Quality:** CAMS europeu tem resolução aproximada de 11 km e atualização diária; o domínio global é mais grosseiro. `european_aqi_pm2_5` permanece identificado como índice europeu, nunca como índice brasileiro.
- **INMET:** o domínio e as respostas reais foram confirmados. Não foi localizada documentação técnica pública que estabilize o contrato de `apiprevmet3` nem termos específicos desse endpoint; por isso a validação jurídica/contratual permanece pendente.
- **Clima e Saúde:** metodologia consultada em <https://clima.saude.gov.br/perguntas-frequentes>. O parser usa somente o HTML semântico do município e rejeita data diferente. EHF não é reconstruído localmente.
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

### Amostra real identificável — Rio de Janeiro, 13/10/2026

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
| Alerta CIM | regra interna | chuva, vento, UV, ar, mar e códigos válidos | limites documentados em `riskEngine.js`/`cimProtocol.js` | rótulo “Classificação interna baseada na previsão” | **NÃO É APRESENTADO COMO AVISO OFICIAL** |

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

As temperaturas vieram do Clima e Saúde; umidade, chuva e rajada vieram da Open-Meteo porque o INMET/Clima e Saúde não publicaram os campos numéricos equivalentes necessários. O fallback é individual e fica registrado em `fontesPorCampo` e `diagnosticosFallback`.

## E. Resultados dos testes

### Aprovados

- Suíte antes da remoção: **313 aprovados, 0 falhas**.
- Suíte final: **301 aprovados, 0 falhas**.
- Sintaxe/“build” aplicável ao projeto Node sem etapa de compilação: **83 arquivos JavaScript validados com `node --check`**.
- Consultas reais: Weather, Air, Marine, INMET Previsão/Avisos, Clima e Saúde, COR-Rio e ANA responderam.
- As edições 05h e 15h do Rio foram montadas com dados reais, validadas estritamente e renderizadas em HTML de e-mail e PDF em memória. Nenhum SMTP foi chamado.
- As 12 bases foram consultadas e validadas na edição 15h.
- Segurança exercitada: mock não registrado, simulação com marca removida, clone de objeto operacional, mutação posterior de valor, fonte ausente, campo crítico ausente, cache antigo, API indisponível, unidade/fuso inválidos, aviso vencido, isolamento de fonte secundária e transporte SMTP substituído.
- Busca operacional confirmou ausência de chamadas Windy.

### Reprovados

- Nenhum teste automatizado reprovado.
- A aptidão operacional foi reprovada por pendências externas/contratuais listadas na seção F.

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
8. Avaliar operacionalmente divergências relevantes entre modelos. Exemplo real: Clima e Saúde previu máxima de 37,3 °C para o Rio, enquanto Open-Meteo retornou 27,7 °C. O sistema preserva a prioridade e a fonte, mas não há ainda regra institucional de bloqueio por divergência entre modelos.
9. Revogar qualquer chave Windy antiga no provedor.
10. Os logs históricos `tmp/*.err.log` ainda citam Windy. Não são executáveis e foram preservados para não apagar histórico; definir política de retenção antes de removê-los.

## G. Declaração final

1. **Existem dados fictícios acessíveis na produção? — Não foi encontrado caminho operacional ativo.** Fixtures permanecem apenas em `tests/`; geradores e artefatos de demonstração foram removidos; documento não registrado é bloqueado.
2. **Os documentos simulados podem ser enviados? — Não.** O backend rejeita simulação mesmo após remoção das marcações visíveis, e o transporte valida procedência antes do SMTP.
3. **O Windy foi removido? — Sim, do runtime, configuração, UI, testes e documentação ativa.** Restam apenas menções em logs históricos sem capacidade de execução. A credencial remota ainda precisa ser revogada pelo responsável.
4. **Todas as APIs restantes foram validadas? — Não.** Oceanop não está configurada; contratos/licenças de endpoints auxiliares não foram plenamente comprovados; Open-Meteo exige regularização comercial.
5. **Todos os dados meteorológicos exibidos são rastreáveis? — Os campos operacionais exercitados, sim.** Cada campo crítico possui fonte, localidade, data e transformação; a assinatura detecta adulteração. Não há comprovação ponta a ponta do Oceanop porque ele não alimenta o relatório.
6. **Existem previsões sendo apresentadas como medições? — Não nos caminhos auditados.** Open-Meteo, CAMS, Marine e Clima e Saúde são rotulados como previsão/modelo; o bloco `current` da Open-Meteo é explicitamente “Previsão próxima ao horário atual”.
7. **Existem alertas internos sendo apresentados como oficiais? — Não nos caminhos auditados.** Aviso oficial exige objeto INMET/COR; regras CIM recebem o rótulo “Classificação interna baseada na previsão”.
8. **Existem informações críticas sem fonte validada? — Existe pendência de autorização/licença, não de origem numérica, na Open-Meteo; existe também divergência intermodelo sem política institucional.** Em produção sem chave, a publicação falha com segurança.
9. **O sistema está apto à publicação operacional? — Não ainda.** O código passou nos testes e nas consultas reais, mas licença/chave comercial, coordenadas e contratos pendentes impedem uma declaração de conformidade total.

## Plano de reversão e implantação

As alterações não foram implantadas. Para reversão, os arquivos versionados removidos podem ser recuperados pelo histórico Git. Artefatos gerados e ignorados que foram apagados não devem ser restaurados como conteúdo operacional. Antes de implantar, criar backup do ambiente, configurar a chave comercial em cofre de segredos, executar `npm test`, repetir `node --use-system-ca scripts/auditarFontesReais.js`, validar uma base de homologação sem SMTP e só então promover o código mediante aprovação operacional.
