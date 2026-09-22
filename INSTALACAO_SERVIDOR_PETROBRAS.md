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
| `EMAIL_REMETENTE` | `SAAUTC@petrobras.com.br` |
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
Acesse `http://localhost:3210` no próprio servidor. Cadastre um responsável
de teste (botão 👥) e use "Gerar e Enviar" para validar o fluxo completo
antes de deixar automático. Pare o servidor (`Ctrl+C`) depois de validar —
o passo 7 vai deixá-lo rodando de forma permanente.

## 7. Deixar rodando sozinho (inicia com o servidor, reinicia se cair)

Abra o PowerShell **como Administrador**:

```powershell
$acao = New-ScheduledTaskAction -Execute "node.exe" -Argument "server.js" -WorkingDirectory "D:\Aplicacoes\ProtocoloMeteorologicoCIM"
$gatilho = New-ScheduledTaskTrigger -AtStartup
$config = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName "ProtocoloMeteorologicoCIM" -Action $acao -Trigger $gatilho -Settings $config -User "SYSTEM" -RunLevel Highest

Start-ScheduledTask -TaskName "ProtocoloMeteorologicoCIM"
```

Confirme que subiu:
```powershell
Get-ScheduledTask -TaskName "ProtocoloMeteorologicoCIM" | Get-ScheduledTaskInfo
```

## 8. Liberar acesso ao painel pela rede

Se outras pessoas vão acessar o painel a partir de outras máquinas:
```powershell
New-NetFirewallRule -DisplayName "Painel CIM" -Direction Inbound -LocalPort 3210 -Protocol TCP -Action Allow
```

## 9. Checklist final

- [ ] `node src/cliTestarEmail.js --enviar-para=...` chegou de verdade
- [ ] `node src/cliTestarSharepoint.js ...` resolveu o site sem erro
- [ ] Painel acessível e responsáveis cadastrados nas 12 bases
- [ ] Tarefa agendada criada e rodando (`Get-ScheduledTask`)
- [ ] Firewall liberado, se aplicável
- [ ] `.env` **não** foi commitado nem enviado por canal inseguro

---

Dúvidas ou erro em qualquer passo: encaminhe a mensagem de erro completa
(não resuma) para o desenvolvedor — a maioria dos problemas de rede
corporativa (proxy, DNS interno, bloqueio de porta) tem solução simples de
identificar pelo texto exato do erro.
