import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export const REQUEST_ID_HEADER = 'x-request-id';

export type RequestWithId = Request & { id: string };

// Only characters that are harmless in logs and headers, and a sane length.
const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{1,128}$/;

/**
 * Gives every request a correlation id, so one customer report ("my payment failed, ref abc-123")
 * can be traced through the logs. A caller-supplied id (e.g. from a gateway) is reused when it is safe;
 * anything else is replaced, because an attacker-chosen value could forge or inject log lines.
 *
 * Plain Express middleware, registered with `app.use()` BEFORE the body parser. Nest's own
 * middleware runs after body parsing, so a malformed-JSON error would otherwise have no request id.
 */
export function assignRequestId(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.header(REQUEST_ID_HEADER);
  const id = incoming && SAFE_REQUEST_ID.test(incoming) ? incoming : randomUUID();

  (req as RequestWithId).id = id;
  res.setHeader(REQUEST_ID_HEADER, id);
  next();
}
