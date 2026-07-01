# PayOps Architecture

PayOps is a production-like FinTech transaction platform designed to demonstrate microservice infrastructure and DevOps delivery practices.

## Components

| Component | Responsibility |
|---|---|
| Frontend | User-facing web interface |
| API Gateway | Routes external requests to backend services |
| Auth Service | Handles authentication and JWT generation |
| Transaction Service | Creates and tracks transactions |
| Worker Service | Processes queued transactions asynchronously |
| Notification Service | Stores and exposes transaction notifications |
| PostgreSQL | Persistent relational datastore |
| Redis | Cache/session support |
| RabbitMQ | Message broker for async processing |

## Transaction Flow

1. User authenticates through the Auth Service.
2. Frontend sends transaction request to the API Gateway.
3. API Gateway routes the request to the Transaction Service.
4. Transaction Service stores the transaction in PostgreSQL.
5. Transaction Service publishes a job to RabbitMQ.
6. Worker Service consumes the job and processes the transaction.
7. Worker Service updates the transaction status.
8. Notification Service records the result.

## DevOps Focus

This project is designed to show:

- Containerized microservices
- Local orchestration with Docker Compose
- Environment-based configuration
- Healthchecks
- CI validation
- Security scanning baseline
- Future Kubernetes and Terraform deployment path
