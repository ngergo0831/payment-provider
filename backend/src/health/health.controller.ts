import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiProperty, ApiServiceUnavailableResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { DatabaseHealthIndicator } from './database-health.indicator';

class HealthResponse {
  @ApiProperty({ enum: ['ok', 'error'], example: 'ok' })
  status: 'ok' | 'error';

  @ApiProperty({ enum: ['up', 'down'], example: 'up' })
  database: 'up' | 'down';
}

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly database: DatabaseHealthIndicator) {}

  /**
   * Readiness: "can this instance do its job right now?". Returns 503 (not just a different body) when the
   * database is unreachable, because Docker, load balancers and monitors act on the STATUS CODE.
   * It uses its own small body instead of the shared error envelope: health consumers are machines
   * that only read the status line.
   */
  @Get()
  @ApiOperation({ summary: 'Is the service ready? Checks the database.' })
  @ApiOkResponse({ type: HealthResponse, description: 'Service and database are up' })
  @ApiServiceUnavailableResponse({ type: HealthResponse, description: 'Database unreachable' })
  async check(@Res({ passthrough: true }) response: Response): Promise<HealthResponse> {
    if (await this.database.isUp()) {
      return { status: 'ok', database: 'up' };
    }
    response.status(HttpStatus.SERVICE_UNAVAILABLE);
    return { status: 'error', database: 'down' };
  }
}
