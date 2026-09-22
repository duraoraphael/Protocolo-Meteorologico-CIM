# Windy — configuração restaurada

A integração usa somente a variável original `WINDY_API_KEY` no backend. O valor existente no .env foi preservado. As variáveis de chave separadas foram removidas.

```dotenv
WINDY_API_KEY=
```

Após salvar o .env, reinicie o servidor com Ctrl+C e npm start.

O mapa Windy foi desativado e removido do menu. O endpoint /api/windy/map-config permanece apenas para informar a desativação a links antigos, sem divulgar credenciais.

O Point continua integrado ao /api/preview, com cache, normalização e fallback Open-Meteo/INMET. Modelos padrão: gfs, gfsWave e cams. As opções de modelos existentes continuam aceitas.

A proteção contra dados de teste embaralhados continua ativa. Voltar ao nome antigo da variável não muda o plano da chave no Windy.

Validação: node --test tests/windy.test.js tests/oceanop.test.js
