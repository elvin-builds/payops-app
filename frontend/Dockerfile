# ════════════════════════════════════════════════════════════
# FRONTEND — Production Dockerfile
# 3 stage: deps → build → nginx
#
# Dev-dən fərq:
#   Dev: Vite dev server (hot reload, source maps, 300MB+ image)
#   Prod: NGINX statik faylları serve edir (~25MB image)
# ════════════════════════════════════════════════════════════

# ─── Stage 1: Dependencies ─────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

# ─── Stage 2: Build ────────────────────────────────────────
# Vite source faylları (JSX, CSS) → optimized static bundle (JS, CSS, HTML)
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build
# İndi /app/dist/ içində production-ready statik fayllar var

# ─── Stage 3: Runtime ──────────────────────────────────────
# NGINX: professional web server, statik fayllar üçün ideal
# Node.js yoxdur, npm yoxdur — yalnız nginx + HTML/JS/CSS
FROM nginx:1.25-alpine

# Custom NGINX config: SPA routing + API proxy
COPY --from=builder /app/dist /usr/share/nginx/html

# NGINX config for SPA + API proxy
RUN printf 'server {\n\
    listen 3000;\n\
    server_name _;\n\
    root /usr/share/nginx/html;\n\
    index index.html;\n\
\n\
    gzip on;\n\
    gzip_types text/plain text/css application/json application/javascript text/xml;\n\
\n\
    location /assets/ {\n\
        expires 1y;\n\
        add_header Cache-Control "public, immutable";\n\
    }\n\
\n\
    location / {\n\
        try_files $uri $uri/ /index.html;\n\
    }\n\
\n\
    location /api/ {\n\
        proxy_pass http://api-gateway:8080;\n\
        proxy_set_header Host $host;\n\
        proxy_set_header X-Real-IP $remote_addr;\n\
    }\n\
\n\
    location /health {\n\
        access_log off;\n\
        return 200 '"'"'{"status":"healthy","service":"frontend"}'"'"';\n\
        add_header Content-Type application/json;\n\
    }\n\
}\n' > /etc/nginx/conf.d/default.conf

LABEL maintainer="elvin.keramidas@gmail.com"
LABEL service="frontend"
LABEL project="payops"

EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --retries=3 \
  CMD wget -q --spider http://localhost:3000/health || exit 1
