import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PaymentRepository, WebhookEventRepository } from './application/ports/repositories';
import { PaymentRecord } from './infrastructure/persistence/payment.record';
import { TypeOrmPaymentRepository } from './infrastructure/persistence/typeorm-payment.repository';
import { TypeOrmWebhookEventRepository } from './infrastructure/persistence/typeorm-webhook-event.repository';
import { WebhookEventRecord } from './infrastructure/persistence/webhook-event.record';

/** The payments module. Persistence only so far; the provider, use cases and endpoints arrive in later tasks. */
@Module({
  imports: [TypeOrmModule.forFeature([PaymentRecord, WebhookEventRecord])],
  providers: [
    { provide: PaymentRepository, useClass: TypeOrmPaymentRepository },
    { provide: WebhookEventRepository, useClass: TypeOrmWebhookEventRepository },
  ],
  exports: [PaymentRepository, WebhookEventRepository],
})
export class PaymentsModule {}
