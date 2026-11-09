import { ApiProperty } from '@nestjs/swagger';
import { Payment } from '../domain/payment';
import { PaymentStatus } from '../domain/payment-status';
import { PaymentCheckout } from '../application/use-cases/start-payment.use-case';

class MoneyDto {
  @ApiProperty({ example: 4900, description: 'Integer minor units (cents; whole yen for JPY). Never a decimal.' })
  amountMinor: number;

  @ApiProperty({ example: 'USD', description: 'ISO 4217 currency code' })
  currency: string;
}

export class PaymentDto {
  @ApiProperty({ format: 'uuid' }) id: string;

  @ApiProperty({ enum: PaymentStatus })
  status: PaymentStatus;

  @ApiProperty({ type: MoneyDto }) amount: MoneyDto;

  @ApiProperty({ type: String, nullable: true, example: 'card_declined', description: 'Why the last attempt failed; null otherwise' })
  failureCode: string | null;

  @ApiProperty({ type: String, nullable: true, description: "The provider's own id for this payment; null until the provider has been contacted" })
  providerRef: string | null;

  @ApiProperty({ type: String, format: 'date-time' }) createdAt: Date;

  /** Built field by field: the domain object is never serialised directly, so nothing leaks by accident. */
  static from(payment: Payment): PaymentDto {
    return {
      id: payment.id,
      status: payment.status,
      amount: payment.amount.toJSON(),
      failureCode: payment.failureCode,
      providerRef: payment.providerRef,
      createdAt: payment.createdAt,
    };
  }
}

export class PaymentCheckoutDto {
  @ApiProperty({ type: PaymentDto }) payment: PaymentDto;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Hand to the provider SDK in the browser to collect card details. Null when the payment is already final.',
  })
  clientSecret: string | null;

  static from({ payment, clientSecret }: PaymentCheckout): PaymentCheckoutDto {
    return { payment: PaymentDto.from(payment), clientSecret };
  }
}
