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
   GMAIL_USER=heitorfernandesmaciel@gmail.com
   GMAIL_APP_PASSWORD=xxxx xxxx xxxx xxxx
   REPORT_RECIPIENTS=heitorfernandesmaciel@gmail.com
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
HORA_ENVIO_DIARIO=06:00
```

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
- Tem um botão discreto (⚙, canto inferior direito) que abre um campo de
  senha; ao confirmar, dispara a coleta completa, gera o PDF e envia o
  e-mail **da base selecionada no momento** — o resultado aparece em um
  toast na tela.
- Tem um botão (👥, ao lado do ⚙) para cadastrar/remover responsáveis
  (nome + e-mail) da base selecionada — protegido pela mesma senha.
- Também envia automaticamente **todo dia às `HORA_ENVIO_DIARIO`**
  (padrão 06:00, horário de Brasília) para **todas as bases cadastradas**
  (cada uma para seus próprios responsáveis), enquanto o servidor estiver
  rodando — restrinja com `BASES_ENVIO_DIARIO` no `.env` se necessário.

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
| **Open-Meteo** (`api.open-meteo.com`) | Base numérica: temperatura, umidade, vento, chuva por período | Gratuita, sem chave, sem cadastro |
| **INMET** (`apiprevmet3.inmet.gov.br`) | Previsão oficial (validação cruzada) + avisos de perigo ativos (equivalente a alertas de Defesa Civil coordenados nacionalmente) | Gratuita, sem chave, API pública oficial |
| **Open-Meteo Marine** (`marine-api.open-meteo.com`) | Altura/período/direção de onda, marulho e temperatura do mar — **só nas 9 bases costeiras** | Gratuita, sem chave. Atende ao item do protocolo original que pedia dados de mar (OCEANOP) |
| **Open-Meteo Air Quality** (`air-quality-api.open-meteo.com`) | Índice UV (exposição de equipes externas) e material particulado PM2,5/PM10 | Gratuita, sem chave |

Fontes citadas no protocolo original mas **sem API pública gratuita e
estável** (por isso não integradas na coleta automática — o relatório
inclui os links para checagem manual, com a mesma ressalva de transparência
usada nos modelos de referência):
- **Windy.com** — SPA sem API pública gratuita.
- **Alerta Rio / COR-Rio / CODESAL** — boletins em página web, sem endpoint
  JSON documentado e estável.
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

Motor de regras em `src/logic/riskEngine.js`, com limiares documentados no
topo do arquivo, mais qualquer aviso oficial ativo do INMET para o
município. As recomendações das seções 2 e 3 do PDF são montadas
dinamicamente a partir das categorias de risco detectadas — nunca uma lista
genérica fixa.

| Categoria | Limiar | Base da referência |
|---|---|---|
| Chuva intensa | ≥ 20 mm ou ≥ 70% de probabilidade | calibração operacional |
| Vento forte | ≥ 60 km/h de rajada | calibração operacional |
| Calor extremo | ≥ 37 °C | calibração operacional |
| Baixa umidade | ≤ 20% | calibração operacional |
| Índice UV alto | ≥ 8 (extremo ≥ 11) | faixas da OMS |
| Mar grosso | ≥ 2,5 m (moderado ≥ 1,5 m) | escala Douglas |
| Qualidade do ar ruim | PM2,5 > 25 µg/m³ | diretriz OMS 2021 (limite 15) |

Os limiares são um ponto de partida razoável; ajustem os valores em
`LIMIARES` conforme a experiência operacional do CIM.

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

Isso mostra o painel completo (visual de TV, cards, tabela, destinatários e
os botões ⚙ / 👥) dentro da página do Streamlit, como se fosse parte dela —
inclusive as senhas de gerar relatório e gerenciar responsáveis continuam
funcionando normalmente ali dentro.

## 10. Segurança

- O arquivo `.env` contém a senha de app do Gmail — nunca o compartilhe nem
  suba para um repositório git (já está no `.gitignore`).
- `DASHBOARD_PASSWORD` é obrigatória (mínimo 12 caracteres, sem valor
  padrão); o servidor recusa iniciar sem ela.
- O painel tem um bloqueio simples (5 tentativas de senha erradas = 5 min de
  bloqueio por IP) para reduzir tentativas de força bruta na rede local.
