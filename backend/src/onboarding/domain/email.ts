/**
 * The one definition of "the same email". Emails are stored trimmed and lower-case, and the database REJECTS
 * anything else, so every path that accepts an email (HTTP validation, use cases) must normalise with this.
 * (Technically the local part of an address may be case-sensitive; in practice no mail provider treats it so,
 * and treating "Ada@x.com" and "ada@x.com" as one account is the safer behaviour.)
 */
export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}
