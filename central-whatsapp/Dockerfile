# Imagem para publicar a Central de Atendimento (Railway, Render, Fly.io ou qualquer servidor com Docker).
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY . .
# Banco de dados e sessões do WhatsApp: monte um volume persistente neste caminho.
ENV PASTA_DADOS=/dados
EXPOSE 3000
CMD ["npm", "start"]
