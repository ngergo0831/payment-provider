import { Logger } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { RequestWithId } from '../http/request-id.middleware';

const logger = new Logger('HTTP');

/** The path is whatever the caller typed: cap it, so one request cannot write a megabyte into the log. */
const MAX_PATH_LENGTH = 200;
const shorten = (path: string) => (path.length > MAX_PATH_LENGTH ? `${path.slice(0, MAX_PATH_LENGTH)}…` : path);

/** Probes that fire every few seconds say nothing useful: a container health check would be most of the log. */
const QUIET_PATHS = new Set(['/health']);

/**
 * One line per request, written when the response is finished:
 *
 *   [b3f1c5a2-...] POST /payments -> 200 41ms company=7c2d...
 *
 * It is what you read first when something went wrong: what was called, by which company, what came back, how long it
 * took, and the request id that ties the line to an error response and to the error log. It never logs the query
 * string (it can carry personal data), headers or bodies.
 *
 * Reads are logged at `debug`: the browser polls for the activation status every few seconds, and that is most of the
 * traffic. Everything that changes something, and every failure, is logged at `log`. `LOG_LEVEL=log` silences the polling.
 *
 * Plain Express middleware, registered right after the request id is assigned.
 */
export function logRequests(req: Request, res: Response, next: NextFunction): void {
  const startedAt = process.hrtime.bigint();

  res.on('finish', () => {
    if (QUIET_PATHS.has(req.path)) return;

    const milliseconds = Math.round(Number(process.hrtime.bigint() - startedAt) / 1e6);
    // Set by the JWT guard, so it exists only on authenticated routes.
    const companyId = (req as Request & { user?: { companyId?: string } }).user?.companyId;
    const line = `[${(req as RequestWithId).id}] ${req.method} ${shorten(req.path)} -> ${res.statusCode} ${milliseconds}ms${companyId ? ` company=${companyId}` : ''}`;

    const routine = req.method === 'GET' && res.statusCode < 400;
    if (routine) logger.debug(line);
    else logger.log(line);
  });

  next();
}
