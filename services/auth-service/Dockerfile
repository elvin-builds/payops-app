# ════════════════════════════════════════════════════════════
# AUTH SERVICE — Production Dockerfile
# Multi-stage build: build stage + runtime stage
# ════════════════════════════════════════════════════════════

# ─── Stage 1: Build ────────────────────────────────────────
# Bu stage-də npm install olur, dev dependency-lər burada qalır
# Final image-ə keçmir — image size azalır
FROM node:20-alpine AS builder

WORKDIR /app

# Əvvəl yalnız package fayllarını kopyala
# Docker layer cache: package.json dəyişməsə npm install yenidən işləmir
COPY package*.json ./

# --omit=dev: devDependencies install olunmur (jest, eslint vs.)
# ci: package-lock.json-a uyğun exact versiyaları install edir (reproducible builds)
RUN npm ci --omit=dev

# ─── Stage 2: Runtime ─────────────────────────────────────
# Alpine: minimal Linux (~5MB), attack surface kiçik
FROM node:20-alpine

# Security: non-root user
# Container root kimi işləməməlidir — exploit olsa host-a çıxa bilməz
# node:20-alpine-də artıq "node" user var (uid 1000)
USER node

WORKDIR /app

# Builder stage-dən yalnız lazım olanı kopyala
# --chown=node:node: faylların sahibi node user olur (root deyil)
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node . .

# Metadata: image-in nə olduğunu göstərir
LABEL maintainer="elvin.keramidas@gmail.com"
LABEL service="auth-service"
LABEL project="payops"

EXPOSE 8081

# Healthcheck: Kubernetes probe-ları da var, amma Docker-in öz healthcheck-i
# docker ps zamanı container-in sağlam olub-olmadığını göstərir
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:8081/health').then(r=>{if(!r.ok)throw 1}).catch(()=>process.exit(1))"

# NODE_ENV=production: Express performance optimizations aktivləşir
# npm start yox, birbaşa node: PID 1 problemi olmur, SIGTERM düzgün işləyir
ENV NODE_ENV=production
CMD ["node", "src/index.js"]
