import { validateEnv } from './env.validation';

const DATABASE_URL = 'postgres://payments:s3cret-pw@localhost:5432/payments';
const JWT_SECRET = 'unit-test-secret-that-is-32-chars+';
const valid = { NODE_ENV: 'development', PAYMENT_PROVIDER: 'mock', DATABASE_URL, JWT_SECRET };
const stripe = {
  PAYMENT_PROVIDER: 'stripe',
  STRIPE_SECRET_KEY: 'sk_test_abc123',
  STRIPE_PUBLISHABLE_KEY: 'pk_test_abc123',
  STRIPE_WEBHOOK_SECRET: 'whsec_abc123',
};

// What each numeric setting accepts and rejects. An empty value is rejected everywhere: it must not silently become 0.
const NUMBERS: Record<string, { accepted: string[]; rejected: string[] }> = {
  PORT: { accepted: ['8080'], rejected: ['abc', '0', '70000', '30.5', ''] },
  PLAN_PRICE_MINOR: { accepted: ['5000'], rejected: ['0', '-5', '49.5', 'abc', ''] },
  RECONCILE_INTERVAL_MS: { accepted: ['0'], rejected: ['-1', '1.5', 'often', ''] }, // 0 switches the timer off
  OUTBOX_POLL_INTERVAL_MS: { accepted: ['0'], rejected: ['-1', '1.5', 'fast', ''] }, // 0 switches the timer off
  RATE_LIMIT_PER_MINUTE: { accepted: [], rejected: ['0', '-1', 'many', ''] }, // there is no "off"
};
const numberCases = (kind: 'accepted' | 'rejected') =>
  Object.entries(NUMBERS).flatMap(([name, values]) => values[kind].map((value) => [name, value]));

describe('validateEnv', () => {
  it('applies defaults for everything except the required settings', () => {
    expect(validateEnv(valid)).toMatchObject({
      DATABASE_URL,
      JWT_EXPIRES_IN: '24h',
      PORT: 3000,
      PLAN_PRICE_MINOR: 4900,
      PLAN_CURRENCY: 'USD',
      RECONCILE_INTERVAL_MS: 60000,
      OUTBOX_POLL_INTERVAL_MS: 1000,
      RATE_LIMIT_PER_MINUTE: 20,
    });
  });

  it.each(numberCases('accepted'))('converts %s=%j from a string to a number', (name, value) => {
    expect(validateEnv({ ...valid, [name]: value })).toMatchObject({ [name]: Number(value) });
  });

  it.each(numberCases('rejected'))('rejects %s=%j', (name, value) => {
    expect(() => validateEnv({ ...valid, [name]: value })).toThrow(new RegExp(name));
  });

  it('ignores unrelated variables (process.env contains hundreds)', () => {
    expect(() => validateEnv({ ...valid, PATH: '/usr/bin', HOME: '/home/x' })).not.toThrow();
  });

  it.each([
    ['PORT', 'abc'],
    ['PORT', ''],
    ['PLAN_PRICE_MINOR', 'abc'],
    ['OUTBOX_POLL_INTERVAL_MS', ''],
  ])('gives one clear message per number: %s=%j is "not an integer", not "too small/large"', (name, value) => {
    expect(() => validateEnv({ ...valid, [name]: value })).toThrow(`${name} must be an integer number`);
    expect(() => validateEnv({ ...valid, [name]: value })).not.toThrow(/greater than|less than/);
  });

  it.each(['NODE_ENV', 'PAYMENT_PROVIDER'])(
    'requires %s: a deploy that forgot it must not fall back to development or the mock',
    (name) => {
      const { [name]: _removed, ...without } = valid as Record<string, string>;
      expect(() => validateEnv(without)).toThrow(new RegExp(`${name} must be one of`));
    },
  );

  it('rejects an unknown NODE_ENV', () => {
    expect(() => validateEnv({ ...valid, NODE_ENV: 'staging' })).toThrow(/NODE_ENV/);
  });

  it('reports every problem at once, not just the first', () => {
    expect.assertions(3);
    try {
      validateEnv({ PORT: 'abc', NODE_ENV: 'staging' });
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain('PORT');
      expect(message).toContain('NODE_ENV');
      expect(message).toContain('DATABASE_URL');
    }
  });

  describe('DATABASE_URL', () => {
    it('is required', () => {
      const { DATABASE_URL: _removed, ...without } = valid;
      expect(() => validateEnv(without)).toThrow(/DATABASE_URL/);
    });

    it.each([
      ['postgres://', 'postgres://payments:pw@localhost:5432/payments'],
      ['postgresql://', 'postgresql://payments:pw@db.internal:5432/payments'],
      ['no password', 'postgres://localhost/payments'],
    ])('accepts a %s URL', (_label, url) => {
      expect(() => validateEnv({ ...valid, DATABASE_URL: url })).not.toThrow();
    });

    it.each([
      ['another database engine', 'mysql://root:pw@localhost:3306/db'],
      ['no protocol', 'localhost:5432/payments'],
      ['not a URL at all', 'banana'],
      ['empty', ''],
    ])('rejects %s', (_label, url) => {
      expect(() => validateEnv({ ...valid, DATABASE_URL: url })).toThrow(/DATABASE_URL/);
    });

    it('never puts the password in the error message', () => {
      expect.assertions(2);
      try {
        validateEnv({ ...valid, DATABASE_URL: 'mysql://root:hunter2-secret@localhost:3306/db' });
      } catch (error) {
        expect((error as Error).message).toContain('DATABASE_URL');
        expect((error as Error).message).not.toContain('hunter2-secret');
      }
    });
  });

  describe('JWT_SECRET', () => {
    it('is required', () => {
      const { JWT_SECRET: _removed, ...without } = valid;
      expect(() => validateEnv(without)).toThrow(/JWT_SECRET/);
    });

    it('must be at least 32 characters (shorter is brute-forceable)', () => {
      expect(() => validateEnv({ ...valid, JWT_SECRET: 'x'.repeat(31) })).toThrow(/JWT_SECRET/);
      expect(() => validateEnv({ ...valid, JWT_SECRET: 'x'.repeat(32) })).not.toThrow();
    });

    it('never appears in the error message', () => {
      expect.assertions(1);
      try {
        validateEnv({ ...valid, JWT_SECRET: 'short-but-secret' });
      } catch (error) {
        expect((error as Error).message).not.toContain('short-but-secret');
      }
    });
  });

  describe('the public example secret', () => {
    const exampleSecret = 'dev-only-secret-change-me-it-must-be-32+chars';

    it('is fine for development and tests', () => {
      expect(() => validateEnv({ ...valid, JWT_SECRET: exampleSecret, NODE_ENV: 'development' })).not.toThrow();
      expect(() => validateEnv({ ...valid, JWT_SECRET: exampleSecret, NODE_ENV: 'test' })).not.toThrow();
    });

    it('is REFUSED in production, because anyone who has read the repository knows it', () => {
      expect(() => validateEnv({ ...valid, ...stripe, JWT_SECRET: exampleSecret, NODE_ENV: 'production' })).toThrow(
        /public development example/,
      );
    });

    it('a real secret works in production', () => {
      expect(() => validateEnv({ ...valid, ...stripe, JWT_SECRET: 'x'.repeat(48), NODE_ENV: 'production' })).not.toThrow();
    });
  });

  describe('JWT_EXPIRES_IN', () => {
    it.each(['30s', '15m', '24h', '7d'])('accepts %s', (value) => {
      expect(validateEnv({ ...valid, JWT_EXPIRES_IN: value }).JWT_EXPIRES_IN).toBe(value);
    });

    it.each(['24', 'h', '1 h', '-5m', '1w', 'forever', ''])('rejects %j', (value) => {
      expect(() => validateEnv({ ...valid, JWT_EXPIRES_IN: value })).toThrow(/JWT_EXPIRES_IN/);
    });
  });

  describe('PAYMENT_PROVIDER', () => {
    it('accepts Stripe when all three keys are present and well-formed', () => {
      expect(validateEnv({ ...valid, ...stripe })).toMatchObject({ PAYMENT_PROVIDER: 'stripe', STRIPE_SECRET_KEY: 'sk_test_abc123' });
    });

    it.each([['paypal'], ['STRIPE'], ['']])('rejects the unknown provider %j', (name) => {
      expect(() => validateEnv({ ...valid, PAYMENT_PROVIDER: name })).toThrow(/PAYMENT_PROVIDER/);
    });

    describe('when the provider is Stripe, every Stripe setting is required and checked', () => {
      it.each(['STRIPE_SECRET_KEY', 'STRIPE_PUBLISHABLE_KEY', 'STRIPE_WEBHOOK_SECRET'])('%s is required', (name) => {
        const { [name]: _removed, ...without } = stripe as Record<string, string>;
        expect(() => validateEnv({ ...valid, ...without })).toThrow(new RegExp(name));
      });

      it.each([
        ['STRIPE_SECRET_KEY', 'pk_test_abc'], // a publishable key where the SECRET one belongs
        ['STRIPE_SECRET_KEY', 'not-a-key'],
        ['STRIPE_SECRET_KEY', 'sk_test_'],
        ['STRIPE_PUBLISHABLE_KEY', 'sk_test_abc'], // the secret key where the public one belongs: a dangerous mix-up
        ['STRIPE_WEBHOOK_SECRET', 'sk_test_abc'],
        ['STRIPE_WEBHOOK_SECRET', ''],
      ])('%s rejects %j', (name, value) => {
        expect(() => validateEnv({ ...valid, ...stripe, [name]: value })).toThrow(new RegExp(name));
      });

      it('accepts live keys too (the key itself decides test vs live)', () => {
        expect(() =>
          validateEnv({ ...valid, ...stripe, STRIPE_SECRET_KEY: 'sk_live_abc', STRIPE_PUBLISHABLE_KEY: 'pk_live_abc' }),
        ).not.toThrow();
      });

      it('never puts a key in the error message', () => {
        expect.assertions(1);
        try {
          validateEnv({ ...valid, ...stripe, STRIPE_SECRET_KEY: 'TOPSECRET-mistyped-key' });
        } catch (error) {
          expect((error as Error).message).not.toContain('TOPSECRET');
        }
      });
    });

    it('Stripe settings are NOT required for the mock (no keys needed to run the project)', () => {
      expect(() => validateEnv({ ...valid, PAYMENT_PROVIDER: 'mock' })).not.toThrow();
    });

    it('the mock is REFUSED in production: its webhook "signature" is public, so anyone could fake a payment', () => {
      expect(() => validateEnv({ ...valid, NODE_ENV: 'production', JWT_SECRET: 'x'.repeat(48) })).toThrow(
        /PAYMENT_PROVIDER=mock is not allowed/,
      );
    });

    it('reports every production problem in ONE error, so a bad deploy is fixed in one go', () => {
      const production = { ...valid, NODE_ENV: 'production', JWT_SECRET: `dev-only-${'x'.repeat(32)}`, PLAN_CURRENCY: 'BTC' };

      expect(() => validateEnv(production)).toThrow(/Unsupported currency[\s\S]*PAYMENT_PROVIDER=mock[\s\S]*JWT_SECRET is the public/);
    });
  });

  describe('the plan price', () => {
    it('accepts another supported currency, any letter case', () => {
      expect(validateEnv({ ...valid, PLAN_PRICE_MINOR: '5000', PLAN_CURRENCY: 'jpy' })).toMatchObject({ PLAN_PRICE_MINOR: 5000 });
    });

    it.each([['US'], ['USDX'], ['$$$'], ['']])('rejects a malformed PLAN_CURRENCY %j', (currency) => {
      expect(() => validateEnv({ ...valid, PLAN_CURRENCY: currency })).toThrow(/PLAN_CURRENCY/);
    });

    it('rejects a currency Money does not support, instead of guessing its decimals', () => {
      expect(() => validateEnv({ ...valid, PLAN_CURRENCY: 'BTC' })).toThrow(/Unsupported currency/);
    });
  });
});
