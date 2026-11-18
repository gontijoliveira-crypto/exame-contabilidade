# Imagem para publicar a Calculadora CBS e IBS (Railway, Render, Fly.io ou qualquer servidor com Docker).
# O projeto não tem dependências externas: basta o Node.js.
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json ./
COPY config ./config
COPY public ./public
COPY src ./src
USER node
EXPOSE 3000
CMD ["node", "src/index.js"]
