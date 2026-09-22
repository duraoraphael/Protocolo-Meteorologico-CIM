# Imagem oficial do Puppeteer: já vem com todas as bibliotecas de sistema
# necessárias para o Chrome headless rodar (evita o erro clássico "missing
# shared libraries" ao usar Puppeteer em containers genéricos do Node).
# O `npm ci` abaixo baixa o Chromium na versão exata que o puppeteer do
# package.json espera — não pulamos o download para não arriscar
# incompatibilidade com a versão de Chrome já embutida na imagem base.
FROM ghcr.io/puppeteer/puppeteer:23.11.1

# A imagem já roda como usuário não-root "pptruser" com HOME em /home/pptruser.
WORKDIR /home/pptruser/app

COPY --chown=pptruser:pptruser package*.json ./
RUN npm ci --omit=dev

COPY --chown=pptruser:pptruser . .

ENV NODE_ENV=production
EXPOSE 3210

CMD ["node", "server.js"]
