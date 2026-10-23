# Relatório de qualidade do ar — Protocolo Meteorológico CIM

**Verificação:** 23/10/2026, 11h10 (America/Sao_Paulo)  
**Escopo:** integração, cálculo IQAr, cobertura das bases e apresentação em painel, PDF e e-mail.

## Resultado desta verificação

A qualidade do ar estava indisponível porque o arquivo `src/sources/airQuality.js` e sua chamada em `reportBuilder.js` estavam ausentes. O painel, o PDF e o e-mail dependiam de campos `aqiPm25` e `pm25Classificacao`, enquanto o relatório atual só carregava UV. UV não é índice de qualidade do ar.

O projeto também não tem `OPEN_METEO_API_KEY` no ambiente nem no `.env` local. Como a aplicação é corporativa e a documentação da Open-Meteo exige acesso comercial para esse uso, não foi feita uma consulta ao serviço gratuito. O MonitorAr é uma aplicação pública interativa, mas o projeto não dispõe de uma API de integração autorizada/configurada. Portanto, não foi possível obter uma leitura atual para exibir sem inventar valores ou contornar a interface pública.

**Situação final:** cálculo e apresentação brasileiros foram implementados, mas nenhuma base teve IQAr novo coletado nesta execução. Até que seja configurada uma credencial comercial autorizada ou uma integração oficial de estações, o painel informa a causa da indisponibilidade e não mostra classificação estimada.

## Dados reais consultados

| Local/estação | Valor publicado | Referência | Leitura para este protocolo |
|---|---:|---|---|
| Santos — Santos-Ponta da Praia (CETESB) | IQAr 21, poluente determinante O₃, classe Boa | 21/10/2026, 18h | Valor oficial encontrado no boletim CETESB, mas já tinha cerca de 41 horas na verificação de 23/10. Foi registrado como última leitura localizada, não como condição atual do CIM. |
| Grande Vitória (IEMA) | Sem valor numérico recuperado; a página de IQAr apresentou campos “--” | Página pública consultada | O IEMA informa que sua rede automática tem 10 estações e atualização horária, mas o dado não pôde ser associado a uma estação representativa de Vitória nesta verificação. |
| Demais localidades | Nenhum valor atual de estação confirmado por uma fonte pública integrada ao projeto | 23/10/2026 | Não classificado. A página interativa do MonitorAr não fornece ao projeto uma API autorizada configurada e as redes estaduais/localizadas precisam ser verificadas por estação. |

A leitura de Santos não deve ser confundida com a coleta atual da base, nem usada para preencher outras localidades. O boletim da CETESB lista Santos e Santos-Ponta da Praia separadamente; ainda falta validar as coordenadas da estação em relação ao ponto cadastrado do CIM.

## IQAr brasileiro implementado

O módulo usa a equação de interpolação da Resolução CONAMA 506/2024 e as faixas atualizadas pela Orientação Técnica do MMA (janeiro/2025). A classe geral é o maior subíndice válido entre poluentes com dados completos:

| Classe | IQAr | Cor |
|---|---:|---|
| Boa (Normal) | 0–40 | Verde |
| Moderada | 41–80 | Amarelo |
| Ruim | 81–120 | Laranja |
| Muito Ruim | 121–200 | Vermelho |
| Péssima | 201–400 | Roxo |

| Poluente | Unidade e janela | Faixas superiores de concentração por classe |
|---|---|---|
| MP10 | µg/m³, 24 h | 45, 100, 150, 250, 600 |
| MP2,5 | µg/m³, 24 h | 15, 50, 75, 125, 300 |
| O₃ | µg/m³, 8 h | 100, 130, 160, 200, 800 |
| CO | ppm, 8 h | 9, 11, 13, 15, 50 |
| NO₂ | µg/m³, 1 h | 200, 240, 320, 1.130, 3.750 |
| SO₂ | µg/m³, 24 h | 40, 50, 125, 800, 2.620 |

O Open-Meteo fornece CO em µg/m³, enquanto o IQAr brasileiro pede ppm. Como a integração não tem observação local de temperatura/pressão no nível da concentração nem uma conversão regulatória validada, o CO não é convertido de forma aproximada nem incluído no máximo estimado. O índice Europeu e o US AQI são ignorados. Cada média móvel exige todas as horas requeridas, valores numéricos, unidade reconhecida e dado recente; dados incompletos não geram subíndice. Concentração acima do limite N5 também não é extrapolada para produzir índice fora da faixa publicada.

O CAMS entrega estimativas modeladas, com resolução global indicada pela documentação de aproximadamente 45 km e resolução horária (há produtos europeus de aproximadamente 11 km). Mesmo com a credencial configurada, os dados devem aparecer como **“Qualidade do ar estimada — Open-Meteo/CAMS”**, com a coordenada da grade e horário de referência. Eles não são medições de estação oficial.

## Cobertura por base CIM

Esta tabela distingue acesso a uma rede/boletim de uma leitura atual associada a estação representativa. “Não confirmada” não significa que não exista monitoramento na região; significa que não houve dado verificável e recente, com estação/horário, conectado nesta execução.

| Base | Situação de estação oficial nesta execução | Resultado atual para o painel |
|---|---|---|
| Rio de Janeiro | Há boletins/rede municipal SMAC; leitura recente por estação não obtida | Indisponível — fonte oficial não integrada |
| Macaé | INEA publica IQAr estadual; estação representativa e leitura atual não confirmadas | Indisponível — cobertura local a validar |
| Brasília | Nenhuma estação/leitura atual confirmada pelo conector público disponível | Indisponível — cobertura local a validar |
| Manaus | Nenhuma estação/leitura atual confirmada pelo conector público disponível | Indisponível — cobertura local a validar |
| Santos | CETESB publicou leitura de Santos-Ponta da Praia, mas com cerca de 41 h e representatividade ainda por validar | Indisponível — dado oficial localizado está desatualizado |
| Aracaju | Nenhuma estação/leitura atual confirmada pelo conector público disponível | Indisponível — cobertura local a validar |
| Natal | Nenhuma estação/leitura atual confirmada pelo conector público disponível | Indisponível — cobertura local a validar |
| Oiapoque | Nenhuma estação/leitura atual confirmada pelo conector público disponível | Indisponível — cobertura local a validar |
| Vitória | Rede IEMA/RAMQAr da Grande Vitória; leitura e estação representativa não recuperadas | Indisponível — dado atual não recuperado |
| Araucária | Nenhuma estação/leitura atual confirmada pelo conector público disponível | Indisponível — cobertura local a validar |
| Salvador | Nenhuma estação/leitura atual confirmada pelo conector público disponível | Indisponível — cobertura local a validar |

## Alterações realizadas

- Restaurado `src/sources/airQuality.js`: consulta comercial à API Air Quality, validação de séries/unidades e cálculo do IQAr brasileiro por janelas completas. Não consulta European AQI ou US AQI.
- O serviço exige a chave comercial `OPEN_METEO_API_KEY`, já prevista no projeto. Sem chave, registra `nao_configurada` com motivo explícito e não chama a API.
- `reportBuilder.js` agrega a fonte CAMS ao relatório sem misturar a atribuição do índice UV. Monitoramento agora diferencia Air Quality/CAMS e MonitorAr/MMA.
- Painel, PDF e e-mail usam índice/classe brasileiros, com cores e hora de referência; as estimativas são rotuladas como modeladas. A seção de PDF ficou compacta e removeu a referência anterior à Diretriz OMS no lugar da classificação IQAr.
- Os alertas de qualidade do ar só consideram `iqar`; um número US/EU ou concentração isolada não gera alerta.
- Testes cobrem interpolação, as cinco classes/cores, janelas de 8/24 horas, dados incompletos, exclusão de US/EU, chave comercial e todas as bases cadastradas.

**Testes executados:** 58 dos 59 arquivos de teste passaram em execução direta. O único teste não passou é o que tenta iniciar `node server.js` como processo filho (`tests/senhaObrigatoria.test.js`); o ambiente bloqueou a criação do subprocesso (`spawn EPERM`, sem status/stdout/stderr). Os testes direcionados para IQAr, todas as classes, monitoramento das bases, painel/CSP, PDF, e-mail e alertas passaram. A execução paralela pelo `node --test` também não é suportada neste ambiente, pois tenta criar workers.

## Próximos requisitos para ativar dados

1. Configurar a chave comercial autorizada da Open-Meteo no ambiente de execução; não incluir o valor em logs, relatório ou repositório.
2. Para medições oficiais, integrar um endpoint/API ou arquivo público formalmente disponibilizado pelo MonitorAr, CETESB, IEMA, INEA e redes locais; armazenar metadados da estação, coordenadas, horário, cobertura e versão do IQAr.
3. Validar a representatividade geográfica da estação em relação a cada base e definir regra de defasagem máxima para leituras oficiais.
4. Definir conversão validada para CO ou excluir explicitamente esse poluente do IQAr estimado em toda a documentação de produto.

## Fontes

- [Resolução CONAMA nº 506/2024 — DOU/CONAMA](https://conama.mma.gov.br/?id=827&option=com_sisconama&task=arquivo.download)
- [Orientação Técnica do IQAr — MMA, janeiro/2025](https://www.gov.br/mma/pt-br/assuntos/meio-ambiente-urbano-recursos-hidricos-qualidade-ambiental/qualidade-do-ar/indice-de-qualidade-do-ar-iqar/orientacao-tecnica-indice-de-qualidade-do-ar-jan-25.pdf)
- [Serviço público MonitorAr — MMA](https://www.gov.br/pt-br/servicos/obter-dados-das-estacoes-de-monitoramento-da-qualidade-do-ar-por-meio-do-indice-de-qualidade-do-ar-iqar-por-meio-do-aplicativo-monitorar)
- [MonitorAr — painel interativo](https://monitorar.mma.gov.br/)
- [Open-Meteo Air Quality API — variáveis, resolução e licença](https://open-meteo.com/en/docs/air-quality-api)
- [Boletim CETESB por estação](https://sistemasinter.cetesb.sp.gov.br/ar/php/boletim_por_estacao.php)
- [QUALAR/CETESB — serviços de estações e dados horários](https://arcgis.cetesb.sp.gov.br/server/rest/services/QUALAR/CETESB_QUALAR/MapServer)
- [IEMA — Qualidade do ar na Grande Vitória](https://iema.es.gov.br/qualidadedoarGV)
- [IEMA — página de IQAr](https://iema.es.gov.br/qualidadedoar)
- [INEA — IQAr e boletins do RJ](https://www.inea.rj.gov.br/ar-agua-e-solo/iqar/)
- [SMAC — boletins MonitorAr Rio 2026](https://ambienteclima.prefeitura.rio/monitorar-2026-boletins/)
