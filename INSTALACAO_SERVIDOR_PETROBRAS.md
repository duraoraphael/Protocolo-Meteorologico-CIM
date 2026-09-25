# Instalação no servidor Petrobras (Windows Server)

Guia autossuficiente para quem for instalar o **Protocolo Meteorológico CIM**
no servidor corporativo. Não depende de nenhum contexto além do que está
aqui e no `README.md` (instruções gerais do projeto).

Servidor de referência usado no dimensionamento abaixo: Windows Server 2022,
4 vCPU, 16 GB RAM — qualquer máquina igual ou superior atende.

---

## 0. Pré-requisitos de acesso

- Acesso RDP ao servidor, com permissão para instalar software e criar
  tarefa agendada (precisa rodar um passo como **Administrador**).
- Saída de rede liberada para: `smtp.petrobras.com.br:25` (SMTP interno),
  `login.microsoftonline.com` e `graph.microsoft.com` (GED SharePoint),
  e — para a coleta meteorológica — `api.open-meteo.com`,
  `marine-api.open-meteo.com`, `air-quality-api.open-meteo.com` e
  `apiprevmet3.inmet.gov.br`.
- Se a rede usa proxy corporativo para saída à internet, seja necessário
  configurar isso separadamente — avise o desenvolvedor se os testes do
  passo 6 falharem por timeout (não por HTTP 403/401).

## 1. Instalar o Node.js

Versão **LTS** (20 ou 22), 64 bits:
https://nodejs.org/en/download

Confirme, no PowerShell:
```powershell
node --version
npm --version
```

## 2. Escolher onde instalar

**Prefira uma unidade com espaço de sobra e não a unidade de sistema
(C:\)** — a aplicação usa Puppeteer (Chrome headless, ~700 MB) e acumula
PDFs gerados ao longo do tempo.

```powershell
New-Item -ItemType Directory -Path "D:\Aplicacoes\ProtocoloMeteorologicoCIM" -Force
Set-Location "D:\Aplicacoes\ProtocoloMeteorologicoCIM"
```

## 3. Colocar o código no servidor

**Se o servidor tem acesso ao GitHub:**
```powershell
git clone https://github.com/hei7oor/Protocolo-Meteorologico.git .
```

**Se não tem** (rede corporativa costuma bloquear): extraia aqui o arquivo
`.zip` que acompanha este guia.

## 4. Instalar as dependências

```powershell
npm install
```

Se a rede bloquear o registro público do npm, será preciso apontar para um
repositório interno (Artifactory/Nexus ou equivalente):
```powershell
npm config set registry <URL_DO_REPOSITORIO_INTERNO>
```

O `npm install` baixa também um Chrome próprio para o Puppeteer (~700 MB).
Se isso falhar por bloqueio de rede, avise o desenvolvedor — há uma forma
de usar um Chrome já instalado no servidor em vez de baixar um novo.

## 5. Configurar o `.env`

```powershell
Copy-Item .env.example .env
notepad .env
```

Preencha (valores reais fornecidos separadamente, por canal seguro — **não
comitados no repositório**):

| Variável | Valor |
|---|---|
| `SMTP_HOST` | `smtp.petrobras.com.br` |
| `SMTP_PORTA` | `25` |
| `EMAIL_REMETENTE` | `raphael.durao.prestserv@petrobras.com.br` |
| `AZURE_TENANT_ID` | *(fornecido pelo Breno — App Registration)* |
| `AZURE_CLIENT_ID` | *(idem)* |
| `AZURE_CLIENT_SECRET` | *(idem — tratar como senha)* |
| `SHAREPOINT_SITE_HOSTNAME` | `petrobrasbr.sharepoint.com` |
| `SHAREPOINT_SITE_PATH` | `/teams/ged-142` |
| `SHAREPOINT_DRIVE_ID` | *(fornecido separadamente)* |
| `SHAREPOINT_PASTA_DESTINO` | `Protocolo Meteorológico CIM` |
| `DASHBOARD_PASSWORD` | **defina uma senha nova** — não reaproveite valor de teste |
| `ENVIO_AUTOMATICO_DIARIO` | `true` |
| `HORA_ENVIO_DIARIO` | `07:30` |
| `MONITOR_ALERTAS` | `true` |

Demais variáveis (bases monitoradas, Windy opcional etc.) já vêm com
valores padrão razoáveis — ver comentários no próprio `.env.example`.

### 5.1 Certificado do relay SMTP (CA interna)

O envio pelo relay corporativo **valida o certificado TLS** do servidor
SMTP (STARTTLS). Como o certificado do relay é emitido pela CA interna da
Petrobras, que não vem na lista de confiança do Node, informe a CA ao Node:

1. Peça à TI a cadeia da CA interna (raiz e intermediárias) em formato
   **PEM/Base64** (`.pem`/`.crt` com `-----BEGIN CERTIFICATE-----`). Pode
   ser um único arquivo com vários certificados concatenados.
2. Salve, por exemplo, em `D:\Certificados\ca-petrobras.pem`.
3. Defina a variável **de ambiente do sistema** (não funciona pelo `.env`,
   porque o Node lê essa variável antes de iniciar):

   ```powershell
   [Environment]::SetEnvironmentVariable("NODE_EXTRA_CA_CERTS", "D:\Certificados\ca-petrobras.pem", "Machine")
   ```

   Reinicie a tarefa agendada (ou o servidor) para valer.
4. Teste com `node src/cliTestarEmail.js --enviar-para=...` (passo 6).

Só se o teste falhar com erro de certificado e for preciso enviar enquanto
a CA não é instalada, use temporariamente `SMTP_TLS_INSEGURO=true` no
`.env` — o log mostra um aviso a cada inicialização. Remova assim que a CA
estiver configurada. Evite `SMTP_IGNORAR_TLS=true` (desliga a criptografia).

## 6. Validar antes de confiar em qualquer automação

**E-mail** — confirma o SMTP corporativo com um envio de teste real:
```powershell
node src/cliTestarEmail.js --enviar-para=seu.email@petrobras.com.br
```
Só prossiga se o e-mail chegar de verdade.

**GED SharePoint:**
```powershell
node src/cliTestarSharepoint.js --site=petrobrasbr.sharepoint.com --caminho=/teams/ged-142
```

**Painel:**
```powershell
npm start
```
Acesse `http://localhost:3210` no próprio servidor (ou `https://localhost:3443`
se já configurou a opção A do passo 8). Cadastre um responsável
de teste (botão 👥) e use "Gerar e Enviar" para validar o fluxo completo
antes de deixar automático. Pare o servidor (`Ctrl+C`) depois de validar —
o passo 7 vai deixá-lo rodando de forma permanente.

## 7. Deixar rodando sozinho (inicia com o servidor, reinicia se cair)

Abra o PowerShell **como Administrador**. A tarefa roda o Node com
`NODE_ENV=production` (desliga mensagens de depuração do Express e ativa o
aviso de "servindo só HTTP" no log):

```powershell
$acao = New-ScheduledTaskAction -Execute "cmd.exe" -Argument '/c "set NODE_ENV=production&& node.exe server.js"' -WorkingDirectory "D:\Aplicacoes\ProtocoloMeteorologicoCIM"
$gatilho = New-ScheduledTaskTrigger -AtStartup
$config = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName "ProtocoloMeteorologicoCIM" -Action $acao -Trigger $gatilho -Settings $config -User "SYSTEM" -RunLevel Highest

Start-ScheduledTask -TaskName "ProtocoloMeteorologicoCIM"
```

> Atenção: em `set NODE_ENV=production&&` **não** pode haver espaço antes do
> `&&` (o espaço entraria no valor). Se a tarefa já existia, remova antes com
> `Unregister-ScheduledTask -TaskName "ProtocoloMeteorologicoCIM" -Confirm:$false`.
> Alternativa: incluir a linha `NODE_ENV=production` no `.env`.

Confirme que subiu:
```powershell
Get-ScheduledTask -TaskName "ProtocoloMeteorologicoCIM" | Get-ScheduledTaskInfo
```

## 8. HTTPS e acesso pela rede

O painel trafega a senha operacional, nomes/e-mails de responsáveis e os
PDFs — **não o exponha na rede em HTTP puro**. Escolha **uma** das opções.
Nos dois casos o certificado deve ser emitido pela **CA corporativa**
(peça à equipe de certificados/TI um certificado para o nome DNS do
servidor, ex.: `painelcim.petrobras.com.br`), para que as TVs e navegadores
da rede confiem nele sem alerta.

### Opção A — certificado direto no Node (mais simples)

1. Receba o certificado em formato **.pfx** (com a chave privada) e guarde
   fora da pasta do projeto, com acesso restrito, ex.:
   `D:\Certificados\painelcim.pfx`.
2. No `.env`, acrescente:

   | Variável | Valor |
   |---|---|
   | `HTTPS_PFX_PATH` | `D:\Certificados\painelcim.pfx` |
   | `HTTPS_PFX_SENHA` | senha do .pfx (tratar como segredo) |
   | `HTTPS_PORTA` | `3443` (padrão; use `443` se a porta estiver livre) |
   | `HTTPS_HOST_PUBLICO` | *(opcional)* nome DNS usado no redirecionamento, ex. `painelcim.petrobras.com.br` |

3. Reinicie a tarefa. O painel passa a responder em
   `https://painelcim.petrobras.com.br:3443`; a porta antiga `3210` fica
   apenas **redirecionando** para HTTPS (o link salvo na TV continua
   funcionando) e as respostas HTTPS levam `Strict-Transport-Security`.
   Se só uma das duas variáveis estiver definida, ou o .pfx/senha estiverem
   errados, o servidor **não sobe** (confira o log). Se o log acusar
   certificado inválido mesmo com a senha certa, o .pfx provavelmente usa
   criptografia antiga (RC2/3DES) que o Node 18+ não lê: exporte de novo no
   Windows (*certlm.msc → Exportar → com chave privada → criptografia
   AES256-SHA256*).
4. Firewall: libere a porta HTTPS (e a 3210, se quiser manter o
   redirecionamento), de preferência só para a faixa de IPs da sala de
   operação/TVs:

   ```powershell
   New-NetFirewallRule -DisplayName "Painel CIM HTTPS" -Direction Inbound -LocalPort 3443 -Protocol TCP -Action Allow -RemoteAddress <faixa-da-sala>
   New-NetFirewallRule -DisplayName "Painel CIM (redireciona)" -Direction Inbound -LocalPort 3210 -Protocol TCP -Action Allow -RemoteAddress <faixa-da-sala>
   ```

### Opção B — proxy reverso IIS ou nginx, com o Node só em 127.0.0.1

Use quando a área já tem IIS/nginx com o certificado instalado.

1. No `.env`:

   | Variável | Valor |
   |---|---|
   | `HOST` | `127.0.0.1` — o Node só aceita conexões da própria máquina |
   | `TRUST_PROXY` | `127.0.0.1` — confia no `X-Forwarded-For`/`X-Forwarded-Proto` só vindos do proxy local |

   (Não defina `HTTPS_PFX_PATH`/`HTTPS_PFX_SENHA` nesta opção.)
2. **IIS** (com os módulos *URL Rewrite* e *Application Request Routing*
   instalados): crie um site com binding **HTTPS 443** usando o certificado
   da CA corporativa, habilite o proxy em *ARR → Server Proxy Settings* e
   adicione a regra de reescrita para `http://127.0.0.1:3210/{R:1}`,
   repassando o cabeçalho `X-Forwarded-Proto: https`. Crie também um
   binding HTTP 80 com regra de redirecionamento permanente para `https://`
   e ative HSTS no site (IIS 10: *HSTS → Enable, Max-Age 31536000*).
3. **nginx** (exemplo mínimo):

   ```nginx
   server {
     listen 80;
     server_name painelcim.petrobras.com.br;
     return 301 https://$host$request_uri;
   }
   server {
     listen 443 ssl;
     server_name painelcim.petrobras.com.br;
     ssl_certificate     /caminho/painelcim.crt;   # cadeia da CA corporativa
     ssl_certificate_key /caminho/painelcim.key;
     ssl_protocols TLSv1.2 TLSv1.3;
     add_header Strict-Transport-Security "max-age=31536000" always;
     location / {
       proxy_pass http://127.0.0.1:3210;
       proxy_set_header Host $host;
       proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
       proxy_set_header X-Forwarded-Proto https;
     }
   }
   ```

4. Firewall: libere só 443 (e 80 para o redirecionamento). **Não** libere
   a 3210 — com `HOST=127.0.0.1` ela nem fica acessível pela rede.

### Sem HTTPS (só para teste local)

Sem as variáveis acima, o painel continua em `http://<servidor>:3210` em
todas as interfaces, como antes. Com `NODE_ENV=production` o log mostra um
aviso. Não use assim na rede da sala de operação.

### Iframe (Streamlit)

O painel não pode ser embutido em outros sites por padrão. Se precisar,
defina `FRAME_ANCESTORS=https://<origem-autorizada>` (ver README §9.2).

## 9. Checklist final

- [ ] `node src/cliTestarEmail.js --enviar-para=...` chegou de verdade
- [ ] `node src/cliTestarSharepoint.js ...` resolveu o site sem erro
- [ ] Painel acessível e responsáveis cadastrados nas 12 bases
- [ ] Tarefa agendada criada e rodando (`Get-ScheduledTask`), com `NODE_ENV=production`
- [ ] Painel acessível só por **HTTPS** (opção A ou B do passo 8), com certificado da CA corporativa
- [ ] Firewall liberado só para as portas e faixas de IP necessárias
- [ ] `.env` **não** foi commitado nem enviado por canal inseguro

---

Dúvidas ou erro em qualquer passo: encaminhe a mensagem de erro completa
(não resuma) para o desenvolvedor — a maioria dos problemas de rede
corporativa (proxy, DNS interno, bloqueio de porta) tem solução simples de
identificar pelo texto exato do erro.
