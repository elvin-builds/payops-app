SHELL := /bin/bash

.PHONY: init up down restart logs ps config build clean

init:
	cp -n .env.example .env || true
	@echo "Created .env if it did not already exist. Update secrets before running production-like workloads."

up:
	docker compose --env-file .env up -d --build

down:
	docker compose --env-file .env down

restart: down up

logs:
	docker compose --env-file .env logs -f --tail=100

ps:
	docker compose --env-file .env ps

config:
	docker compose --env-file .env config

build:
	docker compose --env-file .env build

clean:
	docker compose --env-file .env down -v --remove-orphans
