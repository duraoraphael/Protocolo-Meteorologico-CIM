# Relatório de correção — Climatempo e alertas por base

Data da auditoria: 21/10/2026.

## Resultado

- Os informativos continuam restritos a 08:00 e 15:00.
- A chuva diária prevista e a probabilidade diária priorizam o Climatempo
  Advisor quando a API contratada devolve valores válidos para a data e a
  localidade esperadas.
- INMET/Open-Meteo permanecem como fallback e sua procedência é preservada por
  campo e, em D+1 a D+3, também quando apenas algumas datas recebem Climatempo.
- Os alertas extraordinários são verificados por base em paralelo e processados
  assim que cada base termina, sem aguardar o informativo ou as demais bases.
- O monitor opera por padrão a cada 5 minutos, 24 horas por dia.

## Causa do uso contínuo do Open-Meteo

A integração Advisor existe e é chamada pelo backend, mas o ambiente auditado
não possui `CLIMATEMPO_API_TOKEN` nem nenhum dos 12 IDs oficiais de localidade.
Por isso a integração retorna `nao_configurada` sem fazer requisição e o sistema
mantém corretamente o fallback. Não há cache do Climatempo promovendo dados
antigos e nenhum valor Open-Meteo é renomeado como Climatempo.

Também foi corrigido um erro independente (`degradado is not defined`) no ramo
que usa cache válido do portal Tetra Tech. A integração OCEANOP não foi alterada.

## Playwright e autorização

Playwright não está instalado; o projeto usa Puppeteer somente para gerar PDFs.
Não foi adicionado scraping. Os termos públicos vigentes do Climatempo vedam
robôs e outros meios automatizados, e não foi apresentada autorização escrita
específica para automatizar o site. A integração automática permanece limitada
à API corporativa Advisor autorizada. Consequentemente, não houve captura de
screenshot do site público.

Referências oficiais:

- https://www.climatempo.com.br/legal/termos-de-uso
- https://advisor.climatempo.com.br/

## Situação das 12 bases

| Base | Mapeamento e coordenadas | Advisor no ambiente auditado |
|---|---|---|
| Rio de Janeiro/RJ | cadastrado | não configurado — token/ID ausentes |
| Macaé/RJ | cadastrado | não configurado — token/ID ausentes |
| Cabiúnas (Terminal)/RJ | coordenadas próprias do terminal | não configurado; exige também validação contratual do ID |
| Brasília/DF | cadastrado | não configurado — token/ID ausentes |
| Manaus/AM | cadastrado | não configurado — token/ID ausentes |
| Santos/SP | cadastrado | não configurado — token/ID ausentes |
| Aracaju/SE | cadastrado | não configurado — token/ID ausentes |
| Natal/RN | `-5.8115, -35.2415` | não configurado — token/ID ausentes |
| Oiapoque/AP | `3.861224, -51.796699` | não configurado — token/ID ausentes |
| Vitória/ES | cadastrado | não configurado — token/ID ausentes |
| Araucária/PR | valida retorno exclusivo de Araucária/PR | não configurado — token/ID ausentes |
| Salvador/BA | cadastrado | não configurado — token/ID ausentes |

## Comparação, fila e deduplicação dos alertas

O estado confirmado fica em `data/alertas-notificados.json`, separado por
`base|fenomeno`. O primeiro ciclo registra uma linha de base sem enviar alertas
retroativos. Os ciclos seguintes comparam grau, identificador/versão do aviso,
validade, recomendações e conteúdo material. Pequenas variações numéricas dentro
do mesmo grau interno não geram e-mail.

A fila `data/alertas-fila.json` guarda ID SHA-256 do evento, base, fenômenos,
severidade, destinatários, prioridade, tentativas, status, horários e confirmação
SMTP. Um arquivo de trava com expiração impede que dois processos assumam o
mesmo evento. Falhas retornam o evento a `pendente`, com backoff de 5 a 60
minutos. O estado notificado só avança depois da confirmação SMTP; o mesmo ID é
usado no `Message-ID` e no cabeçalho `X-CIM-Alert-Event-ID`.

Os destinatários são lidos exclusivamente do cadastro da base, sem fallback na
lista geral. Uma base sem ponto focal mantém o evento pendente e registra erro.

## Testes

- 56 arquivos de teste executados diretamente.
- Todos passaram; o único teste inicialmente impedido pelo sandbox (processo
  filho do servidor) passou isoladamente com a permissão necessária.
- Cenários A a H dos alertas cobertos em `tests/alertQueue.test.js`.
- Integração Advisor, 12 mapeamentos, Cabiúnas, Araucária e D+1/D+2/D+3 cobertos
  em `tests/climatempoDaily.test.js`.
- Geração real do PDF do RJ concluída sem envio de e-mail.

## Pendências operacionais

1. Contratar/habilitar o Advisor e configurar o token e os 12 IDs oficiais.
2. Confirmar com o fornecedor que o ID de Cabiúnas representa o terminal antes
   de ativar `CLIMATEMPO_CABIUNAS_LOCALIZACAO_VALIDADA=true`.
3. Executar uma validação real das 12 respostas após receber as credenciais.
4. Garantir armazenamento persistente para `data/` em produção; sem isso,
   cadastro, histórico e fila não sobrevivem a um novo deploy.
5. As credenciais Tetra Tech/OCEANOP e OCEANOP retornaram 403/401 na verificação
   ponta a ponta; os fallbacks continuaram funcionando e essas integrações não
   foram modificadas.

## Arquivos principais

- `src/sources/climatempoDaily.js`
- `src/logic/reportBuilder.js`
- `src/sources/previsaoProximosDias.js`
- `src/config/cities.js`
- `src/pipeline.js`
- `src/logic/alertWatcher.js`
- `src/logic/alertQueue.js`
- `src/email/sendAlert.js`
- `src/scheduler.js`
- `.env.example`
- `render.yaml`
- `README.md`
- `tests/climatempoDaily.test.js`
- `tests/alertQueue.test.js`
