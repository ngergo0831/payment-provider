import { Environment, validateEnv } from './env.validation';

const DATABASE_URL = 'postgres://payments:s3cret-pw@localhost:5432/payments';
const JWT_SECRET = 'unit-test-secret-that-is-32-chars+';
/** The smallest valid environment: everything else has a default. */
const valid = { DATABASE_URL, JWT_SECRET };
/** Stripe, fully configured. Production requires it, because the mock provider is refused there. */
const stripe = {
  PAYMENT_PROVIDER: 'stripe',
  STRIPE_SECRET_KEY: 'sk_test_abc123',
  STRIPE_PUBLISHABLE_KEY: 'pk_test_abc123',
  STRIPE_WEBHOOK_SECRET: 'whsec_abc123',
};

describe('validateEnv', () => {
  it('applies defaults for everything except the required secrets', () => {
    const env = validateEnv(valid);
    expect(env.NODE_ENV).toBe(Environment.Development);
    expect(env.PORT).toBe(3000);
    expect(env.DATABASE_URL).toBe(DATABASE_URL);
    expect(env.JWT_EXPIRES_IN).toBe('24h');
  });

  it('converts PORT from a string to a number', () => {
    const env = validateEnv({ ...valid, ...stripe, PORT: '8080', NODE_ENV: 'production' });
    expect(env.PORT).toBe(8080);
    expect(env.NODE_ENV).toBe(Environment.Production);
  });

  it('ignores unrelated variables (process.env contains hundreds)', () => {
    expect(() => validateEnv({ ...valid, PATH: '/usr/bin', HOME: '/home/x' })).not.toThrow();
  });

  it.each([
    ['not a number', 'abc'],
    ['zero', '0'],
    ['too large', '70000'],
    ['a decimal', '30.5'],
    ['empty', ''],
  ])('rejects PORT that is %s', (_label, port) => {
    expect(() => validateEnv({ ...valid, PORT: port })).toThrow(/PORT/);
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

  it('rejects an unknown NODE_ENV', () => {
    expect(() => validateEnv({ ...valid, NODE_ENV: 'staging' })).toThrow(/NODE_ENV/);
  });

  it('reports every problem at once, not just the first', () => {
    expect.assertions(3);
    try {
      validateEnv({ PORT: 'abc', NODE_ENV: 'staging' }); // and DATABASE_URL missing
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain('PORT');
      expect(message).toContain('NODE_ENV');
      expect(message).toContain('DATABASE_URL');
    }
  });

  describe('DATABASE_URL', () => {
    it('is required', () => {
      expect(() => validateEnv({ JWT_SECRET })).toThrow(/DATABASE_URL/);
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
      expect(() => validateEnv({ DATABASE_URL })).toThrow(/JWT_SECRET/);
    });

    it('must be at least 32 characters (shorter is brute-forceable)', () => {
      expect(() => validateEnv({ DATABASE_URL, JWT_SECRET: 'x'.repeat(31) })).toThrow(/JWT_SECRET/);
      expect(() => validateEnv({ DATABASE_URL, JWT_SECRET: 'x'.repeat(32) })).not.toThrow();
    });

    it('never appears in the error message', () => {
      expect.assertions(1);
      try {
        validateEnv({ DATABASE_URL, JWT_SECRET: 'short-but-secret' });
      } catch (error) {
        expect((error as Error).message).not.toContain('short-but-secret');
      }
    });
  });

  describe('the public example secret', () => {
    const exampleSecret = 'dev-only-secret-change-me-it-must-be-32+chars';

    it('is fine for development and tests', () => {
      expect(() => validateEnv({ DATABASE_URL, JWT_SECRET: exampleSecret, NODE_ENV: 'development' })).not.toThrow();
      expect(() => validateEnv({ DATABASE_URL, JWT_SECRET: exampleSecret, NODE_ENV: 'test' })).not.toThrow();
    });

    it('is REFUSED in production, because anyone who has read the repository knows it', () => {
      expect(() => validateEnv({ DATABASE_URL, ...stripe, JWT_SECRET: exampleSecret, NODE_ENV: 'production' })).toThrow(/public development example/);
    });

    it('a real secret works in production', () => {
      expect(() => validateEnv({ DATABASE_URL, ...stripe, JWT_SECRET: 'x'.repeat(48), NODE_ENV: 'production' })).not.toThrow();
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
    it('defaults to the mock, which needs no keys', () => {
      const env = validateEnv(valid);
      expect(env.PAYMENT_PROVIDER).toBe('mock');
      expect(env.STRIPE_SECRET_KEY).toBeUndefined();
    });

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
        expect(() => validateEnv({ ...valid, ...stripe, STRIPE_SECRET_KEY: 'sk_live_abc', STRIPE_PUBLISHABLE_KEY: 'pk_live_abc' })).not.toThrow();
      });

      it('never puts a key in the error message', () => {
        expect.assertions(1);
        try {
          validateEnv({ ...valid, ...stripe, STRIPE_SECRET_KEY: 'TOPSECRET-mistyped-key' });
        } catch (error) {
          expect((error as Error).message).not.toContain('TOPSECRET'); // names the variable, never the value
        }
      });
    });

    it('Stripe settings are NOT required for the mock (no keys needed to run the project)', () => {
      expect(() => validateEnv({ ...valid, PAYMENT_PROVIDER: 'mock' })).not.toThrow();
    });

    it('the mock is REFUSED in production: its webhook "signature" is public, so anyone could fake a payment', () => {
      expect(() => validateEnv({ ...valid, NODE_ENV: 'production', JWT_SECRET: 'x'.repeat(48) })).toThrow(/PAYMENT_PROVIDER=mock is not allowed/);
    });

    it('reports every production problem in ONE error, so a bad deploy is fixed in one go', () => {
      const production = { DATABASE_URL: valid.DATABASE_URL, NODE_ENV: 'production', JWT_SECRET: `dev-only-${'x'.repeat(32)}`, PLAN_CURRENCY: 'BTC' };

      expect(() => validateEnv(production)).toThrow(/Unsupported currency[\s\S]*PAYMENT_PROVIDER=mock[\s\S]*JWT_SECRET is the public/);
    });
  });

  describe('RECONCILE_INTERVAL_MS', () => {
    it('defaults to one minute, and 0 (timer off) is allowed', () => {
      expect(validateEnv(valid).RECONCILE_INTERVAL_MS).toBe(60000);
      expect(validateEnv({ ...valid, RECONCILE_INTERVAL_MS: '0' }).RECONCILE_INTERVAL_MS).toBe(0);
    });

    it.each([['-1'], ['1.5'], ['often'], ['']])('rejects %j (an empty value must not silently switch the safety net off)', (value) => {
      expect(() => validateEnv({ ...valid, RECONCILE_INTERVAL_MS: value })).toThrow(/RECONCILE_INTERVAL_MS/);
    });
  });

  describe('OUTBOX_POLL_INTERVAL_MS', () => {
    it('defaults to 1000, and 0 (timer off) is allowed', () => {
      expect(validateEnv(valid).OUTBOX_POLL_INTERVAL_MS).toBe(1000);
      expect(validateEnv({ ...valid, OUTBOX_POLL_INTERVAL_MS: '0' }).OUTBOX_POLL_INTERVAL_MS).toBe(0);
    });

    it.each([['-1'], ['1.5'], ['fast'], ['']])('rejects %j', (value) => {
      expect(() => validateEnv({ ...valid, OUTBOX_POLL_INTERVAL_MS: value })).toThrow(/OUTBOX_POLL_INTERVAL_MS/);
    });
  });

  describe('the plan price', () => {
    it('defaults to 49.00 USD (4900 minor units)', () => {
      const env = validateEnv(valid);
      expect(env.PLAN_PRICE_MINOR).toBe(4900);
      expect(env.PLAN_CURRENCY).toBe('USD');
    });

    it('accepts another supported currency, any letter case', () => {
      expect(validateEnv({ ...valid, PLAN_PRICE_MINOR: '5000', PLAN_CURRENCY: 'jpy' })).toMatchObject({ PLAN_PRICE_MINOR: 5000 });
    });

    it.each([['0'], ['-5'], ['49.5'], ['abc'], ['']])('rejects PLAN_PRICE_MINOR %j', (price) => {
      expect(() => validateEnv({ ...valid, PLAN_PRICE_MINOR: price })).toThrow(/PLAN_PRICE_MINOR/);
    });

    it.each([['US'], ['USDX'], ['$$$'], ['']])('rejects a malformed PLAN_CURRENCY %j', (currency) => {
      expect(() => validateEnv({ ...valid, PLAN_CURRENCY: currency })).toThrow(/PLAN_CURRENCY/);
    });

    it('rejects a currency Money does not support, instead of guessing its decimals', () => {
      expect(() => validateEnv({ ...valid, PLAN_CURRENCY: 'BTC' })).toThrow(/Unsupported currency/);
    });
  });
});
