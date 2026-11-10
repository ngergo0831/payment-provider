import { BadRequestException, Controller, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { ApiBadRequestResponse, ApiOkResponse, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { ErrorResponse } from '../../common/http/error-response';
import { PaymentProvider } from '../application/ports/payment-provider';
import { EventHandlingResult, HandleProviderEventUseCase } from '../application/use-cases/handle-provider-event.use-case';

class WebhookAcknowledgement {
  @ApiProperty({ example: true }) received: boolean;

  @ApiProperty({
    enum: [...Object.values(EventHandlingResult), 'IGNORED'],
    description: 'What happened. IGNORED = a valid message about something we do not handle.',
  })
  result: EventHandlingResult | 'IGNORED';
}

/**
 * Where the payment provider tells us that something happened. Public by necessity (a provider cannot send our JWT);
 * authenticity comes from the SIGNATURE, verified over the exact bytes received.
 *
 * Any non-2xx answer makes the provider retry, which is exactly what we want after a transient failure.
 */
@ApiTags('webhooks')
@Controller('webhooks')
export class WebhooksController {
  constructor(
    private readonly provider: PaymentProvider,
    private readonly handleEvent: HandleProviderEventUseCase,
  ) {}

  @Post('payments')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Receiver for payment provider notifications (called by the provider, not by clients)' })
  @ApiOkResponse({ type: WebhookAcknowledgement, description: 'Acknowledged: handled, a duplicate, or not relevant' })
  @ApiBadRequestResponse({
    type: ErrorResponse,
    description: 'INVALID_WEBHOOK_SIGNATURE: missing or wrong signature; nothing was processed',
  })
  async receive(@Req() request: RawBodyRequest<Request>): Promise<WebhookAcknowledgement> {
    if (!request.rawBody) throw new BadRequestException('Missing request body');

    const event = this.provider.parseWebhook(request.rawBody, request.header(this.provider.webhookSignatureHeader));
    if (!event) return { received: true, result: 'IGNORED' };

    return { received: true, result: await this.handleEvent.execute(event) };
  }
}
