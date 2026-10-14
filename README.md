# Protocolo Meteorológico CIM

Geração automática do **Informativo Meteorológico** do CIM: coleta dados de
APIs meteorológicas gratuitas (Open-Meteo + INMET oficial), monta um relatório
com evento climático mais relevante do dia e recomendações de segurança
adaptadas ao cenário, gera um **PDF corporativo** e envia por **e-mail** (com
um resumo em HTML no corpo da mensagem). Inclui também um **painel para TV**
da sala de operação, com atualização automática, seletor de base e um botão
protegido por senha para disparar a geração manual.

**12 bases cadastradas** (seletor no topo do painel): Rio de Janeiro, Macaé,
Cabiúnas (Terminal), Brasília, Manaus, Santos, Aracaju, Linhares, Anchieta,
Vitória, Araucária e Salvador — ver `src/config/cities.js`.

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
```

Os horários permanentes são 05:00 e 15:00, ambos no fuso
`America/Sao_Paulo` e com previsão até 00h.

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
- Tem um **seletor de base** no topo (Rio de Janeiro, Macaé, Cabiúnas,
  Brasília, Manaus, Santos, Aracaju, Linhares, Anchieta, Vitória, Araucária,
  Salvador) — a base escolhida fica salva na URL (`?cidade=chave`), então dá
  pra fixar uma TV numa base específica salvando esse link.
- Atualiza os dados automaticamente a cada 10 minutos (sem enviar e-mail).
- Tem um botão discreto (⚙, canto inferior direito) que permite escolher o
  informativo meteorológico da base atual ou o aviso exclusivo COR-RIO;
  ambos exigem a senha operacional.
- Tem um botão (👥, ao lado do ⚙) para cadastrar/remover responsáveis e
  vincular uma ou várias bases. `COR-RIO — RJ` é uma base somente de
  distribuição e pode ser o único vínculo de uma pessoa.
- Envia automaticamente os informativos às 05:00 e 15:00 (horário de
  Brasília) para as bases meteorológicas e, em fluxo separado, o aviso
  COR-RIO apenas para seus próprios destinatários. `REPORT_RECIPIENTS` nunca
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
| **Open-Meteo** (`customer-api.open-meteo.com` em produção) | Base numérica: temperatura, umidade, vento, chuva por período | Exige licença comercial e `OPEN_METEO_API_KEY` em produção; a API gratuita fica restrita a desenvolvimento/auditoria não comercial |
| **INMET** (`apiprevmet3.inmet.gov.br`) | Previsão oficial (validação cruzada) + avisos de perigo ativos (equivalente a alertas de Defesa Civil coordenados nacionalmente) | Gratuita, sem chave, API pública oficial |
| **Open-Meteo Marine** (`customer-marine-api.open-meteo.com` em produção) | Altura/período/direção de onda, marulho e temperatura do mar — **só nas 9 bases costeiras** | Mesma licença/chave comercial; atende ao item do protocolo original que pedia dados de mar (OCEANOP) |
| **Open-Meteo Air Quality / CAMS** (`customer-air-quality-api.open-meteo.com` em produção) | Índice UV, PM2,5/PM10 e European AQI de PM2,5 | Mesma licença/chave comercial; a classificação do ar vem do índice publicado pela fonte |
| **Clima e Saúde — Ministério da Saúde** ([Excesso de Calor](https://clima.saude.gov.br/)) | EHF, risco combinado à saúde e GeoSES por município | Consulta server-side da página pública oficial, com validação de município, UF e data; não há contrato público de API direta documentado no portal |
| **Monitor de Secas — ANA** ([portal](https://monitordesecas.ana.gov.br/) e [tabela S0–S4](https://monitordesecas.ana.gov.br/tabela-de-classificacao)) | Seção mensal no PDF: mapa oficial e o resumo oficial da UF do destino de cada informativo | Pública, sem chave. A página é SPA; a coleta usa a mesma API (`apimsbr.ana.gov.br`) e os mesmos arquivos (S3 da ANA) que o navegador carrega. Competência em `MONITOR_SECAS_COMPETENCIA` (AAAA-MM); cache em `data/monitor-secas/` |
| **COR-Rio** ([Centro de Operações e Resiliência](https://cor.rio/), `appcor.cor-rio.work/estagio_cidade` e `cor.rio/wp-json/wp/v2/posts`) | Painel "Comunicados COR-Rio", seção técnica no PDF disponível para consulta e aviso de e-mail exclusivo da base lógica `COR-RIO — RJ` — somente para o município do Rio de Janeiro (`integracaoCorRio`) | Públicas, sem chave. O aviso por e-mail usa apenas os destinatários vinculados a `cor_rio`; responsáveis da base meteorológica `rio_de_janeiro` não o recebem automaticamente. O endpoint de estágio é o mesmo que o widget da página cor.rio consulta; última coleta válida em `data/cor-rio.json` |
| **Oceanop / Petrobras** | Diagnóstico da integração privada quando uma área é vinculada | Depende de rede/VPN e contrato interno; unidades não documentadas não são convertidas nem misturadas aos campos públicos |

Fontes citadas no protocolo original mas **sem API pública gratuita e
estável** (por isso não integradas na coleta automática — o relatório
inclui os links para checagem manual, com a mesma ressalva de transparência
usada nos modelos de referência):
- **Alerta Rio / CODESAL** — boletins em página web, sem endpoint
  JSON documentado e estável. (O COR-Rio é integrado só para a base Rio de
  Janeiro, veja a tabela acima.)
- **Climatempo** — sem API pública gratuita.

Fontes **testadas e descartadas** (registrado para não retestar à toa):
- **Estações automáticas do INMET** (`apitempo.inmet.gov.br`) — daria dados
  observados em tempo real (não só previsão), mas o endpoint de observações
  responde HTTP 204 vazio mesmo para datas passadas. Fonte instável demais
  para o protocolo depender dela.
- **Open-Meteo Flood** (vazão de rios) — funciona, mas entrega só a vazão
  absoluta (ex.: 82.984 m³/s em Manaus) sem referência histórica que
  permita dizer se está acima do normal. Sem esse contexto, o número não é
  acionável num painel de operação.

Se no futuro vocês tiverem uma chave de API paga/cadastrada (OpenWeatherMap,
HG Brasil, Climatempo Corporate etc.), dá para adicionar como mais uma fonte
em `src/sources/` seguindo o mesmo padrão de `openMeteo.js`.

## 5. Como o "evento mais relevante" é decidido

Motor de regras em `src/logic/riskEngine.js`, com limiares numéricos de chuva
e vento centralizados em `src/logic/inmetAlertRules.js`. Um aviso oficial
válido do INMET sempre prevalece para o fenômeno e conserva a severidade
publicada (Perigo Potencial = Atenção; Perigo = Alerta; Grande Perigo =
Emergência). Sem aviso oficial correspondente, dados numéricos válidos das
APIs podem produzir uma **classificação interna baseada na previsão**, sempre
identificada dessa forma no corpo do e-mail. As recomendações são específicas
por fenômeno e proporcionais ao nível detectado.

| Categoria | Limiar | Base da referência |
|---|---|---|
| Chuva — intensidade horária | Atenção de 20 a < 30 mm/h; Alerta de 30 a 60 mm/h; Emergência > 60 mm/h | critérios operacionais centralizados |
| Chuva — acumulado diário | Atenção de 20 a < 50 mm; Alerta de 50 a 100 mm; Emergência > 100 mm | critérios operacionais centralizados |
| Vento — rajada | Atenção de 30 a < 40 km/h; Alerta de 40 a 60 km/h; Emergência > 60 km/h | critérios operacionais centralizados |
| Tempestade prevista sem aviso oficial | Atenção, sem afirmar descarga elétrica confirmada | código meteorológico da fonte numérica |
| Calor / risco à saúde | EHF Baixo / Severo / Extremo | Clima e Saúde — Ministério da Saúde; temperatura alta isolada não altera o EHF |
| Baixa umidade | ≤ 20% | calibração operacional |
| Índice UV alto | Atenção ≥ 8; Alerta ≥ 11 por padrão, com nível configurável | faixas da OMS |
| Condição do mar | Atenção ≥ 1,5 m; Alerta ≥ 2,5 m | referência operacional marítima |
| Qualidade do ar | Atenção > 60; Alerta > 80; Emergência > 100 no European AQI de PM2,5 | classificação European AQI publicada pela Open-Meteo/CAMS |

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

## 6. Bases cadastradas e como adicionar outra

### Bases atuais (todas verificadas contra a API oficial do IBGE)

| Base | UF | Código IBGE | Mar |
|---|---|---|---|
| Rio de Janeiro | RJ | 3304557 | sim |
| Macaé | RJ | 3302403 | sim |
| Cabiúnas (Terminal) | RJ | 3302403 | sim |
| Brasília | DF | 5300108 | — |
| Manaus | AM | 1302603 | — |
| Santos | SP | 3548500 | sim |
| Aracaju | SE | 2800308 | sim |
| Linhares | ES | 3203205 | sim (ponto próprio) |
| Anchieta | ES | 3200409 | sim |
| Vitória | ES | 3205309 | sim |
| Araucária | PR | 4101804 | — |
| Salvador | BA | 2927408 | sim |

Dois casos merecem atenção ao mexer nesse cadastro:
- **Cabiúnas** é um distrito de Macaé, não um município. Usa coordenadas
  próprias do terminal (mais precisas para o modelo numérico) mas o código
  IBGE de Macaé, porque a previsão oficial do INMET é por município.
- **Linhares** tem litoral (foz do Rio Doce), mas o centro do município
  fica fora da grade do modelo de ondas. Por isso tem `pontoMar` próprio
  apontando para Regência — só os dados de mar usam esse ponto.

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

### Logos (Petrobras + CIM)

Ficam na pasta `Logo/`, na raiz do projeto (fora de `public/`, mas dentro do
projeto — então vão junto se vocês colocarem isso num repositório Git e
fizerem deploy, ex.: Render). Para trocar a imagem, basta substituir o
arquivo na pasta; o sistema procura por "petrobras" e "cim" no nome do
arquivo (`src/config/logos.js`), então qualquer nome que contenha essas
palavras funciona.

Usados em dois lugares:
- **Painel** (`public/dashboard.html`): CIM à esquerda do título, Petrobras
  em um cartão branco no canto superior direito.
- **PDF** (`src/render/pdfTemplate.js`): mesma posição relativa, embutidos
  como imagem no cabeçalho verde.

Se a pasta `Logo/` estiver vazia, o painel simplesmente não mostra os logos
e o PDF volta a exibir o espaço reservado em branco — nada quebra.

## 8. Estrutura do projeto

```
server.js                  servidor do painel + API
src/cli.js                 comando único (gera + envia, sem servidor)
src/pipeline.js             orquestra coleta -> PDF -> e-mail
src/config/cities.js        cadastro de cidades/instalações
src/sources/openMeteo.js    fonte Open-Meteo
src/sources/inmet.js        fonte INMET (previsão + avisos)
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
2. Sem disco persistente (também pago no Render), o cadastro de
   responsáveis (`data/responsaveis.json`) volta ao vazio a cada novo
   deploy (`git push`) — recadastre pelo botão 👥 do painel depois de cada
   deploy. Se no futuro quiserem persistência sem cartão, dá pra trocar por
   um serviço externo gratuito (Google Sheets, KV store gratuito etc.) —
   não é o padrão atual do projeto.

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
