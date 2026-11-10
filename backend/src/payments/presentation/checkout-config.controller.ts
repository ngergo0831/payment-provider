import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOkResponse, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { AppConfig } from '../../config/configuration';
import { PaymentProviderName } from '../../config/env.validation';
import { PlanPricing } from '../application/ports/collaborators';

class PriceDto {
  @ApiProperty({ example: 4900, description: 'Integer minor units (cents; whole yen for JPY)' }) amountMinor: number;
  @ApiProperty({ example: 'USD' }) currency: string;
}

class CheckoutConfigDto {
  @ApiProperty({
    enum: PaymentProviderName,
    description: "`stripe`: show Stripe's card form. `mock`: no real payment form; use the dev simulator.",
  })
  provider: PaymentProviderName;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'pk_test_...',
    description: "Stripe's PUBLISHABLE key, which is designed to be public. Null for the mock. The secret key is never exposed.",
  })
  publishableKey: string | null;

  @ApiProperty({ type: PriceDto }) price: PriceDto;
}

@ApiTags('payments')
@Controller('checkout-config')
export class CheckoutConfigController {
  constructor(
    private readonly config: ConfigService<AppConfig, true>,
    private readonly pricing: PlanPricing,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Which payment provider is active, its publishable key, and the price' })
  @ApiOkResponse({ type: CheckoutConfigDto })
  get(): CheckoutConfigDto {
    const { provider, stripe } = this.config.get('payments', { infer: true });
    return {
      provider,
      publishableKey: provider === PaymentProviderName.Stripe ? stripe.publishableKey : null,
      price: this.pricing.price.toJSON(),
    };
  }
}
