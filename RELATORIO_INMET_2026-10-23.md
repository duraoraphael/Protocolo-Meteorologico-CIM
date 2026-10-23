# Integração INMET — temperatura e umidade

Auditoria executada em 23/10/2026. Consulta das 11 localidades às 18:57 UTC (15:57 em Brasília), sem envio de e-mails. Evidência bruta: `tmp/inmet-audit-final-2026-10-23.json`. A auditoria usa cache vazio em memória para medir a cobertura que uma única consulta oferece; não altera o histórico operacional.

## Causa e correção

- Os indicadores principais `tempMin`, `tempMax`, `umidadeMin` e `umidadeMax` eram sobrescritos pela previsão Open-Meteo, embora a observação INMET já fosse coletada em campos separados. Agora usam exclusivamente os extremos horários observados pelo INMET no dia civil local. Temperatura e umidade atuais também vêm da última leitura válida da estação.
- `TEM_MIN`/`TEM_MAX` e `UMD_MIN`/`UMD_MAX` representam os extremos da hora anterior. A leitura das 00h foi atribuída ao dia anterior, e leituras futuras ou de outros dias são excluídas. `9999`, ausências, valores fora dos limites e pares mínimo > máximo não entram na apuração. A cobertura exige mínimo e máximo válidos na mesma leitura; uma série incompleta aparece como parcial.
- O histórico local agora descarta observações de outra estação quando o vínculo municipal muda. A leitura e o cadastro precisam concordar em código, UF e localização.
- Para temperatura e umidade, a estação precisa estar na mesma UF da base e a até 50 km das coordenadas municipais cadastradas. Esse limite conservador evita publicar uma leitura distante como se fosse local. O fluxo já existente de chuva e vento observados permanece independente desse filtro.
- O endpoint de previsão oficial INMET falhava com `UNABLE_TO_VERIFY_LEAF_SIGNATURE` no Windows local. A consulta agora usa os certificados do sistema. A previsão de temperatura e umidade para hoje na tabela de previsão e para D+1 a D+3 vem da previsão municipal oficial do INMET; os extremos observados têm rótulos próprios. Chuva e probabilidade previstas continuam com Open-Meteo.
- Os cards principais do painel e a tabela observada do PDF usam os mesmos quatro campos normalizados e mostram cobertura parcial. Após o ajuste solicitado no corpo do e-mail, seus dois cards exibem a previsão municipal oficial INMET para o dia, com títulos de previsão; observações nunca ocupam esses cards. A origem e o horário seguem registrados no relatório para auditoria.

## Endpoints oficiais consultados

| Uso | Endpoint | Resultado nesta auditoria |
| --- | --- | --- |
| Última observação da estação associada ao município | `https://apiprevmet3.inmet.gov.br/estacao/proxima/{codigoIbge}` | HTTP 200 nas 11 bases |
| Catálogo de estações automáticas | `https://apitempo.inmet.gov.br/estacoes/T` | HTTP 200; 669 estações retornadas |
| Previsão oficial municipal | `https://apiprevmet3.inmet.gov.br/previsao/{codigoIbge}` | HTTP 200 nas 11 bases após correção TLS |
| Série horária por estação | `https://apitempo.inmet.gov.br/estacao/2026-10-22/2026-10-23/A636` | HTTP 204 sem corpo nesta rede; não foi usada para completar artificialmente o dia |

O [serviço de estações automáticas do INMET](https://portal.inmet.gov.br/servicos/esta%C3%A7%C3%B5es-autom%C3%A1ticas) informa coleta horária. O [glossário oficial](https://portal.inmet.gov.br/glossario/dire%C3%A7%C3%A3o-do-vento-horaria) define os extremos da hora anterior. As [orientações oficiais de acesso](https://portal.inmet.gov.br/noticias/saiba-como-acessar-os-dados-meteorol%25C3%25B3gicos-dispon%25C3%25ADveis-no-site-do-inmet) esclarecem UTC, sentinelas `9999`/`null`/vazio e caráter bruto das observações.

## Estações e leituras reais

Distâncias calculadas entre as coordenadas municipais configuradas e as coordenadas das estações, em linha reta. Todas as estações abaixo constavam como automáticas operantes no catálogo, exceto a estação local de Aracaju mencionada após a tabela. A medição retornada foi 23/10/2026 18:00 UTC (15:00 em Brasília; 14:00 em Manaus). `T` e `U` são extremos **da hora da medição**, não extremos definitivos do dia. A auditoria isolada obteve 1 leitura válida de 15 horas esperadas, ou 1/14 em Manaus.

| Base | Estação retornada | UF | Distância | T mín./máx. °C | U mín./máx. % | Uso local |
| --- | --- | --- | ---: | ---: | ---: | --- |
| Rio de Janeiro | A636 Jacarepaguá | RJ | 23,8 km | 24,3 / 26,2 | 77 / 83 | Aceita |
| Macaé | A608 Macaé | RJ | 18,8 km | 23,7 / 24,0 | 86 / 89 | Aceita |
| Brasília | A001 Brasília | DF | 4,6 km | 29,3 / 30,6 | 34 / 39 | Aceita |
| Manaus | A101 Manaus | AM | 4,9 km | 27,7 / 29,2 | 71 / 77 | Aceita |
| Santos | A765 Bertioga | SP | 21,8 km | 23,8 / 24,9 | 89 / 98 | Aceita |
| Aracaju | A472 Acajutiba | BA | 131,2 km | — | — | Rejeitada para temperatura/umidade |
| Natal | A304 Natal | RN | 4,7 km | 28,2 / 30,0 | 67 / 74 | Aceita |
| Oiapoque | A242 Oiapoque | AP | 9,0 km | 34,1 / 34,9 | 57 / 63 | Aceita |
| Vitória | A612 Vitória | ES | 6,4 km | 24,7 / 25,6 | 90 / 94 | Aceita |
| Araucária | A807 Curitiba | PR | 23,3 km | 22,1 / 22,6 | 67 / 72 | Aceita |
| Salvador | A456 Salvador-Radio Farol | BA | 18,8 km | 31,4 / 32,7 | 58 / 64 | Aceita |

O payload bruto de A472 continha temperatura 30,4/32,8 °C e umidade 54/59%, mas esses números não são apresentados como observação de Aracaju. A estação A409 Aracaju consta no catálogo como **Pane**. O relatório real de Aracaju mostrou os quatro indicadores observados indisponíveis e conservou a previsão municipal oficial INMET de 25/31 °C na tabela de previsão.

Rio: A627 Niterói (8,5 km) e A652 Forte de Copacabana (9,2 km) ficam mais perto do centro municipal cadastrado que A636 (23,8 km). O cadastro não contém as coordenadas exatas da instalação CIM, então a proximidade ao centro não justifica substituir automaticamente Jacarepaguá. Santos: A765 é a estação automática operante mais próxima do ponto municipal cadastrado entre as alternativas retornadas; o vínculo foi mantido.

## Validação

- `npm test`: **417 testes aprovados, 0 falhas**. Inclui virada do dia em UTC/local, cobertura parcial, valores inválidos, troca de estação, rejeição de estação distante, D+1 a D+3 e a distinção entre observação no site/PDF e previsão no e-mail.
- Relatório real do Rio: A636, observados 24,3/26,7 °C e 73/83% no histórico operacional; o painel e o HTML do PDF usam esses valores. A previsão oficial INMET do dia foi 20/25 °C e 70/100%; o corpo do e-mail exibiu exatamente essa previsão. As prévias estão em `tmp/inmet-preview-email-previsao.html` e `tmp/inmet-preview-pdf.html`.
- Relatório real de Aracaju: temperatura e umidade observadas `null`; fonte por campo `Informação indisponível`; a previsão municipal INMET permaneceu separada em 25/31 °C. Prévia em `tmp/inmet-aracaju-email.html` e `tmp/inmet-aracaju-pdf.html`.
- A geração do arquivo PDF binário foi tentada com Chrome e Edge, mas o Chromium local não iniciou antes do timeout de 30/45 s. O HTML do PDF foi gerado e testado. Essa limitação de execução não altera o template.
- `NPAB2542` não resolve em DNS a partir deste ambiente (`O nome DNS não existe`); a operação nesse servidor não pôde ser verificada daqui.

## Pendências externas

- A rota pública de série horária testada respondeu HTTP 204 sem corpo. Até que o INMET disponibilize uma série completa acessível ou o coletor acumule as 24 leituras, os extremos observados devem continuar marcados como parciais.
- Aracaju requer o retorno da estação A409 ou outra estação automática representativa, validada com coordenadas da instalação. A previsão municipal oficial continua disponível, identificada como previsão.
- A exportação binária do PDF precisa ser repetida em um ambiente onde o Chromium consiga iniciar.
