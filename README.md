# Keystone ERP

Keystone ERP is a modular monolith designed for reliable company operations. The repository contains the Laravel API in `backend/` and the web client in `frontend/`.

## Requirements

- PHP 8.4 and Composer
- Node.js 22 and npm
- Docker Compose

## Local development

Run `dev.bat` on Windows to start PostgreSQL, Redis, Mailpit, and MinIO, then open the API, Reverb, queue, scheduler, and frontend processes in separate windows. The API is available at `http://localhost:8000`; Vite uses port 5173. Mailpit UI is at `http://localhost:8025`; MinIO console is at `http://localhost:9001`.

To start infrastructure only, run `docker compose up -d`. PostgreSQL uses database `keystone`, user `keystone`, and password `keystone`. The init script creates `keystone_test` and enables `pg_trgm` and `pgcrypto` on first initialization.

## Engineering

Read [Engineering Rules](docs/ENGINEERING-RULES.md), [Architecture](docs/ARCHITECTURE.md), and the [Roadmap](docs/ROADMAP.md). Current delivery status is tracked in [Progress](docs/PROGRESS.md); architecture decisions are recorded in `docs/adr/`.

The API base path is `/api/v1`. Successful responses use a `data` envelope and errors use an `errors` envelope. Keep generated OpenAPI schema and frontend API types in sync.
