# ════════════════════════════════════════════════════════════
# WORKER SERVICE — Production Dockerfile
# HTTP server yoxdur, yalnız queue consumer
# Health check üçün minimal Express (port 8084)
# ════════════════════════════════════════════════════════════

FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

FROM node:20-alpine
USER node
WORKDIR /app
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node . .

LABEL maintainer="elvin.keramidas@gmail.com"
LABEL service="worker-service"
LABEL project="payops"

EXPOSE 8084

HEALTHCHECK --interval=15s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://localhost:8084/health').then(r=>{if(!r.ok)throw 1}).catch(()=>process.exit(1))"

ENV NODE_ENV=production
CMD ["node", "src/index.js"]
