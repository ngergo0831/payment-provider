import { Body, Controller, HttpCode, HttpStatus, NotFoundException, Param, Post } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsEnum, IsOptional } from 'class-validator';
import { PaymentProvider, ProviderEvent, ProviderPaymentNotFoundError } from '../application/ports/payment-provider';
import { EventHandlingResult, HandleProviderEventUseCase } from '../application/use-cases/handle-provider-event.use-case';
import { MockOutcome, MockPaymentProvider } from '../infrastructure/providers/mock-payment.provider';

class SimulateDto {
  @ApiProperty({ enum: MockOutcome, description: 'What the fake customer / bank does to the payment' })
  @IsEnum(MockOutcome)
  outcome: MockOutcome;

  @ApiPropertyOptional({
    default: true,
    description:
      'false = change the payment at the provider but send NO webhook, simulating a lost notification. ' +
      'The change is then noticed only when the customer resumes checkout.',
  })
  @IsOptional()
  @IsBoolean()
  deliverWebhook?: boolean;
}

class OutageDto {
  @ApiProperty({ description: 'true = every provider call fails as if the provider were down' })
  @IsBoolean()
  enabled: boolean;
}

/**
 * Plays "the customer" and "the provider's bad day" so every scenario can be tried from Swagger without a Stripe account.
 * Only registered when the mock provider is selected (see AppModule), and the mock is refused in production.
 */
@ApiTags('dev (mock provider only)')
@Controller('dev/mock-payments')
export class MockPaymentsDevController {
  private readonly mock: MockPaymentProvider;

  constructor(
    provider: PaymentProvider,
    private readonly handleEvent: HandleProviderEventUseCase,
  ) {
    if (!(provider instanceof MockPaymentProvider)) throw new Error('The mock payments dev endpoints need the mock payment provider');
    this.mock = provider;
  }

  @Post(':providerRef/simulate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Simulate what the customer or bank does to a payment',
    description:
      'Use the `providerRef` returned by `POST /payments`. The provider then sends its webhook, exactly like the real one would.',
  })
  @ApiOkResponse({ description: 'The payment changed at the provider; the webhook was delivered unless deliverWebhook was false' })
  async simulate(
    @Param('providerRef') providerRef: string,
    @Body() dto: SimulateDto,
  ): Promise<{ webhook: EventHandlingResult | 'NOT_DELIVERED' }> {
    const event = this.simulateOrNotFound(providerRef, dto.outcome);
    if (dto.deliverWebhook === false) return { webhook: 'NOT_DELIVERED' };
    return { webhook: await this.handleEvent.execute(event) };
  }

  @Post('outage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Make the fake provider fail every call (tests the "temporarily unavailable" path)' })
  @ApiOkResponse({ description: 'Outage switched on or off' })
  setOutage(@Body() dto: OutageDto): { outage: boolean } {
    this.mock.setOutage(dto.enabled);
    return { outage: this.mock.isOutage() };
  }

  private simulateOrNotFound(providerRef: string, outcome: MockOutcome): ProviderEvent {
    try {
      return this.mock.simulate(providerRef, outcome);
    } catch (error) {
      if (error instanceof ProviderPaymentNotFoundError) throw new NotFoundException(`No mock payment ${providerRef}`);
      throw error;
    }
  }
}
