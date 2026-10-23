# Relatório de Integração OCEANOP/Tetra Tech + Open-Meteo

**Projeto:** Protocolo Meteorológico CIM  
**Data da validação:** 23/10/2026  
**Escopo:** previsão meteorológica, UV, chuva, vento médio, rajada prevista, condições marítimas, D+3, relatório semanal, monitoramento e procedência dos dados.

## 1. Resultado executivo

A integração foi implementada com separação explícita por variável:

| Informação | Fonte efetiva |
|---|---|
| Rajada máxima prevista | Portal Tetra Tech TTForecast nas bases cobertas |
| Rajada alternativa em base sem tabela validada | OCEANOP por coordenada, somente quando previamente configurado e autorizado |
| Índice UV | Open-Meteo Forecast |
| Probabilidade e volume de chuva previstos | Open-Meteo Forecast |
| Temperatura e umidade previstas | Open-Meteo Forecast |
| Condição geral | Open-Meteo Forecast |
| Velocidade média e direção do vento previstas | Open-Meteo Forecast |
| Altura, direção e período de ondas; onda de vento e swell | Open-Meteo Marine |
| Avisos meteorológicos oficiais | INMET |
| Observações meteorológicas | Estação automática INMET, separadas da previsão |
| Excesso de calor | Clima e Saúde |
| Monitor de Secas | ANA |

O Climatempo permanece removido. A Open-Meteo não solicita “wind_gusts_10m” nem preenche rajada prevista. Quando o portal Tetra Tech falha em uma base coberta, o campo permanece indisponível e a falha é registrada.

## 2. APIs e endpoints

### Open-Meteo Forecast

- GET https://api.open-meteo.com/v1/forecast
- Horárias: temperature_2m, relative_humidity_2m, precipitation_probability, precipitation, wind_speed_10m, wind_direction_10m, weather_code, uv_index.
- Diárias: temperature_2m_max, temperature_2m_min, precipitation_sum, precipitation_probability_max, wind_speed_10m_max, weather_code, uv_index_max.
- Parâmetro adotado: wind_speed_unit=kmh.
- Horários e dias civis usam o fuso cadastrado para cada base.
- Em produção, OPEN_METEO_API_KEY é obrigatória e o cliente usa o endpoint customer-*.

### Open-Meteo Marine

- GET https://marine-api.open-meteo.com/v1/marine
- Variáveis: wave_height, wave_direction, wave_period, wind_wave_height, swell_wave_height, swell_wave_direction, swell_wave_period e sea_surface_temperature.
- A consulta usa somente pontoMar cadastrado na base; a coordenada urbana não é reutilizada automaticamente.
- Brasília, Manaus e Araucária retornam “Não se aplica”.

### Portal Tetra Tech

- GET https://petrobras.ttforecast.com.br/api/v1/areas/json
- GET https://petrobras.ttforecast.com.br/api/v1/bulletins/{idArea}
- Autenticação suportada: X-API-Key, bearer token ou conta técnica OAuth autorizada.
- Campo de rajada: 10_metre_wind_gust_since_previous_post_processing.
- A série completa é preservada para calcular pico diário, pico por período e pico da janela da edição.
- As páginas cadastradas usam /bulletin/forecast-table/Terrestre/{localidade}.

O domínio e o contrato técnico comprovam a origem no portal Tetra Tech. O código identifica a fonte como **Tetra Tech — portal TTForecast** e não afirma que o payload veio diretamente da API OCEANOP sem comprovação contratual adicional.

## 3. Regras de rajada

- Máxima diária: maior valor entre os horários pertencentes ao mesmo dia civil da base.
- Card das 08h: maior rajada exclusivamente entre 08h e 15h.
- Card das 15h: maior rajada exclusivamente entre 15h e 00h.
- Tabelas por período: cada valor é calculado somente dentro de manhã, tarde ou noite.
- D+1 a D+3: usa o pico diário do portal para a data correspondente.
- Falha ou ausência de credencial: “Rajada prevista indisponível”.
- Open-Meteo nunca é fallback silencioso de rajada.

Conversões centralizadas:

- m/s × 3,6 = km/h;
- kt × 1,852 = km/h;
- valores já em km/h são preservados;
- unidades desconhecidas são rejeitadas.

## 4. UV, chuva e previsão D+3

O UV diário usa uv_index_max, com fallback para o maior valor horário válido do mesmo dia. Classificação: 0–2 Baixo; 3–5 Moderado; 6–7 Alto; 8–10 Muito alto; 11 ou mais Extremo.

A probabilidade de chuva permanece no intervalo 0–100 retornado pela API, sem multiplicação. Cards por período usam os valores horários; D+3 usa precipitation_probability_max e precipitation_sum. Probabilidade (%) e volume (mm) permanecem campos distintos.

## 5. Validação real por base

A rotina “npm run validar-integracao-meteo” foi executada com validação TLS ativa e certificados confiados pelo Windows.

| Base | Open-Meteo Forecast | Open-Meteo Marine | Rajada Tetra Tech |
|---|---|---|---|
| Rio de Janeiro | OK | OK — 3 períodos válidos | Pendente de credencial |
| Macaé | OK | OK — 3 períodos válidos | Pendente de credencial |
| Brasília | OK | Não se aplica | Pendente de credencial |
| Manaus | OK | Não se aplica | Pendente de credencial |
| Santos | OK | OK — 3 períodos válidos | Pendente de credencial |
| Aracaju | OK | OK — 3 períodos válidos | Pendente de credencial |
| Natal | OK | OK — 3 períodos válidos | Pendente de credencial |
| Oiapoque | OK | OK — 3 períodos válidos | Pendente de credencial |
| Vitória | OK | OK — 3 períodos válidos | Pendente de credencial |
| Araucária | OK | Não se aplica | Tabela não validada; Wenceslau Bráz não é reutilizada |
| Salvador | OK | OK — 3 períodos válidos | Pendente de credencial |

Em todas as 11 respostas meteorológicas, o campo de rajada proveniente da Open-Meteo permaneceu nulo. As oito bases costeiras retornaram altura de onda válida no ponto marítimo cadastrado.

Também foi montado um relatório real da edição das 08h para Brasília: condição, UV 8,9, probabilidade de chuva 49%, temperatura/umidade e vento vieram da Open-Meteo; INMET e Clima e Saúde responderam; mar ficou “Não se aplica”; rajada ficou indisponível por falta de credencial Tetra Tech. O fluxo concluiu sem erro 502.

## 6. Testes

- Suíte completa “npm test”: execução isolada por arquivo sem falhas reportadas.
- Testes focados finais: **14 aprovados, 0 falhas**.
- Open-Meteo: UV, chuva, vento médio, direção, unidade km/h e ausência de rajada.
- Marine: altura/período/direção, onda de vento e swell.
- Tetra Tech: m/s, nós e km/h; máximo diário; fuso de Manaus; máximo restrito à janela do card; autenticação e cache.
- D+3: agregações diárias da Open-Meteo e sobreposição exclusiva da rajada Tetra Tech.
- Modo degradado: indisponibilidade simultânea das fontes não volta a gerar HTTP 502.
- Verificação preventiva: Open-Meteo, Marine e Tetra Tech passaram a constar no monitor de fontes.

## 7. Arquivos principais modificados

- src/sources/openMeteo.js
- src/sources/openMeteoConfig.js
- src/sources/openMeteoSemanal.js
- src/sources/marine.js
- src/sources/tetratechGusts.js
- src/sources/previsaoProximosDias.js
- src/logic/weatherSourcePolicy.js
- src/logic/reportBuilder.js
- src/logic/weeklyBuilder.js
- src/logic/verificacaoFontes.js
- src/pipeline.js
- src/config/cities.js
- src/config/rajadaPortais.js
- .env.example, render.yaml, README.md e RAJADAS_PORTAIS.md
- scripts/validarIntegracaoOpenMeteo.js
- testes de Open-Meteo, Tetra Tech, D+3, prioridade de fontes e modo degradado.

## 8. Divergências corrigidas

1. Open-Meteo estava removida apesar de ser necessária para UV, chuva e demais previsões.
2. O código antigo solicitava rajadas da Open-Meteo; a variável foi retirada da consulta e dos agregados.
3. O UV vinha de outra API; agora usa uv_index e uv_index_max da Forecast API.
4. O mar podia usar coordenada terrestre; agora exige ponto marítimo explícito.
5. A integração Marine não incluía onda de vento nem direção do swell.
6. O pico diário Tetra Tech podia ser exibido em card de janela menor; agora a máxima é recalculada dentro da janela.
7. A previsão D+3 voltou a usar agregações diárias Open-Meteo, preservando a rajada como fonte separada.
8. Aracaju foi habilitada com a tabela explicitamente fornecida.
9. A fonte do portal deixou de ser rotulada como API OCEANOP sem comprovação.
10. O monitor preventivo voltou a verificar as integrações reativadas.

## 9. Pendências externas

- Fornecer TETRATECH_API_KEY ou conta técnica OAuth oficialmente autorizada para validar os boletins reais das dez áreas. Sem credencial, a aplicação mantém a rajada indisponível.
- Fornecer OPEN_METEO_API_KEY com licença Customer antes de executar em NODE_ENV=production.
- Confirmar formalmente, com a área contratual, se os produtos publicados no TTForecast devem ser denominados OCEANOP.
- Validar operacionalmente os pontos marítimos cadastrados com a área de oceanografia, embora todos tenham retornado cobertura real do modelo Marine.
- Araucária continua sem tabela terrestre própria validada; não é associada a Wenceslau Bráz.

