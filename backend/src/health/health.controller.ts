import { Controller, Get } from '@nestjs/common';

@Controller('health')
export class HealthController {
  /** Liveness: "the process is up and routing requests". Database checks are added in task 7. */
  @Get()
  check(): { status: 'ok' } {
    return { status: 'ok' };
  }
}
