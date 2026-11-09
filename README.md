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

Instructions are added as each part is built.

## Repository contents

| Path | Purpose |
|---|---|
| `assignment.txt` | The original take-home assignment |
| `docs/EXECUTION-PLAN.md` | Step-by-step build plan, one task per commit |
