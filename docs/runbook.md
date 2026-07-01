# PayOps Runbook

## Start locally

```bash
make init
make up
Check running services
make ps
View logs
make logs
Validate Docker Compose configuration
make config
Rebuild containers
make build
Stop services
make down
Clean local volumes
make clean
Common issues
Environment variables are missing

Run:

make init

Then update .env values.

Database is not ready

Check PostgreSQL container health:

docker compose --env-file .env ps
docker compose --env-file .env logs postgres
RabbitMQ connection fails

Check RabbitMQ status:

docker compose --env-file .env logs rabbitmq

