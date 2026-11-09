/**
 * Error messages from libraries are the likeliest way for a secret to reach a log: they are written for a developer
 * reading a terminal, and often quote what they were given. (Stripe's "Invalid API Key provided: sk_test_****abcd" keeps
 * the last four characters of the key; the JSON parser quotes the start of the body.)
 *
 * AppLogger runs every message and stack trace through this, so no caller has to remember to. It is the last line of
 * defence, not a licence: the code does not log secrets on purpose. It recognises the shapes of the secrets we handle.
 */
const SECRET_SHAPES: RegExp[] = [
  /\b(?:sk|rk|pk)_(?:test|live)_[A-Za-z0-9*]+/g, // Stripe API keys, also in their masked form
  /\bwhsec_[A-Za-z0-9*]+/g, // webhook signing secrets
  /\b\w+_secret_\w+/g, // PaymentIntent client secrets: pi_3UZx..._secret_... (the id itself contains underscores)
  /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, // an Authorization header
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g, // a JWT
];

export const REDACTED = '[redacted]';

export function redactSecrets(text: string): string {
  return SECRET_SHAPES.reduce((safe, shape) => safe.replace(shape, REDACTED), text);
}
