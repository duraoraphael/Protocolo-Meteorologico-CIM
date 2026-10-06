# Respostas aos apontamentos de Segurança da Informação

Este documento apresenta os questionamentos encaminhados pela Segurança da Informação e as respectivas respostas com base no estado atual do projeto **Protocolo Meteorológico CIM**.

> **Legenda:** as respostas estão destacadas em vermelho. O símbolo 🔴 mantém a identificação visual em leitores de Markdown que não exibem cores HTML.

---

## 1. HTTPS e segurança do SMTP

### Questionamento do SI

Implementar HTTPS com TLS, no mínimo 1.2, por meio de proxy reverso com certificado corporativo, previamente ao início da operação em produção, eliminando o acesso em HTTP na porta 3210. O relay SMTP deve ser configurado com STARTTLS ou substituído por submissão autenticada na porta 587 com TLS. A implantação deve ser coordenada com a TIC.

<div style="color:#C62828;">

### 🔴 Resposta

O projeto já possui suporte técnico a HTTPS com TLS 1.2 ou superior e contém orientação de implantação por proxy reverso IIS ou nginx. Para cumprir integralmente o requisito, será utilizada a arquitetura com o proxy reverso exposto em HTTPS na porta 443, certificado emitido pela autoridade certificadora corporativa e o processo Node.js restrito ao endereço local `127.0.0.1:3210`.

A porta 3210 não deverá ser liberada no firewall nem ficar acessível por outras máquinas. Ela será usada somente como comunicação interna entre o proxy reverso e a aplicação. O acesso dos usuários acontecerá exclusivamente pelo endereço HTTPS corporativo. O proxy deverá permitir somente TLS 1.2 e 1.3, enviar o cabeçalho `X-Forwarded-Proto: https` e habilitar HSTS.

O código de envio de e-mail já valida certificados TLS. Entretanto, a configuração local atual ainda utiliza Gmail e não representa a configuração definitiva de produção. Antes da entrada em produção, o envio será migrado para o SMTP corporativo com STARTTLS obrigatório. O código também deverá ser configurado para falhar quando o relay não oferecer TLS, sem permitir `SMTP_IGNORAR_TLS=true` ou `SMTP_TLS_INSEGURO=true` em produção. Caso a TIC determine submissão autenticada, será utilizada a porta 587 com TLS e credenciais armazenadas no cofre corporativo.

No servidor corporativo foi identificado um impedimento adicional: o firewall bloqueia tanto o acesso dos usuários ao servidor quanto as conexões de saída utilizadas para consultar Open-Meteo e INMET. Quando essas conexões são bloqueadas, a aplicação aguarda os timeouts e realiza novas tentativas de coleta; por isso, ela pode aparentar estar travada, embora o processo Node.js continue em execução.

Para que a aplicação funcione, a TIC deverá autorizar e documentar dois fluxos de rede diferentes:

- **Entrada:** estações e usuários autorizados → nome DNS do painel → TCP 443 no proxy reverso do NPAB2542.
- **Comunicação local:** proxy reverso → `127.0.0.1:3210`. Essa porta continuará bloqueada para a rede e será acessível somente dentro do próprio servidor.
- **Saída para dados meteorológicos:** NPAB2542 → TCP 443 para `api.open-meteo.com`, `marine-api.open-meteo.com`, `air-quality-api.open-meteo.com` e `apiprevmet3.inmet.gov.br`.
- **Saída para serviços corporativos:** NPAB2542 → endpoints e portas autorizados para SMTP, Entra ID e Microsoft Graph, quando essas integrações estiverem habilitadas.

Se a política corporativa não permitir acesso direto à internet, a TIC deverá fornecer um proxy de saída autenticado ou outra solução corporativa aprovada. O projeto atualmente confia nos certificados instalados no Windows e aumenta o tempo permitido para o handshake TLS, mas ainda não possui configuração global para encaminhar todas as consultas de Open-Meteo e INMET por um proxy HTTP/HTTPS autenticado. Nesse cenário, será necessário adaptar o cliente HTTP da aplicação para usar o endereço do proxy e obter suas credenciais por variável protegida, conta de serviço ou cofre corporativo, nunca gravando usuário e senha no código.

Também será necessário validar a resolução DNS e a inspeção TLS corporativa. Caso o proxy de rede substitua os certificados dos sites externos por certificados emitidos pela CA interna, a cadeia dessa CA deverá estar instalada e confiável no Windows e no processo Node.js. A validação de certificado não deverá ser desativada para contornar o bloqueio.

Não é recomendável solicitar uma liberação geral de internet. A solicitação à TIC deve apresentar a matriz de fluxos com origem, destino, porta, protocolo, finalidade e responsável, limitando a liberação aos domínios necessários. Se o acesso a Open-Meteo e INMET não puder ser autorizado nem disponibilizado por proxy, será necessário definir com a área de negócio uma fonte meteorológica corporativa alternativa; sem uma fonte acessível, o serviço não conseguirá atualizar os dados e não poderá ser homologado para produção.

Essa implantação depende da TIC para emissão do certificado, criação do DNS, configuração do proxy reverso e do proxy de saída, regras de firewall, cadeia de confiança da CA interna e liberação do SMTP corporativo.

**Situação atual:** parcialmente atendido no código, mas bloqueado para uso corporativo enquanto não forem liberados o acesso HTTPS de entrada e as conexões HTTPS de saída para as fontes meteorológicas, ou fornecido um proxy corporativo compatível.

</div>

---

## 2. Autenticação nominativa, perfis e auditoria

### Questionamento do SI

Eliminar a senha operacional compartilhada do arquivo `.env` e implementar autenticação nominativa integrada ao Active Directory corporativo, Entra ID/SSO, com diferenciação de perfis de acesso — visualizador, operador e administrador —, controle de autorização por perfil e trilha de auditoria individual para todas as ações privilegiadas. A senha compartilhada não deve permanecer como único mecanismo de controle em nenhuma fase da operação.

<div style="color:#C62828;">

### 🔴 Resposta

Atualmente, a aplicação ainda utiliza a variável `DASHBOARD_PASSWORD` como senha operacional compartilhada. Embora o código exija uma senha forte, faça comparação segura e aplique atraso progressivo após tentativas incorretas, esse modelo não permite identificar qual pessoa realizou cada ação. Portanto, ele não atende integralmente ao requisito do SI.

A aplicação deverá ser integrada ao Entra ID por OpenID Connect/OAuth 2.0. Cada usuário entrará com sua própria conta corporativa, permitindo identificar de maneira individual quem acessou o sistema e quem executou uma ação privilegiada.

Serão adotados, no mínimo, os seguintes perfis:

- **Visualizador:** consulta o painel e os relatórios autorizados.
- **Operador:** consulta o painel e pode gerar e enviar relatórios.
- **Administrador:** possui as permissões anteriores e pode cadastrar, alterar ou remover responsáveis e administrar configurações autorizadas.

As permissões deverão ser validadas no servidor em cada rota protegida. Não será suficiente apenas esconder botões na interface. Os perfis poderão ser representados por App Roles do Entra ID e atribuídos por meio de grupos corporativos.

Todas as ações privilegiadas deverão registrar usuário, identificador imutável do Entra ID, perfil, data e hora, ação, base afetada, resultado, endereço IP e identificador de correlação. A senha compartilhada será removida como mecanismo normal de operação. Qualquer acesso emergencial deverá ser previamente aprovado pelo SI, armazenado no cofre e auditado.

**Situação atual:** não atendido; requer desenvolvimento de SSO, RBAC e auditoria nominativa.

</div>

---

## 3. Client Secret, Managed Identity e certificado

### Questionamento do SI

Avaliar a migração do Client Secret para Identidade Gerenciada, Managed Identity, ou autenticação por certificado na App Registration do Entra ID. Esse modelo elimina a gestão de secrets rotativos e reduz o risco de exposição de credenciais. Enquanto a migração não for concluída, o Client Secret deve ser imediatamente migrado para o cofre corporativo de senhas, com rotação periódica em intervalo não superior a 180 dias.

<div style="color:#C62828;">

### 🔴 Resposta

A integração atual com o Microsoft Graph e o GED SharePoint utiliza `AZURE_TENANT_ID`, `AZURE_CLIENT_ID` e `AZURE_CLIENT_SECRET`. O código ainda depende do Client Secret e não possui implementação de Managed Identity ou autenticação por certificado.

A viabilidade de Managed Identity deverá ser confirmada com a TIC, pois depende do tipo de infraestrutura em que o servidor NPAB2542 está hospedado. Se o servidor não estiver em um ambiente Azure compatível, a autenticação por certificado tende a ser a alternativa mais adequada.

Na opção por certificado, a chave privada deverá ser instalada no repositório de certificados do Windows, com permissão de leitura somente para a conta de serviço da aplicação. O código deverá gerar uma declaração assinada pelo certificado para solicitar o token ao Entra ID, eliminando o Client Secret do arquivo `.env`.

Até que essa migração seja concluída, o Client Secret deverá ser retirado do arquivo local e armazenado no cofre corporativo. O acesso ao segredo deverá ser restrito à conta de serviço, com responsável definido, registro de vencimento e rotação em prazo máximo de 180 dias. A troca deve ser planejada com sobreposição controlada para não interromper o envio de documentos ao GED.

A permissão `Sites.Selected` utilizada pela integração deve ser mantida, pois restringe o acesso da aplicação apenas ao site SharePoint expressamente autorizado.

**Situação atual:** não atendido; o código usa Client Secret e a estratégia definitiva depende de avaliação com a TIC.

</div>

---

## 4. Logs estruturados e integração com SIEM/Datalake

### Questionamento do SI

Configurar o envio dos logs de aplicação e de autenticação ao SIEM/Datalake da SI em formato estruturado, incluindo log de acesso HTTP e registro nominativo das ações privilegiadas, conforme alinhamento com a equipe de SI.

<div style="color:#C62828;">

### 🔴 Resposta

O projeto atualmente produz mensagens de console e registra erros técnicos, mas os eventos ainda não seguem um esquema JSON uniforme, não existe um access log HTTP completo e não há integração com o SIEM/Datalake. Além disso, a aplicação ainda não consegue produzir uma trilha verdadeiramente nominativa porque o SSO não foi implementado.

Deverá ser criado um padrão de logs estruturados contendo, conforme o tipo do evento: data e hora, nome do evento, severidade, usuário, identificador do Entra ID, perfil, método e rota HTTP, status da resposta, duração, IP de origem, base afetada, resultado e identificador de correlação.

Devem ser registrados eventos como:

- Login aceito ou recusado.
- Falha de autorização por perfil.
- Geração e envio de relatório.
- Inclusão, alteração ou remoção de responsável.
- Download de relatório protegido.
- Falhas das integrações externas.
- Inicialização e encerramento do serviço.

O IIS ou nginx também deverá gerar logs de acesso HTTP. A equipe de SI deverá definir o mecanismo de coleta, o formato final, o prazo de retenção e o destino, que poderá ser um agente instalado no servidor, Windows Event Log, arquivo JSON coletado, Splunk Forwarder, Azure Monitor Agent ou outra ferramenta corporativa.

Senhas, tokens, Client Secrets e corpos de requisições com informações sensíveis não deverão ser gravados nos logs. O acesso aos logs de auditoria também deverá ser restrito.

**Situação atual:** não atendido; requer desenvolvimento e integração com a solução corporativa indicada pelo SI.

</div>

---

## 5. Registro no inventário corporativo BDGC

### Questionamento do SI

Verificar a necessidade de registro e atualização da aplicação no inventário corporativo, BDGC, com associação à arquitetura, ao processo de negócio suportado, ao gestor responsável e ao responsável técnico, conforme o padrão PE-2SCI-00027. O registro adequado no BDGC é pré-requisito para a gestão do ciclo de vida do ativo, aplicação de patches, controle de mudanças e atribuição de responsabilidades formais sobre a aplicação e o servidor que a hospeda.

<div style="color:#C62828;">

### 🔴 Resposta

Esse requisito é administrativo e de governança. Ele não pode ser atendido somente por alteração no código-fonte. A área responsável pelo inventário deverá confirmar a obrigatoriedade e orientar a criação ou atualização do registro conforme o PE-2SCI-00027.

O cadastro deverá relacionar, no mínimo:

- Nome e finalidade da aplicação.
- Processo de negócio do CIM suportado pelo sistema.
- Servidor NPAB2542 e ambiente de execução.
- Endereço da aplicação, portas e certificado.
- Gestor do negócio e responsável técnico.
- Equipe de suporte e repositório do código.
- Tecnologia Node.js e versões utilizadas.
- Dependências de SMTP, Entra ID, SharePoint, APIs meteorológicas, proxy e certificados.
- Criticidade, classificação da informação e disponibilidade esperada.
- Procedimentos de atualização, backup, recuperação, mudança e descontinuação.

Não existe no repositório uma evidência de que esse registro já tenha sido realizado. A comprovação deverá ser feita por número ou identificador do item no BDGC e pelo vínculo formal com os responsáveis.

**Situação atual:** pendente de validação e execução pela TIC/governança.

</div>

---

## 6. Conta de execução e princípio do menor privilégio

### Questionamento do SI

Revisar a conta de execução da aplicação Node.js no servidor NPAB2542, verificando permissões em diretórios, acesso a arquivos sensíveis, como `.env`, `data/` e `logs/`, e conformidade com o princípio do menor privilégio no host. O processo da aplicação não deve ser executado sob conta com privilégios administrativos, devendo operar com a conta de serviço de menor privilégio necessário à sua função, em conformidade com a DI-1PBR-00388 e com o padrão PE-2SCI-00027.

<div style="color:#C62828;">

### 🔴 Resposta

O guia atual de instalação orienta a criação de uma tarefa agendada executada como `SYSTEM` e com `RunLevel Highest`. Essa configuração possui privilégio excessivo e precisa ser substituída antes da produção.

Deverá ser utilizada uma conta de serviço exclusiva para a aplicação, preferencialmente uma gMSA se a infraestrutura corporativa oferecer esse recurso. Essa conta não deverá ser administradora local, não deverá possuir acesso RDP ou login interativo e deverá receber somente o direito necessário para executar a tarefa ou serviço.

As permissões recomendadas são:

- Leitura e execução na pasta do código e em `node_modules/`.
- Leitura do arquivo de configuração enquanto ele ainda existir.
- Leitura da chave privada do certificado estritamente necessário.
- Escrita somente em `data/`, `output/`, diretório de logs e diretórios temporários necessários ao Chromium.
- Nenhuma permissão de escrita sobre o código da aplicação.
- Nenhum acesso a diretórios de outras aplicações do servidor.

O arquivo `data/responsaveis.json`, os logs e qualquer arquivo contendo credenciais ou dados pessoais deverão possuir ACL restrita à conta de serviço e aos administradores autorizados. As permissões efetivas deverão ser verificadas diretamente no NPAB2542, pois o repositório não mostra a configuração real do Windows.

**Situação atual:** não atendido pelo procedimento documentado; requer criação da conta de serviço e revisão das ACLs no servidor.

</div>

---

## 7. Execução de SAST, SCA e DAST

### Questionamento do SI

Executar SAST, SCA e DAST na aplicação antes da entrada em produção, utilizando as ferramentas corporativas disponibilizadas pela SI/SIC. O código-fonte deve ser submetido a análise estática, SAST, para identificação de vulnerabilidades no código Node.js; as dependências devem ser analisadas por SCA, Software Composition Analysis, com relatório formal; e a aplicação em execução deve ser submetida a DAST, Dynamic Application Security Testing, para identificação de falhas de injeção, controle de acesso e configuração. Os relatórios gerados devem ser entregues ao responsável técnico para tratamento dos achados críticos e altos antes da entrada em produção.

<div style="color:#C62828;">

### 🔴 Resposta

Os três testes possuem finalidades diferentes:

- **SAST:** examina o código-fonte sem executar a aplicação e procura falhas como injeção, validação incorreta, exposição de informações e uso inseguro de APIs.
- **SCA:** analisa as bibliotecas presentes no `package-lock.json`, suas versões, vulnerabilidades conhecidas e licenças.
- **DAST:** testa a aplicação em execução e procura falhas observáveis externamente, como problemas de autenticação, autorização, injeção e configuração de segurança.

Existe um relatório de segurança anterior, de 24/09/2026, que utilizou Semgrep, `npm audit`, testes com `curl` e Puppeteer. Diversos achados desse relatório já foram corrigidos, incluindo senha padrão, XSS, exposição de e-mails, proteção dos PDFs, validação de entradas, cabeçalhos de segurança, controle de tentativas e validação TLS do SMTP.

A suíte automatizada atual possui 258 testes aprovados. Entretanto, essa análise anterior foi assistida por IA, não utilizou as ferramentas corporativas da SI/SIC e não substitui a homologação formal exigida.

Após a conclusão do SSO, dos perfis e da auditoria, deverá ser criada uma versão de homologação em HTTPS. Essa versão será submetida às ferramentas corporativas de SAST e SCA. O DAST deverá utilizar contas de teste dos três perfis para verificar separação de permissões e tentativa de acesso horizontal ou vertical.

O ambiente de DAST não deverá enviar e-mails reais nem alterar dados de produção. Cada relatório deverá identificar claramente a versão ou commit examinado. Achados críticos e altos deverão ser corrigidos e retestados antes da produção. Exceções eventualmente aceitas deverão possuir justificativa, prazo, controle compensatório e aceite formal da SI e do responsável técnico.

**Situação atual:** há testes e análise preliminar, mas a execução corporativa formal permanece pendente.

</div>

---

## 8. Privacidade e LGPD

### Questionamento do SI

Em razão do tratamento de dados pessoais, nomes e e-mails corporativos de responsáveis, recomenda-se que o solicitante entre em contato com o Time de Privacidade da Petrobras para avaliar os controles necessários nos termos da LGPD.

<div style="color:#C62828;">

### 🔴 Resposta

Os nomes e e-mails corporativos permitem identificar pessoas e, portanto, são dados pessoais para fins da LGPD. O fato de serem dados profissionais não elimina automaticamente a necessidade de proteção.

O Time de Privacidade deverá avaliar a finalidade do cadastro, a base legal aplicável, a necessidade de cada dado, os perfis que podem consultá-lo, o prazo de retenção, o procedimento de correção e exclusão, o tratamento em backups e logs e as medidas aplicáveis em caso de incidente.

Atualmente, os responsáveis são armazenados em `data/responsaveis.json`. O painel público devolve apenas os nomes; os e-mails completos ficam protegidos pela senha operacional. Com a implantação do SSO, a consulta dos dados completos deverá ser autorizada por perfil e registrada na trilha de auditoria.

Também deverá ser avaliado o envio dessas informações por e-mail e o armazenamento de documentos no SharePoint/GED. A configuração local com Gmail não deverá ser utilizada em produção, pois os dados devem permanecer nos canais corporativos aprovados, salvo autorização formal em sentido diferente.

O contato com o Time de Privacidade deverá produzir uma orientação ou registro formal dos controles necessários, incluindo minimização, transparência, retenção, segurança, atendimento ao titular e resposta a incidentes.

**Situação atual:** pendente de avaliação formal pelo Time de Privacidade.

</div>

---

## Conclusão

<div style="color:#C62828;">

### 🔴 Posicionamento geral

O projeto já contém controles técnicos relevantes e vários problemas identificados anteriormente foram corrigidos. Entretanto, a aplicação ainda não deve ser considerada integralmente pronta para produção corporativa.

As principais pendências são a implantação do HTTPS corporativo, o SMTP com TLS obrigatório, a substituição da senha compartilhada por SSO, a implementação dos perfis e da auditoria nominativa, a integração com o SIEM, a retirada dos segredos do `.env`, a adoção de conta de serviço sem privilégio administrativo, a regularização no BDGC, a avaliação de Privacidade e a execução formal de SAST, SCA e DAST pelas ferramentas corporativas.

Além disso, qualquer credencial que tenha sido compartilhada ou exposta durante o desenvolvimento deverá ser considerada comprometida e rotacionada antes da continuidade da implantação.

</div>
