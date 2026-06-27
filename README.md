# PayOps Platform

Production-like FinTech transaction platform built to demonstrate end-to-end DevOps engineering practices.

## Architecture

```
User → Frontend (React) → API Gateway → Auth Service
                                       → Transaction Service → RabbitMQ → Worker Service
                                                                        → Notification Service
                          All services → PostgreSQL
                          API Gateway  → Redis (rate limiting)
```

## Services

| Service | Port | Description |
|---------|------|-------------|
| Frontend | 3000 | React SPA — login, dashboard, transactions |
| API Gateway | 8080 | Routing, rate limiting, JWT validation |
| Auth Service | 8081 | Register, login, JWT tokens |
| Transaction Service | 8082 | Create and query transactions |
| Worker Service | 8084 (health) | Process transactions from queue |
| Notification Service | 8083 | Event-driven notifications |
| PostgreSQL | 5432 | Primary database |
| Redis | 6379 | Cache and rate limiting |
| RabbitMQ | 5672 / 15672 (UI) | Message broker |

## Quick Start

```bash
# Clone the repo
git clone <repo-url>
cd payops-app

# Start everything
docker-compose up --build

# Open in browser
# Frontend:     http://localhost:3000
# RabbitMQ UI:  http://localhost:15672  (payops / payops123)
```

## Test Account

```
Email:    test@payops.local
Password: test123
```

## Transaction Flow

1. User logs in → receives JWT token
2. User creates transaction → Transaction Service writes to DB (status: pending)
3. Transaction Service publishes to RabbitMQ `transaction.process` queue
4. Worker consumes message → validates balance → deducts amount → updates status to `completed`
5. Worker publishes to `transaction.completed` queue
6. Notification Service consumes → writes notification to DB
7. Frontend polls every 5s → user sees updated status and notification

## Development

Each service can be developed independently:

```bash
cd services/auth-service
npm install
npm run dev
```

## API Endpoints

```
POST /api/auth/register     { email, password }
POST /api/auth/login        { email, password }
GET  /api/auth/me           [auth required]
POST /api/transactions      { amount, recipient, description }  [auth required]
GET  /api/transactions      [auth required]
GET  /api/transactions/:id  [auth required]
GET  /api/notifications     [auth required]
GET  /health                (each service)
```

## Environment Variables

See `.env.example` for all configuration options.

## Project Status

- [x] Phase 1: Architecture Design
- [x] Phase 2: Local Development (Docker Compose)
- [x] Phase 3: Production Dockerfiles (multi-stage)
- [x] Phase 4: CI Pipeline (GitHub Actions — lint, test, build, push to ACR)
- [x] Phase 5: Azure Infrastructure (Terraform — AKS, ACR, PostgreSQL, KeyVault, VNet)
- [x] Phase 6: Kubernetes Deployment (manual manifests)
- [x] Phase 7: Helm Chart
- [x] Phase 8: Ingress Controller (NGINX)
- [ ] Phase 9: CD Pipeline (auto-deploy to AKS)
- [ ] Phase 10: Monitoring (Prometheus/Grafana)
- [ ] Phase 11: GitOps (Argo CD)
- [ ] Phase 12: Secrets Management (Azure Key Vault CSI)
