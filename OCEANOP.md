# Integração OCEANOP / Petrobras — rajadas previstas

## Contrato usado

- `GET https://oceanop-api-disp.petrobras.com.br/api/v1/previsao/JsonPrevisaoAreaAsync?local=...`;
- `local` é um identificador de área homologado, nunca latitude/longitude;
- timeout de 15 segundos, retentativas apenas para falhas transitórias, cache de
  5 minutos e deduplicação de chamadas simultâneas;
- a resposta só é aceita com HTTP 2xx, `success: true`, `data` como array não
  vazio e registros estruturalmente válidos;
- a chamada ocorre somente no backend e nunca desativa a validação TLS.

A consulta de previsão não usa token nem cabeçalho `Authorization`. O backend
faz diretamente o `GET` do endpoint com o parâmetro `local`.

## Cadastro seguro

As correspondências ficam em `src/config/oceanopAreas.js`. Cada chave deve
existir em `src/config/cities.js` e declarar explicitamente:

- `habilitado: true` e `local` confirmado pela OCEANOP;
- referência geográfica validada;
- fuso IANA confirmado;
- `usarVento: true`;
- unidades homologadas de `VelocidadeVento`,
  `VelocidadeVento_10M_Rajada` e `DirecaoVento`.

Estão habilitadas as bases Santos, Araucária, Manaus, Rio de Janeiro, Macaé,
Brasília e Vitória, usando como `local` os identificadores informados para cada
uma. `sururu` continua apenas como exemplo e não foi associado a nenhuma base.

## Normalização e janela operacional

São usados `Local`, `DataInicial`, `DataFinal`, `DataEscrita`, `DirecaoVento`,
`VelocidadeVento` e `VelocidadeVento_10M_Rajada`. Decimais com vírgula viram
números; vazio permanece `null`; `"0"` permanece zero. Datas só viram instantes
quando o fuso está homologado.

As unidades de `VelocidadeVento` e `VelocidadeVento_10M_Rajada` foram
confirmadas como `km/h`; os valores são preservados sem conversão. A direção é
tratada em graus.

Para a edição das 05h, a rajada OCEANOP considera 05h–15h. Para a edição das
15h, considera 15h–00h. O texto editorial “Previsão até 00h” permanece
inalterado. A maior rajada válida da janela é usada, com horário, intervalo,
área e fonte preservados. Os três dias seguintes recebem a máxima OCEANOP por
dia quando houver registro válido.

## Prioridade e falha segura

Em área homologada, OCEANOP é prioritária somente para rajada prevista.
Velocidade média e direção podem completar campos ausentes. Temperatura, chuva,
umidade, UV e demais políticas não são alteradas. Sem correspondência, unidade,
fuso ou resposta válida, o fluxo INMET/Open-Meteo existente segue
sem interrupção e a fonte efetivamente usada continua identificada.

## Situação da validação real em 20/10/2026

- DNS corporativo, TCP/443 e TLS: OK;
- Swagger: HTTP 200;
- endpoint de previsão consultado diretamente: HTTP 401 no ambiente de teste;
- resposta com `success: true`: **não obtida**.

O adaptador e os cadastros estão implementados. A confirmação operacional final
depende de uma resposta real `success: true` na rede/VPN corporativa.
