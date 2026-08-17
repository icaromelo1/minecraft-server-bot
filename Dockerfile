# --- Stage 1: Build ---
FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json tsconfig.json ./
RUN npm ci

COPY src ./src
RUN npm run build

# --- Stage 2: Production ---
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --only=production

COPY --from=builder /app/dist ./dist

# Nenhuma porta precisa ser exposta pois o bot só faz conexões de saída (Discord API e RCON)
CMD ["node", "dist/bot.js"]
