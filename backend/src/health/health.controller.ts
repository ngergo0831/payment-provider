import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';

class HealthResponse {
  @ApiProperty({ example: 'ok' })
  status: 'ok';
}

@ApiTags('health')
@Controller('health')
export class HealthController {
  /** Liveness: "the process is up and routing requests". Database checks are added in task 7. */
  @Get()
  @ApiOperation({ summary: 'Is the service up?' })
  @ApiOkResponse({ type: HealthResponse })
  check(): HealthResponse {
    return { status: 'ok' };
  }
}
