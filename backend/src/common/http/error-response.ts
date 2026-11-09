import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ErrorCode } from '../errors/error-codes';

/** One invalid field and everything wrong with it (same shape as `FieldError` in the domain layer). */
export class FieldErrorDto {
  @ApiProperty({ example: 'company.name', description: 'Path to the field; nested fields use dots' })
  field: string;

  @ApiProperty({ type: [String], example: ['name must be longer than or equal to 2 characters'] })
  messages: string[];
}

/** The ONE shape of every error response in the API, so clients write a single error handler. */
export class ErrorResponse {
  @ApiProperty({ example: 422, description: 'HTTP status, repeated in the body for clients/logs that lose the response line' })
  statusCode: number;

  @ApiProperty({
    enum: ErrorCode,
    example: ErrorCode.VALIDATION_FAILED,
    description: 'Stable machine-readable code. Branch on this, never on `message`.',
  })
  code: ErrorCode;

  @ApiProperty({ example: 'Request validation failed', description: 'Human-readable and safe to show; never contains internals' })
  message: string;

  @ApiPropertyOptional({ type: [FieldErrorDto], description: 'Present for validation failures only' })
  details?: FieldErrorDto[];

  @ApiProperty({
    example: 'b3f1c5a2-0c52-4a35-9f43-1d4b2c3a9a10',
    description: 'Correlation id: also in the `x-request-id` header and the server logs. Quote it when reporting a problem.',
  })
  requestId: string;

  @ApiProperty({ example: '2026-11-09T12:00:00.000Z' })
  timestamp: string;
}
