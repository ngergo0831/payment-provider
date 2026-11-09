import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';

const DEFAULT_TIMEOUT_MS = 2000;

/**
 * Node's connection errors (e.g. ECONNREFUSED on several addresses) often have an EMPTY message, which
 * would log "check failed: " and nothing else. Fall back to the error code, then the error's type.
 */
function describe(error: unknown): string {
  const err = error as NodeJS.ErrnoException;
  return err.message || err.code || err.name || 'unknown error';
}

/** Answers one question: "can we run a query right now?" */
@Injectable()
export class DatabaseHealthIndicator {
  private readonly logger = new Logger(DatabaseHealthIndicator.name);

  constructor(private readonly dataSource: DataSource) {}

  /**
   * Runs `SELECT 1`. Never throws: a database that is down is an ANSWER ("not healthy"), not an error.
   * The timeout matters: a database that accepts the connection but never replies would otherwise
   * hang the health check itself, and the orchestrator would wait forever instead of seeing "unhealthy".
   */
  async isUp(timeoutMs: number = DEFAULT_TIMEOUT_MS): Promise<boolean> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`no answer within ${timeoutMs} ms`)), timeoutMs);
    });

    try {
      await Promise.race([this.dataSource.query('SELECT 1'), timeout]);
      return true;
    } catch (error) {
      this.logger.warn(`Database health check failed: ${describe(error)}`);
      return false;
    } finally {
      clearTimeout(timer); // otherwise every successful check leaves a 2 s timer alive
    }
  }
}
