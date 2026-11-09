import { Logger } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { RequestWithId } from '../http/request-id.middleware';

const logger = new Logger('HTTP');

const MAX_PATH_LENGTH = 200;
const shorten = (path: string) => (path.length > MAX_PATH_LENGTH ? `${path.slice(0, MAX_PATH_LENGTH)}…` : path);

const QUIET_PATHS = new Set(['/health']);

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
