# Integração OCEANOP / Petrobras — rajada prevista

A rajada prevista de cada base vem do OCEANOP. A Open-Meteo continua como
contingência (por período e no total) quando o OCEANOP falha ou não cobre a base.

## Padrão por base (`src/config/oceanopPontos.js`)

A API só responde para coordenadas **exatamente** cadastradas (arredondar a
latitude/longitude zera o retorno); o `ID` enviado é livre e volta como `PointID`.

| Base | Modo | Consulta |
|---|---|---|
| Rio de Janeiro, Santos, Aracaju, Oiapoque, Vitória, Salvador | `coordenadas` | `POST JsonPrevisaoPorListaDePontosLatLonAsync` |
| Macaé, Natal, Brasília, Wenceslau Bráz (chave `araucaria`) | `area` | `GET JsonPrevisaoAreaAsync?local=` (locais aceitos filtrados na resposta) |
| Manaus | `ausente` | sem ponto no OCEANOP; usa só a Open-Meteo |

Verificado em 26/10/2026 (`node --use-system-ca scripts/testarOceanop.js todas`):
10 das 11 bases retornam ~108–216 registros horários, cobrindo ~9 dias. O Rio
retorna dois locais por hora ("Rio de Janeiro" e "Santos Dumont (SBRJ)"); usa-se
a maior rajada.

## Contrato e segurança

- credenciais só no backend: `OCEANOP_API_KEY` (`X-API-Key`), `OCEANOP_ACCESS_TOKEN`
  (Bearer) ou `OCEANOP_USUARIO`/`OCEANOP_SENHA` (HTTP Basic, só se os anteriores
  estiverem vazios);
- timeout de 15 s, retentativas só para falhas transitórias, cache de 5 min,
  deduplicação de chamadas simultâneas, TLS validado, redirecionamento recusado;
- resposta aceita com HTTP 2xx, `success: true` e `data` em array. No modo
  coordenadas o `PointID` deve ser igual ao `ID` enviado; `data` vazio = "sem
  cobertura" (`OCEANOP_NO_COVERAGE`). No modo área só os locais aceitos entram.

## Uso da rajada

Campo `VelocidadeVento_10M_Rajada`, convertido para km/h. Janela por edição:
08h → 08h–15h; 15h → 15h–00h (horário local da base). A maior rajada da janela é
usada por período (manhã/tarde/noite) e no total; os 3 dias seguintes recebem a
máxima diária. Sem dado válido, nada é inventado: cai na Open-Meteo.

## Unidade e fuso (validados contra a Open-Meteo, hora a hora)

- **Unidade: nós** (`OCEANOP_UNIDADE_VENTO`). Como nós, a diferença média para a
  Open-Meteo é de 3–6 km/h; como m/s seria ~20 km/h. Coerente com os "20 nós" do site.
- **Fuso das datas: UTC** (`OCEANOP_FUSO_DADOS`). Em Santos, Vitória e Oiapoque a
  melhor aderência foi com deslocamento 0 h (Santos: 2,7 km/h em UTC contra
  5,9 km/h em horário local); Rio e Salvador não discriminam. É inferência forte,
  mas deve ser confirmada pela equipe OCEANOP.
- **Atualização:** o modelo parece gerar uma corrida por dia (~06h, `DataEscrita`).

## Pendências com a equipe OCEANOP

1. Confirmar formalmente unidade (nós) e fuso (UTC) dos campos.
2. Pontos/áreas de **Manaus** (nome de área ou coordenada exata).
3. Credencial de serviço para uso contínuo (hoje funciona com usuário/senha).
