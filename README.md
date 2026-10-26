# Protocolo Meteorológico CIM

Geração automática do **Informativo Meteorológico** do CIM: coleta dados de
fontes oficiais e meteorológicas (Clima e Saúde, INMET e fontes auxiliares), monta um relatório
com evento climático mais relevante do dia e recomendações de segurança
adaptadas ao cenário, gera um **PDF corporativo** e envia por **e-mail** (com
um resumo em HTML no corpo da mensagem). Inclui também um **painel para TV**
da sala de operação, com atualização automática, seletor de base e um botão
protegido por senha para disparar a geração manual.
Os quadros meteorológicos do painel e o resumo do e-mail priorizam valores e
períodos úteis; fontes e horários de consulta ficam detalhados no PDF.
O resumo por e-mail não inclui as tabelas de vento e chuva por período, e a
qualidade do ar é apresentada pela classificação (Normal, Moderado ou Ruim).
No PDF, as tabelas por período mantêm os valores sem colunas de referência;
o quadro de chuva acumulada estimada até a consulta não é incluído.

**11 bases cadastradas** (seletor no topo do painel): Rio de Janeiro, Macaé,
Brasília, Manaus, Santos, Aracaju, Natal, Oiapoque,
Vitória, Wenceslau Bráz e Salvador — ver `src/config/cities.js`.

---

## 1. Instalação

Já feita nesta pasta (`npm install`). Para reinstalar do zero:

```bash
npm install
```

Isso instala `express`, `nodemailer`, `node-cron`, `puppeteer` (baixa um
Chromium próprio para gerar os PDFs) e `dotenv`.

## 2. Configuração (.env)

Copie `.env.example` para `.env` e preencha:

```bash
cp .env.example .env
```

### 2.1 Envio de e-mail (Gmail com Senha de App)

O envio usa o Gmail via **Senha de App** (não a senha normal da conta):

1. Acesse **https://myaccount.google.com/security** e ative a **Verificação
   em duas etapas** (obrigatório para gerar Senha de App).
2. Acesse **https://myaccount.google.com/apppasswords**, escolha um nome
   (ex.: "Protocolo CIM") e gere a senha de 16 caracteres.
3. No `.env`, preencha:
   ```
   GMAIL_USER=usuario@empresa.com
   GMAIL_APP_PASSWORD=xxxx xxxx xxxx xxxx
   REPORT_RECIPIENTS=destinatario@empresa.com
   ```
   `REPORT_RECIPIENTS` aceita múltiplos e-mails separados por vírgula.

### 2.2 Senha do painel

```
DASHBOARD_PASSWORD=<senha forte, mínimo 12 caracteres>
```

Essa é a senha digitada na TV para disparar a geração manual do relatório e
gerenciar responsáveis. **É obrigatória**: sem ela, com menos de 12
caracteres ou com o antigo valor padrão público, o servidor não inicia.
Para gerar uma senha aleatória (16+ caracteres recomendados):

```
node -e "console.log(require('crypto').randomBytes(18).toString('base64url'))"
```

### 2.3 Cidade e agendamento

```
CIDADE=rio_de_janeiro
ENVIO_AUTOMATICO_DIARIO=true
HORARIOS_INFORMATIVO=08:00,15:00
HORARIOS_COR_RIO=08:00,15:00
```

Os únicos horários automáticos regulares são 08:00 e 15:00, no fuso
`America/Sao_Paulo`. As duas edições são independentes e usam o mesmo conteúdo
dos respectivos testes; a edição das 15h não inclui comparação com a das 08h.
A previsão operacional da edição das 08h cobre 08h–15h; a edição das 15h
cobre 15h–00h.
Valores diferentes em `HORARIOS_INFORMATIVO` são rejeitados e o agendador
retorna ao padrão seguro 08:00/15:00.

## 3. Uso

### Comando único (gera + envia uma vez, sem abrir painel)

```bash
npm run send-now
```

Ou, para testar sem gastar envio de e-mail:

```bash
node src/cli.js --sem-email
```

O PDF gerado fica em `output/Informativo_Meteorologico_<CIDADE>_<DATA>.pdf`.

### Painel na TV (recomendado para a sala de operação)

```bash
npm start
```

Abre o servidor em `http://localhost:3210`. Abra esse endereço no navegador
da TV, de preferência em **tela cheia/modo kiosk** (Chrome: `chrome
--kiosk http://localhost:3210`).

O painel:
- Tem um **seletor de base** no topo (Rio de Janeiro, Macaé,
  Brasília, Manaus, Santos, Aracaju, Natal, Oiapoque, Vitória, Wenceslau Bráz,
  Salvador) — a base escolhida fica salva na URL (`?cidade=chave`), então dá
  pra fixar uma TV numa base específica salvando esse link.
- Atualiza os dados automaticamente a cada 10 minutos (sem enviar e-mail).
- Tem um botão discreto (⚙, canto inferior direito) que permite escolher o
  informativo meteorológico da base atual ou o aviso exclusivo COR-RIO;
  ambos exigem a senha operacional.
- Tem um botão (👥, ao lado do ⚙) para cadastrar/remover responsáveis e
  vincular uma ou várias bases. `COR-RIO — RJ` é uma base somente de
  distribuição e pode ser o único vínculo de uma pessoa.
- Envia automaticamente os informativos às 08:00 e 15:00 (horário de
  Brasília) para as bases meteorológicas e, em fluxo separado nos mesmos
  horários, o aviso COR-RIO apenas para seus próprios
  destinatários. `REPORT_RECIPIENTS` nunca
  é usado como fallback do aviso COR-RIO.

### Iniciar automaticamente com o Windows

Para o painel subir sozinho quando o computador da sala de operação ligar,
crie uma tarefa no **Agendador de Tarefas do Windows**:
- Programa: `node`
- Argumentos: `server.js`
- Iniciar em: esta pasta do projeto
- Gatilho: "Ao fazer logon"

Depois, configure o navegador para abrir `http://localhost:3210` em modo
kiosk também ao iniciar a sessão.

## 4. Fontes de dados usadas

| Fonte | Uso | Observação |
|---|---|---|
| **INMET — estação automática** (`apiprevmet3.inmet.gov.br/estacao/proxima/{codigoIbge}`) | Temperatura/umidade atuais e extremos horários; `Chuva acumulada/dia`, `Chuva acumulada/Hora`; medições de vento e rajada usadas somente no monitoramento observacional | `Chuva acumulada/dia` soma as leituras cuja hora de referência pertence ao dia civil local; `Chuva acumulada/Hora` usa a última hora oficial disponível e identifica o intervalo. Uma medição de rajada nunca ocupa o campo de rajada prevista |
| **INMET — previsão e avisos** (`apiprevmet3.inmet.gov.br`) | Temperatura e umidade previstas, condição geral e avisos oficiais | Os avisos oficiais mantêm precedência operacional; observação e previsão não são misturadas |
| **Open-Meteo Forecast** (`api.open-meteo.com/v1/forecast`) | Rajada prevista, chuva prevista e probabilidade de chuva; chuva diária e dias D+1 a D+3 usam os agregados diários | Consulta pública `best_match`, fallback individual para `ncep_gfs_seamless`, fuso local, km/h e mm. Rajadas usam `wind_gusts_10m`; chuva horária soma os intervalos anteriores sem confundir com observação |
| **Open-Meteo Air Quality** (`air-quality-api.open-meteo.com/v1/air-quality`) | UV atual e US AQI atual, com PM2,5/PM10 auxiliares | Exige horário e coordenada de grade válidos. Produção exige licença/chave Customer |
| **Open-Meteo Marine** (`marine-api.open-meteo.com/v1/marine`) | Altura, direção e período de ondas, onda de vento e swell | Somente para bases costeiras e pontos marítimos cadastrados; bases interiores recebem “Não se aplica” |
| **Clima e Saúde — Ministério da Saúde** ([Excesso de Calor](https://clima.saude.gov.br/)) | EHF, risco combinado e GeoSES | Consulta server-side do HTML oficial, com validação de município, UF e data. Indisponibilidade nunca é convertida em nível Normal |
| **Monitor de Secas — ANA** ([portal](https://monitordesecas.ana.gov.br/) e [tabela S0–S4](https://monitordesecas.ana.gov.br/tabela-de-classificacao)) | Seção mensal no PDF: mapa oficial e o resumo oficial da UF do destino de cada informativo | Pública, sem chave. A página é SPA; a coleta usa a mesma API (`apimsbr.ana.gov.br`) e os mesmos arquivos (S3 da ANA) que o navegador carrega. Competência em `MONITOR_SECAS_COMPETENCIA` (AAAA-MM); cache em `data/monitor-secas/` |
| **COR-Rio** ([Centro de Operações e Resiliência](https://cor.rio/), `appcor.cor-rio.work/estagio_cidade` e `cor.rio/wp-json/wp/v2/posts`) | Painel "Comunicados COR-Rio", seção técnica no PDF disponível para consulta e aviso de e-mail exclusivo da base lógica `COR-RIO — RJ` — somente para o município do Rio de Janeiro (`integracaoCorRio`) | Públicas, sem chave. O aviso por e-mail usa apenas os destinatários vinculados a `cor_rio`; responsáveis da base meteorológica `rio_de_janeiro` não o recebem automaticamente. O endpoint de estágio é o mesmo que o widget da página cor.rio consulta; última coleta válida em `data/cor-rio.json` |

Auditoria técnica real da API pública Open-Meteo nas bases cadastradas:
`node --use-system-ca scripts/auditarOpenMeteoPublico.js`. Os resultados são
escritos em `tmp/auditoria-open-meteo-publico.json` e não substituem os testes
automatizados. Rajada, chuva e probabilidade previstas são exclusivamente
Open-Meteo; não há fallback desses indicadores para outras fontes.

Fontes citadas no protocolo original mas **sem API pública gratuita e
estável** (por isso não integradas na coleta automática — o relatório
inclui os links para checagem manual, com a mesma ressalva de transparência
usada nos modelos de referência):
- **Alerta Rio / CODESAL** — boletins em página web, sem endpoint
  JSON documentado e estável. (O COR-Rio é integrado só para a base Rio de
  Janeiro, veja a tabela acima.)

Limitação conhecida do histórico INMET:
- o endpoint legado `apitempo.inmet.gov.br/estacao/{inicio}/{fim}/{estacao}`
  respondeu HTTP 204 sem série horária, e o endpoint usado pelo portal exige
  reCAPTCHA. O sistema não contorna essa proteção. O histórico e os gráficos
  são formados progressivamente apenas pelas respostas oficiais recebidas em
  `apiprevmet3.inmet.gov.br/estacao/proxima/{codigoIbge}`; cobertura parcial é
  exibida como parcial, nunca preenchida com outro provedor.

Regras de indisponibilidade e procedência:
- temperatura/umidade atuais e extremos horários observados: somente estação INMET;
- temperatura e umidade previstas e condição geral: produto municipal INMET; valores ausentes permanecem indisponíveis;
- vento médio e direção: INMET quando válido; Open-Meteo Forecast somente como complemento modelado;
- chuva prevista, probabilidade, acumulado estimado e rajada prevista: exclusivamente Open-Meteo Forecast;
- chuva observada e medições meteorológicas: estação INMET, sempre separadas da previsão;
- valores ausentes permanecem indisponíveis e geram diagnóstico; rajada nunca usa vento sustentado como substituto;
- UV atual e qualidade do ar: Open-Meteo Air Quality (`current.uv_index` e `current.us_aqi`); UV máximo diário previsto: Open-Meteo Forecast (`daily.uv_index_max`). Sem licença comercial, ficam indisponíveis no protocolo;
- mar e ondas: Open-Meteo Marine no ponto marítimo validado da base; não se aplica às bases interiores;
- falha atual do INMET usa apenas a última observação INMET válida, com data e
  estado `armazenado/desatualizado`; estimativas modeladas não são apresentadas como observações;
- o Climatempo permanece removido e não participa de fallback.

Outras fontes contratadas podem ser adicionadas em `src/sources/` seguindo o
mesmo padrão de validação, procedência e fallback.

## 5. Como o "evento mais relevante" é decidido

Motor de regras em `src/logic/riskEngine.js`, com limiares numéricos de chuva
e vento centralizados em `src/logic/inmetAlertRules.js`. Um aviso oficial
válido do INMET sempre prevalece para o fenômeno e conserva a severidade
publicada (Perigo Potencial = Atenção; Perigo = Alerta; Grande Perigo =
Emergência). Sem aviso oficial correspondente, dados numéricos válidos das
APIs podem produzir uma **classificação interna baseada em observação oficial**, sempre
identificada dessa forma no corpo do e-mail. As recomendações são específicas
por fenômeno e proporcionais ao nível detectado.

O título de um aviso oficial também conserva literalmente o fenômeno publicado
pelo INMET, apenas normalizado para caixa alta e combinado com o grau. Exemplos:
`Tempestade` vira `TEMPESTADE — ALERTA`, `Chuvas Intensas` vira
`CHUVAS INTENSAS — ATENÇÃO` e `Vendaval` vira `VENDAVAL — EMERGÊNCIA`. Riscos,
impactos e instruções continuam no detalhamento; o sistema não acrescenta termos
ao título oficial, como transformar `Tempestade` em `Tempestade com raios`.

| Categoria | Limiar | Base da referência |
|---|---|---|
| Chuva — intensidade horária | Atenção de 20 a < 30 mm/h; Alerta de 30 a 60 mm/h; Emergência > 60 mm/h | critérios operacionais centralizados |
| Chuva — acumulado diário | Atenção de 20 a < 50 mm; Alerta de 50 a 100 mm; Emergência > 100 mm | critérios operacionais centralizados |
| Vento — rajada | Atenção de 30 a < 40 km/h; Alerta de 40 a 60 km/h; Emergência > 60 km/h | critérios operacionais centralizados |
| Tempestade | severidade do aviso oficial vigente; sem aviso, não é inferida a partir de chuva/vento de outro provedor | INMET |
| Calor / risco à saúde | EHF Baixo / Severo / Extremo | Clima e Saúde — Ministério da Saúde; temperatura alta isolada não altera o EHF |
| Baixa umidade | ≤ 20% | calibração operacional |
| Índice UV alto | Atenção ≥ 8; Alerta ≥ 11 por padrão, com nível configurável | faixas da OMS |
| Condição do mar | Atenção ≥ 1,5 m; Alerta ≥ 2,5 m | referência operacional marítima |
| Qualidade do ar | Atenção > 60; Alerta > 80; Emergência > 100 no European AQI de PM2,5 | somente quando uma fonte autorizada fornecer o indicador; atualmente indisponível |

Não altere esses limites de forma isolada: mantenha a implementação, a tabela
acima e os testes de fronteira sincronizados.

Os níveis declarados pelo CIM seguem internamente este significado:

- **Atenção:** risco aumentado e preparação; ações preventivas e reforço de prontidão.
- **Alerta:** condição perigosa provável ou em evolução; restrições operacionais e preparação para evacuação ou abrigo.
- **Emergência:** condição perigosa instalada ou iminente; paralisações, evacuação ou abrigo, resposta de saúde e controle de acessos.

As recomendações de chuva, vento e calor são cumulativas. Para manter leitura
rápida, o e-mail de alerta mostra somente o título do fenômeno, o informe
quando existir e as recomendações;
origem da classificação, explicação do nível CIM e atribuição de Instalações
não são exibidas no card.

### Monitor de alertas extraordinários

O monitor é independente dos informativos das 08h e 15h. Por padrão, consulta
as 12 bases em paralelo a cada 5 minutos, durante todo o dia. Cada base concluída
é processada imediatamente, sem aguardar as demais. Configure com
`INTERVALO_MONITOR_MIN`, `JANELA_MONITOR` e `BASES_MONITOR_ALERTAS`.

No primeiro ciclo, o estado vigente é registrado como linha de base e não gera
disparo retroativo. Depois disso, mudanças de grau, novos avisos, atualizações
materiais de avisos INMET e normalizações previstas pela política são comparadas
por base e fenômeno. A fila persistente em `data/alertas-fila.json` registra ID,
base, severidade, destinatários, tentativas, status e confirmação SMTP. Eventos
iguais não são reenviados; falhas permanecem pendentes com retentativa gradual.
O alerta usa somente os pontos focais vinculados à base, sem recorrer à lista
geral dos informativos.

## 5.1 Motor de gatilhos automáticos (chuva, vento e calor)

Implementado em `src/logic/motorGatilhos.js` (classificação, transições, histerese e
auditoria) e `src/logic/recomendacoesCumulativas.js` (herança de recomendações).
Os limites ficam em `src/logic/inmetAlertRules.js`; os textos de calor, em
`src/logic/healthProtection.js`. Os gatilhos só geram alertas e recomendações —
paralisações e evacuações seguem os procedimentos locais e o PRE.

| Fenômeno | ATENÇÃO | ALERTA | EMERGÊNCIA | Fonte |
|---|---|---|---|---|
| Chuva horária | 20 ≤ x < 30 mm/h | 30 ≤ x ≤ 60 mm/h | > 60 mm/h | INMET (estações) |
| Chuva diária | ≥ 20 mm/dia *(pendência)* | 50 ≤ x ≤ 100 mm/dia | > 100 mm/dia | INMET (estações) |
| Rajada | 30 ≤ x < 40 km/h | 40 ≤ x ≤ 60 km/h | > 60 km/h | observada: INMET; prevista: OCEANOP/Open-Meteo (alerta preventivo) |
| Calor | P1 — Baixo | P2 — Severo | P3 — Extremo | Clima e Saúde (EHF) |

* **Herança:** ALERTA = ATENÇÃO + ALERTA; EMERGÊNCIA = ATENÇÃO + ALERTA + EMERGÊNCIA, por fenômeno,
  sem repetições. Site, PDF e e-mail consomem a mesma função.
* **Severidade da chuva** = maior nível entre intensidade horária e acumulado diário. NORMAL só é
  declarado com os dois indicadores válidos; dado ausente nunca vira NORMAL.
* **Vento:** rajada observada e prevista são classificadas separadamente; previsão gera alerta
  preventivo e nunca é exibida como medição.
* **Transições:** elevações são imediatas (inclusive NORMAL → EMERGÊNCIA). Reduções e normalização
  exigem `GATILHOS_CONFIRMACOES_REDUCAO` leituras válidas consecutivas por pelo menos
  `GATILHOS_MINUTOS_ESTABILIZACAO` minutos (padrão 3 leituras / 15 min) e notificam o maior nível
  visto na janela. A janela é persistida em `data/alertas-notificados.json`.
* **Auditoria:** `data/gatilhos-historico.jsonl` (uma linha JSON por notificação enviada e por
  etapa de estabilização).
* **Simulação offline:** `node scripts/simularGatilhos.js` (valores fictícios).

**Pendência de configuração:** a tabela operacional não define o mínimo diário de chuva para
ATENÇÃO. Foi preservado o limiar anterior de 20 mm/dia (`LIMITES_ALERTA_INMET.chuvaDiariaMm.atencao`),
que precisa de aprovação formal do CIM.

## 6. Bases cadastradas e como adicionar outra

### Bases atuais (todas verificadas contra a API oficial do IBGE)

| Base | UF | Código IBGE | Mar |
|---|---|---|---|
| Rio de Janeiro | RJ | 3304557 | sim |
| Macaé | RJ | 3302403 | sim |
| Brasília | DF | 5300108 | — |
| Manaus | AM | 1302603 | — |
| Santos | SP | 3548500 | sim |
| Aracaju | SE | 2800308 | sim |
| Natal | RN | 2408102 | sim |
| Oiapoque | AP | 1600501 | sim |
| Vitória | ES | 3205309 | sim |
| Wenceslau Bráz (chave `araucaria`) | PR | 4128500 | — |
| Salvador | BA | 2927408 | sim |

Macaé/RJ é a única base operacional da região. Cabiúnas foi desativada do
monitoramento; relatórios, logs e vínculos históricos existentes permanecem
preservados nos respectivos arquivos de dados.

### Adicionar uma nova base

Edite `src/config/cities.js` e adicione um bloco com `nome`, `uf`,
`latitude`, `longitude` e `codigoIbge` (código IBGE de 7 dígitos — o mesmo
usado em `https://previsao.inmet.gov.br/<codigo>`). Se a base for costeira,
adicione `costeira: true`.

⚠️ **Confira o código IBGE antes de confiar nele** — cidades vizinhas têm
códigos parecidos e o erro é silencioso (a previsão simplesmente vem do
município errado). Verifique assim:

```bash
curl -s https://servicodados.ibge.gov.br/api/v1/localidades/municipios/3548500
```

Depois rode com `CIDADE=<chave>` no `.env`, ou
`node src/cli.js --cidade=<chave>`.

## 7. Identidade visual

Cores institucionais (`src/render/brand.js`): verde `#00843D`, amarelo
`#FFCC00`.

### Logos do cabeçalho

O site exibe somente a identidade CIM no cabeçalho. A imagem oficial
`Logo/Petrobras_horizontal_logo.svg.png` é incorporada exclusivamente ao
cabeçalho interno do PDF. O corpo dos e-mails não anexa nem renderiza a marca
Petrobras, e a antiga rota dinâmica `/api/logos` permanece removida.

## 8. Estrutura do projeto

```
server.js                  servidor do painel + API
src/cli.js                 comando único (gera + envia, sem servidor)
src/pipeline.js             orquestra coleta -> PDF -> e-mail
src/config/cities.js        cadastro de cidades/instalações
src/sources/inmet.js        fonte INMET (previsão + avisos)
src/sources/openMeteo.js    previsão meteorológica, rajadas, chuva e probabilidade
src/sources/marine.js       ondas e mar em pontos marítimos cadastrados
src/sources/inmetObservations.js observação oficial INMET + cache/histórico
src/sources/climaSaudeService.js EHF/risco térmico e disponibilidade de UV do Clima e Saúde
src/logic/weatherSourcePolicy.js prioridade e complemento campo a campo
src/logic/weatherSourceMetadata.js metadados padronizados por indicador
src/logic/riskEngine.js     motor de regras (evento + recomendações)
src/logic/reportBuilder.js  consolida fontes em um relatório único
src/render/pdfTemplate.js   HTML do PDF detalhado
src/render/emailTemplate.js HTML do resumo por e-mail
src/render/pdfGenerator.js  HTML -> PDF via Puppeteer
src/email/sendReport.js     envio via Gmail (Nodemailer)
src/scheduler.js            agendamento diário (node-cron)
public/                     painel para a TV
output/                     PDFs gerados
```

## 9. Colocar online e embutir no Streamlit

O painel (`server.js`) é uma aplicação **Node.js** — o Streamlit Community
Cloud só executa Python, então ele não consegue rodar este servidor
diretamente. O caminho é: **hospedar o Node.js em outro lugar sempre ligado**
e **embutir a URL pública dele dentro de uma página do Streamlit via
iframe**.

### 9.1 Hospedar o servidor Node (Render.com)

1. Suba este projeto para um repositório Git (pode ser privado) — o `.env`
   já está no `.gitignore`, então a senha do Gmail e a senha do painel nunca
   vão pro repositório.
2. Em [render.com](https://render.com), crie o serviço:
   - **New + → Blueprint**, apontando pro repositório — ele lê o
     `render.yaml` já incluído neste projeto e configura tudo (Docker,
     plano gratuito, variáveis de ambiente).
   - Ou, manualmente: **New + → Web Service**, ambiente **Docker**, plano
     **Free** (o `Dockerfile` já está pronto — usa a imagem oficial do
     Puppeteer para o Chrome funcionar sem erros de biblioteca faltando).
3. No painel do Render, preencha as variáveis de ambiente marcadas como
   secretas: `GMAIL_USER`, `GMAIL_APP_PASSWORD`, `REPORT_RECIPIENTS`,
   `DASHBOARD_PASSWORD` (obrigatória, mínimo 12 caracteres).
4. Ao terminar o deploy, você recebe uma URL pública fixa, por exemplo:
   `https://protocolo-meteorologico-cim.onrender.com`

**Plano gratuito do Render — duas limitações a saber:**
1. O serviço "dorme" depois de ~15 min sem acesso, e o envio automático
   diário (`node-cron`) só dispara se o processo estiver rodando na hora
   configurada. Para garantir o envio mesmo dormindo, configure um
   "despertador" externo gratuito (GitHub Actions agendado ou
   [cron-job.org](https://cron-job.org)) fazendo um `POST` diário para
   `/api/gerar-relatorio` com a senha do painel, no horário desejado — me
   avise se quiser ajuda montando isso.
2. Sem disco persistente, o cadastro de responsáveis, o estado notificado e
   a fila de alertas em `data/` são perdidos em cada deploy. Em produção, use
   disco persistente ou migre esses registros para armazenamento externo
   transacional; sem isso, a deduplicação não sobrevive a uma implantação.

Se puderem usar cartão futuramente, o plano `starter` (pago, sem hibernar)
elimina os dois problemas acima — é só trocar `plan: free` por
`plan: starter` no `render.yaml` e adicionar de volta o bloco `disk:`.

### 9.2 Embutir no Streamlit

Na página do Streamlit onde vocês querem exibir o painel:

```python
import streamlit as st

st.components.v1.iframe(
    "https://protocolo-meteorologico-cim.onrender.com",
    height=1000,
    scrolling=True,
)
```

> **Cabeçalhos de segurança:** por padrão o painel envia
> `frame-ancestors 'none'` e `X-Frame-Options: DENY`, que impedem qualquer
> site de embuti-lo. Para liberar o iframe do Streamlit, defina no ambiente
> `FRAME_ANCESTORS=https://<sua-app>.streamlit.app` (várias origens separadas
> por espaço ou vírgula; só `https://`).

Isso mostra o painel completo (visual de TV, cards, tabela, destinatários e
os botões ⚙ / 👥) dentro da página do Streamlit, como se fosse parte dela —
inclusive as senhas de gerar relatório e gerenciar responsáveis continuam
funcionando normalmente ali dentro.

## 10. Segurança

- O arquivo `.env` contém a senha de app do Gmail — nunca o compartilhe nem
  suba para um repositório git (já está no `.gitignore`).
- `DASHBOARD_PASSWORD` é obrigatória (mínimo 12 caracteres, sem valor
  padrão); o servidor recusa iniciar sem ela.
- Sem senha, `GET /api/responsaveis` devolve só os **nomes**; os e-mails só
  aparecem no modal 👥 depois de desbloquear (`POST /api/responsaveis/consultar`).
- PDFs em `/relatorios/<arquivo>.pdf` exigem a senha (o navegador abre uma
  janela de login; o usuário pode ser qualquer um) ou o link temporário
  (`urlArquivo`, com `?token=`) devolvido por `/api/gerar-relatorio`, válido
  por 24 h e só para aquele arquivo. Links deixam de valer se o servidor
  reiniciar.
- Tentativas de senha erradas deixam o IP mais lento, sem bloquear: a partir
  da 3ª falha seguida, cada tentativa desse IP espera 0,5 s, 1 s, 2 s... até
  30 s. A senha correta sempre entra (no máximo com esse atraso) e zera o
  contador. Atrás de proxy reverso, configure `TRUST_PROXY` (ver
  `INSTALACAO_SERVIDOR_PETROBRAS.md`); sem proxy, deixe desligado.
