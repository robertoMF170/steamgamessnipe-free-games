# SrRobs Cards — imagem de produção
# Multi-arch (amd64 + arm64) para funcionar em VPS baratos e free tiers ARM.
FROM node:20-alpine

# better-sqlite3 precisa de ferramentas de build no musl; instalamos python3/make/g++
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Instalar dependências primeiro (cache de layers)
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev

# Copiar código
COPY src ./src

# Diretórios de dados persistentes
RUN mkdir -p /app/data /app/asf-config && chown -R node:node /app

ENV NODE_ENV=production
ENV DB_PATH=/app/data/srrobs.db
ENV LOG_DIR=/app/data/logs

USER node

# Healthcheck: o bot responde HTTP em HEALTH_PORT
HEALTHCHECK --interval=60s --timeout=10s --start-period=30s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.HEALTH_PORT||3000)+'/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "src/index.js"]
