# ADR 0001: Persistence boundaries

- **Status:** accepted (task 8)
- **Context:** business code should not be welded to one database or ORM, but a payments system also *relies* on
  database guarantees, so "swap the database freely" would be a claim we cannot honestly make.

## Decision

1. **Ports in the application layer.** Use cases depend on abstract repository classes (`CompanyRepository`,
   `UserRepository`, `AccountRepository`, and later the payment ones). Only `infrastructure/` implements them with TypeORM.
2. **`DatabaseModule` is the composition root.** It is the one place allowed to know the driver and the connection details.
3. **Two levels of strictness**, chosen per module:
   - **Onboarding (`Company`, `User`): decorated entities.** The class is both the domain object and the ORM entity.
     Cheap, and these classes are thin.
   - **Payments (`Payment`): pure domain class + separate persistence model + mapper.** The payment state machine is the
     heart of the system and must be testable with no framework, and it should survive a change of ORM untouched.
4. **The rule is enforced by a test**, not by discipline (`src/architecture.spec.ts`): no file under `application/` may import
   `typeorm`, `pg` or `@nestjs/typeorm`, and `payments/**/domain/` may not either. The test is itself tested against sample
   violations, and was mutation-checked by adding a forbidden import.

## Consequences

- Swapping the database means rewriting `infrastructure/` and `DatabaseModule`. For onboarding it also means rewriting the
  two entity classes; for payments it does not touch the domain.
- Postgres-specific guarantees that the payment design depends on are **part of the port contracts**, not hidden in the adapter:
  one open payment per company (partial unique index), atomic status change + outbox message, optimistic locking,
  `ON CONFLICT` de-duplication of webhooks. Any future adapter must provide them and pass the same contract tests.
- A different *kind* of store (e.g. MongoDB) is **not** a drop-in replacement: it lacks partial unique indexes, and multi-document
  transactions need extra infrastructure. MSSQL through TypeORM is feasible with rewritten migrations.
- Cost of option B for payments: roughly 30% more persistence code (the mapper). Accepted for the one module where it pays off.

## Alternatives considered

- **Decorated entities everywhere:** least code, but the payment state machine would import the ORM.
- **Pure domain + mappers everywhere:** purest, but mapper code for thin entities that never change shape is pure overhead.
- **A config switch (`DATABASE_TYPE=postgres|mssql|mongo`):** looks flexible, but only Postgres would ever be tested,
  so the other options would be unverified promises.
