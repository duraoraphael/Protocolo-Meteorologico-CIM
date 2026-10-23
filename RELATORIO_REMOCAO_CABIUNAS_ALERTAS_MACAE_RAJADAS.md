# Relatório — Cabiúnas, alertas de Macaé e rajadas previstas

Data da validação: 21/10/2026 (America/Sao_Paulo)

## Resultado

- Cabiúnas foi removida do cadastro operacional ativo. Macaé/RJ permanece
  ativa com as coordenadas originais `-22.2828305, -41.9649091` e o código
  IBGE municipal `3302403`.
- O seletor, as consultas, o agendador, os alertas extraordinários, os novos
  PDFs/e-mails e a distribuição ativa derivam de `CIDADES`; portanto não
  incluem mais Cabiúnas.
- Nenhum arquivo histórico foi apagado. Os registros existentes de Cabiúnas
  em `data/alertas-notificados.json`, `data/relatorios-agendados.json`, caches
  e cadastro de responsáveis foram preservados. Vínculos antigos ficam
  arquivados, mas não aparecem nem podem ser selecionados para novos envios.
- Rajadas previstas agora são arredondadas para o inteiro mais próximo apenas
  na apresentação. Os valores decimais originais continuam nos modelos,
  cálculos, máximas e comparações de severidade.

## Causa da divergência Cabiúnas × Macaé

O histórico preservado identifica explicitamente:

- `cabiunas|vento`: `ATENÇÃO`, fonte `Open-Meteo — previsão complementar`,
  natureza `Classificação interna baseada na previsão`, janela
  `Tarde (12h–18h)`, registrada em `2026-10-21T15:00:16.530Z`.
- `macae|vento`: `NORMAL`, também derivado da previsão complementar.

Portanto, o alerta que aparecia em Cabiúnas não era um aviso oficial exclusivo
do INMET. Era um gatilho interno do CIM, calculado com a rajada prevista no
ponto geográfico próprio que Cabiúnas possuía. Macaé consultava outro ponto e
também possuía integrações prioritárias próprias de OCEANOP/Tetra Tech; valores
diferentes podiam produzir classificações diferentes.

Os avisos oficiais não poderiam justificar a diferença: as duas bases usavam
o mesmo código IBGE `3302403`. A implementação do INMET filtra a lista nacional
pelos geocódigos oficiais e pela interseção da validade do aviso. Em consulta
real específica realizada em 21/10/2026, o INMET retornou zero aviso ativo para
o geocódigo de Macaé.

## Situação das fontes para Macaé

Auditoria real executada em 21/10/2026:

| Fonte | Situação | Evidência |
|---|---|---|
| INMET — previsão | Operacional | Campos esperados recebidos para Macaé |
| INMET — observação | Operacional | Campos esperados recebidos para Macaé |
| INMET — avisos | Operacional | Geocódigo `3302403`; zero aviso ativo no instante da consulta |
| Open-Meteo Weather | Operacional | Campos esperados recebidos para as coordenadas de Macaé |
| Clima e Saúde | Operacional | EHF de 21/10/2026 lido; sem excesso/risco normal na coleta |
| OCEANOP | Indisponível por autenticação | Endpoint respondeu HTTP 401; fallback preservado e identificado |
| Climatempo Advisor | Não configurado | Token e ID oficial de Macaé não estão disponíveis no ambiente |

A OCEANOP continua prioritária quando autenticada e homologada. O sistema não
promove seu dado quando a consulta falha. O Climatempo continua opcional para
chuva diária; sem credenciais, os fallbacks existentes permanecem ativos.

## Formatação das rajadas

A regra compartilhada cobre site, painel de áreas OCEANOP, PDFs, e-mails
diários, alertas extraordinários e produtos semanais:

- `30,20 km/h` → `30 km/h`
- `42,75 km/h` → `43 km/h`
- `18,90 km/h` → `19 km/h`
- `55,40 km/h` → `55 km/h`
- `105,80 km/h` → `106 km/h`
- valor ausente, inválido ou negativo → `Indisponível` (nunca zero fabricado)

## Testes

- Suíte completa: **412 testes aprovados, 0 falhas**.
- Inclui cadastro ativo, rejeição de Cabiúnas nas rotas, preservação de vínculo
  histórico, alertas individuais por base, geocódigo INMET, prioridades das
  fontes, site, PDF, e-mail e arredondamento de rajadas.
- `git diff --check`: sem erro de whitespace; apenas aviso de normalização
  futura LF/CRLF em um arquivo de teste.

## Pendências externas

1. Corrigir/renovar a autenticação OCEANOP que atualmente retorna HTTP 401.
2. Configurar `CLIMATEMPO_API_TOKEN` e `CLIMATEMPO_LOCALE_ID_MACAE` caso a API
   Advisor seja contratada.
3. Não foi enviado nenhum e-mail ou alerta de teste a destinatários reais.
