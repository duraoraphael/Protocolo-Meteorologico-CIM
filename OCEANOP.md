# Integração OCEANOP / Petrobras

## Contrato adotado

O fluxo ativo utiliza o endpoint documentado no Swagger corporativo:

- `POST https://oceanop-api-disp.petrobras.com.br/api/v1/previsao/JsonPrevisaoPorListaDePontosLatLonAsync`;
- corpo: `[{ "ID": "chave_da_base", "Lat": -00.0, "Lon": -00.0 }]`;
- timeout de 15 segundos, retentativas apenas para falhas transitórias, cache de
  5 minutos e deduplicação de chamadas simultâneas;
- credenciais opcionais lidas somente no backend: `OCEANOP_API_KEY`, enviada em
  `X-API-Key`, e `OCEANOP_ACCESS_TOKEN`, enviado como Bearer;
- TLS permanece validado. Não há desativação de certificado nem tentativa de
  contornar autenticação.

A resposta só é aceita com HTTP 2xx, `success: true`, `data` como array não
vazio, registros estruturalmente válidos e `Local` correspondente ao `ID`
solicitado após normalização textual. Resposta de outra base é descartada antes
do cache e não chega ao painel, PDF ou e-mail.

O endpoint legado `GET /api/v1/previsao/JsonPrevisaoAreaAsync?local=...` continua
no adaptador exclusivamente por compatibilidade. O relatório operacional usa o
endpoint por coordenadas.

## Cobertura das bases

`src/config/oceanopPontos.js` deriva um ponto individual das coordenadas oficiais
de cada entrada de `src/config/cities.js`. Assim, todas as 11 bases atuais são
consultáveis sem reutilizar o retorno de outra localidade: Rio de Janeiro,
Macaé, Brasília, Manaus, Santos, Aracaju, Natal, Oiapoque, Vitória, Araucária e
Salvador.

Brasília é tratada como ponto terrestre: vento pode ser usado, mas produto
marítimo permanece desabilitado. A mesma proteção vale para todas as bases não
costeiras.

## Unidade, fuso e uso operacional

O adaptador aceita velocidade declarada em `km/h`, `m/s` ou `nós` e centraliza
a conversão para km/h (`m/s × 3,6`; `nós × 1,852`). O cadastro atual declara os
campos OCEANOP de vento e rajada em km/h, conforme o contrato previamente
homologado do produto por área; a confirmação final do payload do endpoint por
coordenadas ainda depende de acesso autorizado.

Datas são interpretadas apenas quando há fuso IANA cadastrado. Para a edição das
05h, a janela é 05h–15h; para a edição das 15h, 15h–00h. A maior rajada válida
da janela é usada com fonte, local e horário preservados. Os três dias seguintes
recebem a máxima diária quando houver registro válido.

Ondas, período e demais variáveis marítimas permanecem desabilitados até que
unidades, cobertura geográfica e payload real sejam validados formalmente.
Campos sem fonte autorizada aparecem como `Informação indisponível`, sem valor
inventado nem mistura entre bases.

## Validação real em 22/10/2026

- DNS corporativo, TCP/443 e TLS: disponíveis;
- Swagger: HTTP 200;
- contrato `PontoLatLonDTO` (`ID`, `Lat`, `Lon`): confirmado no Swagger;
- `POST` real para Brasília, com suas coordenadas exatas: HTTP 401;
- endpoint legado consultado para sete áreas: HTTP 401;
- resposta autenticada com `success: true`: não obtida.

Conclusão: o adaptador, o isolamento por base, o cache e a normalização estão
implementados e testados. A ativação produtiva dos dados OCEANOP depende do
fornecimento das credenciais/permissões oficiais e de homologação com payload
real. Até lá, o sistema falha de forma segura e mantém a origem indisponível.
