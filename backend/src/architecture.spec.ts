import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/**
 * ARCHITECTURE RULE, enforced by the build instead of by good intentions:
 * application and payments-domain code must not import the database or token libraries.
 * They depend on PORTS (abstract classes); only `infrastructure/` knows TypeORM / pg.
 *
 * Exceptions, deliberate and listed here so they are visible in review:
 *  - onboarding/domain: Company and User are decorated entities (the pragmatic choice for thin entities).
 *  - payments/domain is NOT excepted: Payment is a pure domain class with a separate persistence model.
 */
const FORBIDDEN_IMPORT =
  /from\s+['"](typeorm|pg|@nestjs\/typeorm|@nestjs\/jwt|@nestjs\/passport|passport|passport-jwt|jsonwebtoken)['"]/;

const RULES: { name: string; applies: (path: string) => boolean }[] = [
  { name: 'application layers must not import database or token libraries', applies: (p) => p.includes(`${sep}application${sep}`) },
  { name: 'payments domain must stay pure', applies: (p) => p.startsWith(`payments${sep}`) && p.includes(`${sep}domain${sep}`) },
];

export function findForbiddenImports(source: string): string[] {
  return source.split('\n').filter((line) => FORBIDDEN_IMPORT.test(line));
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts') ? [path] : [];
  });
}

describe('architecture: dependency rules', () => {
  const root = join(process.cwd(), 'src');
  const files = sourceFiles(root).map((absolute) => ({ path: relative(root, absolute), absolute }));

  it('finds the source files (guards against the rules silently checking nothing)', () => {
    expect(files.length).toBeGreaterThan(10);
    expect(files.some((f) => f.path.includes(`onboarding${sep}application`))).toBe(true);
  });

  it.each(RULES)('$name', ({ applies }) => {
    const violations = files
      .filter((f) => applies(f.path))
      .flatMap((f) => findForbiddenImports(readFileSync(f.absolute, 'utf8')).map((line) => `${f.path}: ${line.trim()}`));

    expect(violations).toEqual([]);
  });

  describe('the detector itself', () => {
    it.each([
      `import { Repository } from 'typeorm';`,
      `import { Client } from "pg";`,
      `import { InjectRepository } from '@nestjs/typeorm';`,
      `import { JwtService } from '@nestjs/jwt';`,
      `import jwt from 'jsonwebtoken';`,
      `import { Strategy } from 'passport-jwt';`,
    ])('flags: %s', (line) => {
      expect(findForbiddenImports(`import a from 'a';\n${line}\n`)).toEqual([line]);
    });

    it('does not flag look-alikes or unrelated imports', () => {
      expect(findForbiddenImports(`import x from 'typeorm-extension-nope';\nimport { Logger } from '@nestjs/common';`)).toEqual([]);
    });
  });
});
