# Consulta Oceanop por local

Acesse **Áreas Oceanop** no dashboard ou `/areas.html`.
Selecione uma das bases do projeto e informe o identificador **Local Oceanop**.
A documentação corrigida usa `sururu` como exemplo. Não são enviados tipo de
previsão nem polígono, e não há seleção de plataforma neste contrato.

## Serviço

- Origem: `https://oceanop-api-disp.petrobras.com.br/api/v1/previsao/JsonPrevisaoAreaAsync?local=sururu`.
- GET `/api/oceanop/areas`: bases existentes e seus vínculos confirmados.
- GET `/api/oceanop/previsao?local=...`: consulta pelo servidor, timeout de 15 segundos.
- Credenciais, dependências e `.env` não foram alterados.
- Reinicie o servidor após atualizar: `Ctrl+C`, depois `npm start`.

## Vínculos

Cadastre em `src/config/oceanopAreas.js` somente identificadores confirmados:
chave da base existente em `cities.js` associada a `{ local: 'identificador-confirmado' }`.
O formulário também aceita o local manualmente, sem salvar vínculos.
A documentação não informa o catálogo de locais ou a cobertura das bases terrestres.
Não há associação automática entre nome de município e identificador Oceanop.

## Dados

`DataInicial`, `DataFinal` e `DataEscrita` são preservadas como fornecidas: o fuso
não foi especificado. Decimais com vírgula viram números; vazios ficam `null` e
aparecem como `—`, nunca como zero. Rajada usa `VelocidadeVento_10M_Rajada`.
Os parâmetros adicionais incluem vento em outras alturas, ondas, ondulação,
nuvens, pressão, visibilidade, trovão e condição do clima. A grafia
`Confiabilidaae` é mantida conforme o contrato. `Direcao_AlturaVentoOnda` é
mostrado pelo nome original, pois sua interpretação não foi documentada.

Unidades não foram informadas; os valores não são convertidos ou usados pelo
motor de riscos. São previsões, não medições em tempo real. As fontes originais
do dashboard continuam em uso.

Latitude e longitude são apresentadas como informadas. O exemplo traz ambas
iguais a zero: isso não confirma a localização da área e não deve posicionar um
marcador automaticamente. Não há limites de polígonos para desenhar um mapa.

## Acesso e validação

O host apresentou `ENOTFOUND` nos testes: confirmar endereço e resolução DNS na
máquina do servidor. Isso não comprova exigência de VPN ou autenticação.

Execute `node --test tests/oceanop.test.js`. Exemplos do contrato são usados
somente nos testes; a interface consulta o serviço real. A validação de dados
reais depende do acesso ao serviço e dos nomes corretos de cada local.
