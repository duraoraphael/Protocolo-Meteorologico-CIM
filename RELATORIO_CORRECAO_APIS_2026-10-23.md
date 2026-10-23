# Correção das integrações meteorológicas — 23/10/2026

## Resultado operacional

As correções foram aplicadas ao código e validadas localmente, sem envio de e-mails. A consulta real de Santos/SP às 14h34 (America/Sao_Paulo) confirmou estação INMET A765 (Bertioga, 21,8 km), medição às 14h, `CHUVA: null` e cobertura de chuva de 0/15 leituras no dia e 0/24 nas últimas 24 horas. Os acumulados observados continuam **indisponíveis**; nenhum deles foi substituído por zero ou pela previsão. A previsão Open-Meteo retornou 16,8 mm para o dia civil e 11,3 mm para a janela da edição das 15h. São janelas diferentes, agora identificadas separadamente.

O relatório operacional de Santos usou Open-Meteo para rajada prevista: 25 km/h no card da edição, e 16/26/13 km/h para manhã/tarde/noite na tabela do dia. A diferença no pico da tarde reflete o recorte do card a partir das 15h. A estação INMET fornece rajada *observada* separadamente; sua velocidade média não preenche rajada prevista.

## Problemas e causas

| Problema | Causa verificada | Correção |
|---|---|---|
| Qualidade do ar indisponível | A consulta era bloqueada sem `OPEN_METEO_API_KEY` mesmo na avaliação local; o parser também impunha o fuso de Brasília às demais bases. | Consulta `current=us_aqi,pm2_5,pm10` por coordenada e fuso da base, com reserva horária validada. A API pública funciona somente em avaliação local, identificada no card. Em `NODE_ENV=production`, a licença/chave Customer continua obrigatória. |
| Chuva observada ausente em Santos | `/estacao/proxima/3548500` escolhe A765 (Bertioga), cuja leitura atual tinha `CHUVA: null`. A série horária do projeto é construída pelas coletas oficiais armazenadas; a tentativa do endpoint histórico `/estacao/{inicio}/{fim}/A765` retornou HTTP 204. | Preserva `null`, mostra cobertura/estação/última medição e impede que observação antiga ou de cache seja exibida como atual. Sem outra fonte observacional autorizada integrada, permanece indisponível. |
| Rajadas indisponíveis | `wind_gusts_10m` não era solicitado pela integração Weather Forecast. Santos tem portal Tetra Tech configurado, mas a credencial não está presente; o endpoint OCEANOP não resolveu por DNS nesta máquina. | Usa a série própria de rajadas do Open-Meteo após as fontes prioritárias, conserva a fonte por campo e calcula máximas por período. Boletim Tetra Tech armazenado/desatualizado não substitui previsão atual. |
| Chuva prevista/dia confundida com acumulado | O card de e-mail dizia “CHUVA ACUMULADA/DIA” e seu valor podia representar apenas a janela da edição. | O card agora diz “CHUVA PREVISTA/DIA” e usa `daily.precipitation_sum` do dia civil; o acumulado observado permanece em campo próprio. |
| Falta de classificação interna antes da distribuição | A validação de procedência já existia, mas não distinguia explicitamente natureza e disponibilidade dos indicadores. | A classificação `observada`, `prevista`, `estimada`, `indisponivel`, `desatualizada` integra o relatório assinado. A validação bloqueia valor sem fonte, ausência convertida em número e chuva de observação antiga antes do PDF e do e-mail. |

## Fontes verificadas

- **INMET previsão e avisos:** HTTP 200 na execução de Santos; um aviso vigente. **Observação:** HTTP 200, estação A765 e chuva nula. Catálogo: HTTP 200, 669 estações. Histórico horário consultado: HTTP 204.
- **Open-Meteo Weather Forecast:** HTTP 200 para Santos; as 11 bases cadastradas retornaram previsão válida no teste de integração. `wind_gusts_10m` veio como série distinta de `wind_speed_10m`.
- **Open-Meteo Marine:** HTTP 200 para o ponto marítimo de Santos; o teste das 11 bases confirmou resposta para as bases aplicáveis e “não se aplica” para as interiores.
- **Open-Meteo Air Quality:** a primeira verificação retornou HTTP 200 para Santos, com US AQI 53 (MODERADO), PM2,5 18,3 µg/m³ e PM10 20,3 µg/m³, referência 14h local. Depois da correção, a consulta de avaliação local alimentou o card; produção continua bloqueada sem chave/licença comercial.
- **OCEANOP:** configuração de coordenadas e unidades de Santos conferida. A chamada local falhou em resolução DNS (`ENOTFOUND`), antes de autenticar; não foi possível validar o retorno autorizado. **Tetra Tech:** credencial `X-API-Key`/OAuth ausente. **Clima e Saúde:** HTTP 200 e dados atuais para Santos.

O Node sem a inicialização TLS já existente no projeto retornou `UNABLE_TO_VERIFY_LEAF_SIGNATURE` nas APIs públicas; com `src/security/certificados.js`, as chamadas públicas passaram. Não foi alterada nenhuma configuração de proxy, certificado, DNS ou firewall. A conectividade do servidor **NPAB2542** não pôde ser verificada a partir desta estação de trabalho.

## Testes e integridade

- Suíte local: **408 testes aprovados, zero falhas** após as alterações. Inclui classificação do US AQI, série de rajadas, fontes por período, zero observado versus ausência, cache INMET antigo, fonte ausente, payload vazio/desalinhado, PDF, e-mail e painel.
- Consultas reais somente leitura: Santos (INMET, Open-Meteo Weather/Air Quality/Marine, OCEANOP e Clima e Saúde) e previsão/Marine nas 11 bases. Nenhum e-mail foi disparado.
- Painel, PDF e e-mail consomem o mesmo objeto de relatório. A classificação faz parte da assinatura de procedência; a validação é chamada antes da geração e antes do SMTP.

## Pendências para produção

1. Confirmar a licença de uso corporativo e instalar uma chave Customer para Open-Meteo; os [termos da API gratuita](https://open-meteo.com/en/terms) limitam seu uso a fins não comerciais, e o [plano Customer](https://open-meteo.com/en/pricing) concede licença comercial. A [documentação Air Quality](https://open-meteo.com/en/docs/air-quality-api) exige atribuição à Open-Meteo e ao provedor CAMS; confirmar também a forma aprovada de atribuição nos informativos.
2. A equipe de infraestrutura deve testar DNS, rota, proxy, TLS e autenticação OCEANOP **no NPAB2542** e fornecer as credenciais corporativas oficialmente autorizadas; a falha `ENOTFOUND` local não demonstra falha no servidor.
3. Se a chuva observada de Santos for operacionalmente indispensável, obter uma fonte observacional oficial adicional, com autorização e cobertura comprovadas. Até lá, 0/15 ou `CHUVA: null` significam indisponibilidade, não 0 mm.

Arquivos centrais alterados: `src/sources/airQuality.js`, `src/sources/openMeteo.js`, `src/logic/weatherSourcePolicy.js`, `src/logic/reportBuilder.js`, `src/logic/meteorologicalValidity.js`, `src/pipeline.js`, `public/dashboard-components.js`, `src/render/emailTemplate.js`, `src/render/pdfTemplate.js`, `README.md` e testes correspondentes.

## Adendo — acumulados históricos estimados e auditoria completa

**CORRIGIDO E TESTADO — chuva modelada.** A Weather Forecast API agora recebe `past_hours=30`, `forecast_hours=96` para quatro dias, `precipitation`, `rain`, `showers`, `precipitation_probability` e `precipitation_sum`. A hora de `precipitation` corresponde à **hora precedente**. Por isso, 00h não entra no acumulado do novo dia: representa 23h–00h do dia anterior. O acumulado diário soma as horas de 01h até a última hora completa; a janela móvel usa as 24 horas concluídas. `rain` e `showers` são componentes de `precipitation` e não são somados outra vez. Timestamps duplicados/fora de ordem, fuso ou offset inválido e unidades incompatíveis são rejeitados; lacunas e valores horários negativos, acima de 500 mm ou ausentes ficam fora da soma e a cobertura passa a parcial. Zero é publicado somente quando há valor numérico zero. A série histórica é **estimativa de modelo**, nunca leitura de pluviômetro.

As três estimativas são normalizadas uma única vez em `src/sources/openMeteo.js` e classificadas em `src/logic/meteorologicalValidity.js` com localidade, coordenadas, unidade, fonte, natureza, horários, cobertura e indisponibilidade. `src/logic/weatherSourcePolicy.js` mantém esses valores em `chuvaEstimadaDiaMm`, `chuvaEstimadaHoraMm` e `chuvaEstimada24hMm`; as medições `precipitacaoDiariaMm`, `precipitacaoHoraMm` e `precipitacaoUltimas24hMm` continuam exclusivas do INMET. Painel, PDF e e-mail consomem a mesma classificação, sob o rótulo **ESTIMATIVA OPEN-METEO**. A assinatura de procedência inclui os três novos valores.

**Evidência real às 14h49 de Brasília, 23/10/2026.** Consultas HTTP 200 com TLS do projeto, sem credenciais em logs. Valores em mm; `dia / hora / 24h` são estimativas históricas e `prev.` é a previsão diária distinta. As horas consultadas e as 24 horas móveis tiveram cobertura integral em todas as 11 bases nesta coleta. Rajada é previsão Open-Meteo em km/h antes da prioridade de OCEANOP/Tetra Tech aplicada pelo relatório.

| Base | Dia / hora / 24h estimados | Prev. diária | Rajada prevista | Referência local | Status |
|---|---:|---:|---:|---|---|
| Rio de Janeiro | 2,2 / 0 / 2,6 | 2,6 | 23 | 14h | CORRIGIDO E TESTADO |
| Macaé | 6,3 / 0,6 / 8,4 | 10,7 | 27 | 14h | CORRIGIDO E TESTADO |
| Brasília | 0,4 / 0 / 10,1 | 2,6 | 31 | 14h | CORRIGIDO E TESTADO |
| Manaus | 0,6 / 0,2 / 0,6 | 0,6 | 34 | 13h (fuso Manaus) | CORRIGIDO E TESTADO |
| Santos | 5,4 / 0,6 / 5,9 | 16,8 | 26 | 14h | CORRIGIDO E TESTADO |
| Aracaju | 1,6 / 0 / 3,4 | 2,0 | 50 | 14h | CORRIGIDO E TESTADO |
| Natal | 1,8 / 0 / 2,5 | 2,1 | 58 | 14h | CORRIGIDO E TESTADO |
| Oiapoque | 0,1 / 0 / 0,1 | 0,1 | 24 | 14h | CORRIGIDO E TESTADO |
| Vitória | 2,7 / 1,3 / 8,8 | 4,3 | 45 | 14h | CORRIGIDO E TESTADO |
| Araucária | 4,6 / 0,6 / 8,3 | 6,5 | 41 | 14h | CORRIGIDO E TESTADO |
| Salvador | 1,2 / 0 / 1,2 | 1,2 | 49 | 14h | CORRIGIDO E TESTADO |

**INMET por base — consulta isolada, sem persistir histórico.** A previsão municipal respondeu para as 11 bases com cinco dias; a consulta de avisos respondeu para as 11 bases. A coluna de observação registra **uma única leitura desta verificação**, não um acumulado diário completo. `0` é a leitura numérica zero da estação; `null` é ausência de chuva publicada. A qualidade do ar respondeu nas 11 bases em avaliação local; o uso em produção permanece pendente da licença/chave Customer.

| Base | Estação | Chuva da leitura INMET (mm) | Avisos ativos | Status da observação |
|---|---|---:|---:|---|
| Rio de Janeiro | A636 | 0 | 1 | operacional, cobertura isolada 1 leitura |
| Macaé | A608 | 0 | 1 | operacional, cobertura isolada 1 leitura |
| Brasília | A001 | 0 | 0 | operacional, cobertura isolada 1 leitura |
| Manaus | A101 | 3 | 0 | operacional, cobertura isolada 1 leitura |
| Santos | A765 | null | 1 | estação operacional, chuva indisponível |
| Aracaju | A472 | 0 | 0 | operacional, cobertura isolada 1 leitura |
| Natal | A304 | 0 | 0 | operacional, cobertura isolada 1 leitura |
| Oiapoque | A242 | 0 | 0 | operacional, cobertura isolada 1 leitura |
| Vitória | A612 | 0 | 1 | operacional, cobertura isolada 1 leitura |
| Araucária | A807 | 0 | 1 | operacional, cobertura isolada 1 leitura |
| Salvador | A456 | 0 | 0 | operacional, cobertura isolada 1 leitura |

**Antes/depois em Santos:** o acumulado observado INMET continuou indisponível por `CHUVA: null`; a previsão diária foi 16,8 mm nesta nova consulta, enquanto o modelo estimou **5,4 mm já acumulados desde 00h**, **0,6 mm na última hora** e **5,9 mm em 24h**. A ausência da estação Bertioga não suprime as três estimativas. No Rio, a cobertura limitada da estação também não altera o cálculo histórico modelado. São fotografias de um instante; não devem ser reutilizadas como dados atuais.

Uma montagem real do relatório de Rio e Santos confirmou a propagação até os templates PDF e e-mail, sem envio: Rio `INMET=0` e estimativa `[2,2; 0; 2,6]`; Santos `INMET=null` e estimativa `[5,4; 0,6; 5,9]`. Ambos tiveram classificação `estimada`, fonte Open-Meteo e as três linhas presentes no HTML do PDF e do e-mail. Nesse ensaio, OCEANOP e Tetra Tech foram substituídos por falhas controladas por falta de acesso/credencial, e Clima e Saúde por estado indisponível; as fontes INMET, Open-Meteo Weather e Marine consultaram os endpoints reais.

**Qualidade do ar — CORRIGIDO E TESTADO em avaliação local; IMPLEMENTADO, AGUARDANDO AUTORIZAÇÃO em produção.** A consulta pede `current` e `hourly` para US AQI, PM2,5 e PM10; prioriza `current` recente com as três grandezas válidas e usa a série horária se necessário. A restrição artificial na avaliação local foi removida. O endpoint público retornou HTTP 200, e o card agora exibe o resultado como estimativa de modelo em modo de avaliação. `OPEN_METEO_API_KEY`/licença Customer continuam ausentes neste ambiente e obrigatórios em produção. Não foi enviado e-mail.

As consultas reais Open-Meteo Weather/Marine acima são ensaios técnicos neste ambiente. `src/sources/openMeteoConfig.js` exige `OPEN_METEO_API_KEY` quando `NODE_ENV=production`; portanto a disponibilidade das séries públicas nos testes não habilita uso comercial em produção sem licença Customer.

**OCEANOP — PENDÊNCIA TÉCNICA EXTERNA.** A chamada local ainda falha em DNS (`ENOTFOUND`) antes da autenticação; token, resposta real e variáveis do serviço não puderam ser homologados. Teste no NPAB2542 não foi possível a partir desta estação. A previsão de rajadas Open-Meteo respondeu nas 11 bases e é usada como fonte identificada quando as fontes prioritárias não fornecem rajada válida.

**Coordenadas — validação operacional pendente.** Rio (`-22.9068, -43.1729`) e Santos (`-23.9609448, -46.3166316`) são as coordenadas atualmente cadastradas e usadas nas consultas, sem troca entre bases. O cadastro nomeia cidades, não identifica instalações Petrobras precisas; a confirmação de que cada ponto representa a instalação correta depende das coordenadas oficiais do CIM.

**Agendamento — configuração confirmada pelo usuário.** O pedido citou 05h/15h, mas `src/logic/informativoValidity.js`, `src/scheduler.js`, `.env.example` e `README.md` configuram **08h/15h** como horários automáticos. O usuário confirmou manter 08h/15h. A edição de 05h permanece disponível para geração manual; o agendador regular não foi alterado.

**Testes finais:** 408/408 aprovados, inclusive fronteira de meia-noite, 24 horas exatas, zero, lacuna, valor implausível, timestamp duplicado, offset incompatível, ausência de chuva INMET, `current`/reserva horária da qualidade do ar e consistência do mesmo relatório no painel, PDF e HTML do e-mail. Nenhum envio real foi executado.

## Reteste do card de qualidade do ar

**Causa-raiz específica da captura:** `src/sources/airQuality.js` exigia uma chave comercial em todos os ambientes. Como `.env` não contém `OPEN_METEO_API_KEY`, a consulta não era iniciada e `src/logic/reportBuilder.js` propagava “Licença comercial da fonte de estimativa não configurada”. O parser ainda rejeitava o fuso `America/Manaus` mesmo quando solicitado corretamente para Manaus. A checagem de licença agora usa a política comum de `src/sources/openMeteoConfig.js`: avaliação local pode consultar o endpoint público; produção (`NODE_ENV=production`) exige chave e endpoint Customer. O painel, PDF e e-mail identificam o modo de avaliação.

Consulta real de avaliação em 23/10/2026, com valor US AQI e classificação do horário de referência; estes números mudam ao longo do dia:

| Base | US AQI | Classificação | Referência local |
|---|---:|---|---|
| Rio de Janeiro | 59 | MODERADO | 15h |
| Macaé | 36 | NORMAL | 15h |
| Brasília | 44 | NORMAL | 15h |
| Manaus | 73 | MODERADO | 14h (Manaus) |
| Santos | 54 | MODERADO | 15h |
| Aracaju | 50 | NORMAL | 15h |
| Natal | 52 | MODERADO | 15h |
| Oiapoque | 34 | NORMAL | 15h |
| Vitória | 52 | MODERADO | 15h |
| Araucária | 48 | NORMAL | 15h |
| Salvador | 59 | MODERADO | 15h |

As 11 respostas incluíram PM2,5 e PM10 válidos. Montagens reais do relatório de Rio, Santos e Manaus propagaram o US AQI ao painel e ao HTML do e-mail; os testes de template validaram a tabela PDF. A suíte completa passou em **408/408**. Em produção, a ausência de chave continua uma pendência externa, sem substituição por valores fictícios ou uso indevido do endpoint público.

O servidor local da porta 3210 foi reiniciado após a correção. A própria rota `/api/preview?cidade=santos` respondeu com US AQI 54, PM2,5 17,2 µg/m³, PM10 19 µg/m³, classificação MODERADO e `modoLicenca=avaliacao_local`, sem motivo de indisponibilidade. A rota de Manaus respondeu com US AQI 73, `fuso=America/Manaus` e referência local às 14h. Valores são instantâneos, não parâmetros fixos.
