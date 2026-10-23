# Rajadas previstas — portal Tetra Tech

## Estrutura técnica confirmada

O portal Tetra Tech é uma aplicação Angular. A página pública carrega a
interface, mas os dados meteorológicos vêm da API oficial
`https://petrobras.ttforecast.com.br/api/v1`.

O contrato OpenAPI do próprio portal confirma:

- `GET /areas/json`: lista as áreas autorizadas, incluindo `id`, `name`, `type`
  e `bulletins`;
- `GET /bulletins/{idArea}`: boletim mais recente da área;
- autenticação por `X-API-Key` ou OAuth2 Password Bearer;
- `POST /login/oauth`: emissão de `access_token` e `refresh_token`.

A aplicação usa o campo
`10_metre_wind_gust_since_previous_post_processing` para a série “Velocidade de
rajada”. O valor base do boletim é convertido pela própria interface de m/s
para nós, e o gráfico declara a unidade “nós”. O CIM reproduz essa conversão e,
em seguida, aplica exatamente `km/h = nós × 1,852`.

Não são usados seletores visuais, OCR ou leitura de pixels do gráfico.

## Credencial operacional

Use preferencialmente uma chave oficial emitida para o backend:

```env
TETRATECH_API_KEY=
```

Como alternativa, uma conta técnica OAuth oficialmente autorizada:

```env
TETRATECH_USERNAME=
TETRATECH_PASSWORD=
```

Um token temporário pode ser usado apenas para diagnóstico autorizado:

```env
TETRATECH_ACCESS_TOKEN=
```

Credenciais não são gravadas no código, cache persistente ou logs. Login SAML
de usuário não é automatizado; para produção, solicite chave ou conta técnica.

Cada consulta bem-sucedida armazena localmente o horizonte completo do boletim
em `data/tetratech-gust-cache.json` (arquivo ignorado pelo Git). Se o token
expirar, o CIM continua usando somente os dias futuros ainda presentes nesse
último boletim válido e marca a fonte como degradada/dado armazenado. Uma data
expirada nunca é reaproveitada em outro dia. Quando o horizonte terminar, a
fonte volta a ficar indisponível até uma nova autenticação e coleta.

## Regra do pico diário

Todos os horários válidos são agrupados pela data civil da cidade. Manaus usa
`America/Manaus`; as demais usam `America/Sao_Paulo`. Para cada data, vence a
maior rajada. Em empate, é preservado o primeiro horário do pico. O resultado
mantém valor em nós, valor bruto da API, horário, área, consulta e atualização.

O pico diário alimenta D+1–D+3. Site, e-mail e PDF usam o maior valor comprovado
dentro da janela da edição (08h–15h ou 15h–00h); as linhas por período recebem
somente os valores cujos horários pertencem à manhã, tarde ou noite.

## Situação por base

| Base | Fonte/página | Situação |
|---|---|---|
| Rio de Janeiro | Tetra Tech — `Terrestre/Rio de Janeiro` | Implementada; aguarda credencial para validação real |
| Manaus | Tetra Tech — `Terrestre/Manaus` | Implementada; aguarda credencial para validação real |
| Macaé | Tetra Tech — `Terrestre/Macaé` | Implementada; aguarda credencial para validação real |
| Brasília | Tetra Tech — `Terrestre/Brasília` | Implementada; aguarda credencial para validação real |
| Santos | Tetra Tech — `Terrestre/Santos` | Implementada; aguarda credencial para validação real |
| Vitória | Tetra Tech — `Terrestre/Vitória` | Implementada; aguarda credencial para validação real |
| Salvador | Tetra Tech — `Terrestre/Salvador` | Implementada; aguarda credencial para validação real |
| Natal | Tetra Tech — `Terrestre/Natal` | Implementada; aguarda credencial para validação real |
| Oiapoque | Tetra Tech — `Terrestre/Oiapoque` | Implementada; aguarda credencial para validação real |
| Araucária | Página indicada de Wenceslau Bráz | Desabilitada; equivalência geográfica não validada |
| Aracaju | Tetra Tech — `Terrestre/Aracaju` | Implementada; aguarda credencial para validação real |

O domínio e o contrato consultados identificam o serviço como portal Tetra
Tech. A aplicação não afirma que o payload veio diretamente da API OCEANOP sem
documentação contratual que comprove essa origem.

Uma cidade somente deve ser declarada operacional após a API autorizada
retornar dados reais e o pico diário aparecer no fluxo do informativo. Até lá,
o campo permanece indisponível e a pendência é registrada.
