import { Environment, validateEnv } from './env.validation';

describe('validateEnv', () => {
  it('applies defaults when nothing is set', () => {
    const env = validateEnv({});
    expect(env.NODE_ENV).toBe(Environment.Development);
    expect(env.PORT).toBe(3000);
  });

  it('converts PORT from a string to a number', () => {
    const env = validateEnv({ PORT: '8080', NODE_ENV: 'production' });
    expect(env.PORT).toBe(8080);
    expect(env.NODE_ENV).toBe(Environment.Production);
  });

  it('ignores unrelated variables (process.env contains hundreds)', () => {
    expect(() => validateEnv({ PATH: '/usr/bin', HOME: '/home/x' })).not.toThrow();
  });

  it.each([
    ['not a number', 'abc'],
    ['zero', '0'],
    ['too large', '70000'],
    ['a decimal', '30.5'],
    ['empty', ''],
  ])('rejects PORT that is %s', (_label, port) => {
    expect(() => validateEnv({ PORT: port })).toThrow(/PORT/);
  });

  it('gives one clear message per variable (non-numeric PORT is "not an integer", not "too large")', () => {
    expect(() => validateEnv({ PORT: 'abc' })).toThrow('PORT must be an integer number');
    expect(() => validateEnv({ PORT: 'abc' })).not.toThrow(/greater than|less than/);
  });

  it('rejects an unknown NODE_ENV', () => {
    expect(() => validateEnv({ NODE_ENV: 'staging' })).toThrow(/NODE_ENV/);
  });

  it('reports every problem at once, not just the first', () => {
    expect(() => validateEnv({ PORT: 'abc', NODE_ENV: 'staging' })).toThrow(/PORT[\s\S]*NODE_ENV|NODE_ENV[\s\S]*PORT/);
  });
});
