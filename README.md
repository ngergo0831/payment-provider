# Payment Service

> **As a company admin, I need to sign up, register my business, and pay for my plan so that my account is activated
> immediately on success and recovers safely from payment failures or delayed confirmations.**

A focused slice of a self-serve B2B onboarding flow, going deep on one integration: **Stripe payments**.

**Status:** work in progress, built one small task per commit. See [docs/EXECUTION-PLAN.md](docs/EXECUTION-PLAN.md) for the
task list and current progress.

## Planned stack

NestJS · PostgreSQL · TypeORM (migrations) · JWT · Stripe (PaymentIntents, with a mock provider for running without keys) ·
React · Docker Compose · Swagger

## Running it

Requires Node.js 22.12 or newer. Instructions grow as each part is built.

```bash
cd backend
npm install
npm run start:dev      # API on http://localhost:3000  (try GET /health)
                       # Swagger UI: http://localhost:3000/docs   (raw OpenAPI: /docs-json)
npm test               # run the tests
npm run lint           # type-check source and tests
```

## Database

PostgreSQL runs in Docker (requires Docker Desktop). From the repository root:

```bash
docker compose up -d     # start; first run downloads the image
docker compose ps        # STATUS shows "(healthy)" once it accepts connections (about 10 s)
docker compose down      # stop; data is KEPT in the named volume
docker compose down -v   # stop AND delete all data (fresh database next time)
```

Defaults for development: user `payments`, password `payments`, database `payments`, on `127.0.0.1:5432` (this machine only,
not the network). To change them, copy `.env.example` to `.env` next to `docker-compose.yml` **before the first start**:
the user, password and database are applied only when the volume is first created.

## Configuration

Settings come from environment variables, validated at startup (`backend/src/config/`). If anything is invalid the app
prints every problem and exits instead of starting half-configured.

```bash
cd backend
cp .env.example .env   # optional: all settings have defaults
```

Real environment variables override values in `.env`. Each setting is documented in `backend/.env.example`.

## Error format

Every failing request returns the same JSON shape. Clients branch on `code`, never on `message`.

```json
{
  "statusCode": 422,
  "code": "VALIDATION_FAILED",
  "message": "Request validation failed",
  "details": [{ "field": "email", "messages": ["email must be an email"] }],
  "requestId": "b3f1c5a2-0c52-4a35-9f43-1d4b2c3a9a10",
  "timestamp": "2026-11-09T12:00:00.000Z"
}
```

`details` appears for validation errors only. `requestId` is also returned in the `x-request-id` header and appears in the
server logs; send your own `x-request-id` to correlate across systems. Unexpected errors always return a generic 500: the
real cause is logged server-side and never sent to the client.

## Repository contents

| Path | Purpose |
|---|---|
| `assignment.txt` | The original take-home assignment |
| `docs/EXECUTION-PLAN.md` | Step-by-step build plan, one task per commit |
| `backend/` | NestJS API |
