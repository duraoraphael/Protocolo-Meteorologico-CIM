# Integração OCEANOP / Petrobras

A integração usa exclusivamente o contrato por lista de pontos informado pela
Petrobras. Ela permanece desativada até que o CIM receba e homologue a lista de
pontos autorizados, unidades, fuso, autenticação e limites de uso. O ponto P-68
mostrado na documentação é apenas exemplo e não está cadastrado no sistema.

## Serviço

- endpoint: `POST https://oceanop-api-disp.petrobras.com.br/api/v1/previsao/JsonPrevisaoPorListaDePontosLatLonAsync`;
- corpo: lista JSON de objetos com exatamente `ID`, `Lat` e `Lon`;
- rota interna `GET /api/oceanop/areas`: lista as bases CIM e informa quais têm
  ponto autorizado habilitado;
- rota interna `GET /api/oceanop/previsao?cidade=<chave>`: consulta somente o
  ponto previamente cadastrado daquela base; o navegador não escolhe ID nem
  coordenadas arbitrárias;
- timeout de 15 segundos, retentativas limitadas, cache de 5 minutos e
  deduplicação de chamadas simultâneas;
- chamadas somente no backend, sem desativar validação TLS.

## Cadastro seguro

Cadastre em `src/config/oceanopAreas.js` somente pontos confirmados. Cada chave
deve existir em `src/config/cities.js` e conter `habilitado: true`, `ID`,
`latitude`, `longitude`, referência operacional, `fusoHorario` e as unidades
homologadas. O arquivo contém o formato completo e está vazio por segurança.

Se a Petrobras confirmar o uso do cabeçalho HTTP padrão `Authorization`, o
valor pode ser fornecido por `OCEANOP_AUTHORIZATION`. Nenhum esquema de
autenticação é presumido e segredos nunca devem ser salvos no repositório.

## Normalização e procedência

Cada registro é associado ao pedido por `PointID`. Decimais com vírgula viram
números; zeros continuam zeros; vazios e valores fora da faixa ficam `null`.
`DataInicial`, `DataFinal` e `DataEscrita` são preservadas como recebidas e só
viram instantes ISO quando o fuso do ponto está confirmado. A grafia original
`Confiabilidaae` é mantida. Códigos de condição desconhecidos não recebem uma
tradução inventada.

Altura de onda não é confundida com altura máxima; período não é confundido
com período de pico; onda e ondulação permanecem separados. Esses valores só
entram no informativo quando suas unidades estão confirmadas. Vento é opt-in e
exige unidade, definição e altura de medição homologadas; ele apenas completa
campos ausentes e não substitui INMET/Open-Meteo já válidos.

Para bases costeiras, o OCEANOP é prioritário quando o ponto está habilitado e
os dados vigentes passam por todas as validações. Caso contrário, o sistema usa
o Open-Meteo Marine como fallback identificado. As demais fontes e o layout de
seis colunas do informativo permanecem preservados.

## Validação

Em 19/10/2026, a conexão real foi tentada dentro e fora do sandbox e falhou na
resolução DNS do host (`ENOTFOUND` / HTTP `000`). Isso pode indicar dependência
de DNS ou VPN corporativa, mas não permite concluir qual autenticação é exigida.
A integração não deve ser declarada operacional antes de um teste real com um
ponto autorizado.

Testes locais:

```text
node --test tests/oceanop.test.js
npm test
```

Os testes cobrem o POST multiponto, associação por `PointID`, vírgula decimal,
zeros, ausências, faixas, ordenação, cache, concorrência, expiração, HTTP 403 e
falha de DNS. Eles validam o adaptador, não substituem a homologação real.
