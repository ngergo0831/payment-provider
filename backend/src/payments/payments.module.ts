import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppConfig } from '../config/configuration';
import { PaymentProviderName } from '../config/env.validation';
import { JwtAuthModule } from '../auth/jwt-auth.module';
import { OnboardingModule } from '../onboarding/onboarding.module';
import { OUTBOX_HANDLERS, OutboxDispatcher } from './application/outbox-dispatcher';
import { PaymentSucceededHandler } from './application/payment-succeeded.handler';
import { PaymentSynchronizer } from './application/payment-synchronizer';
import { CompanyActivation, CompanyGateway, PlanPricing } from './application/ports/collaborators';
import { PaymentProvider } from './application/ports/payment-provider';
import { OutboxRepository, PaymentRepository, WebhookEventRepository } from './application/ports/repositories';
import { GetPaymentUseCase } from './application/use-cases/get-payment.use-case';
import { HandleProviderEventUseCase } from './application/use-cases/handle-provider-event.use-case';
import { ReconcilePaymentsUseCase } from './application/use-cases/reconcile-payments.use-case';
import { StartPaymentUseCase } from './application/use-cases/start-payment.use-case';
import { ConfigPlanPricing, OnboardingCompanyActivation, OnboardingCompanyGateway } from './infrastructure/onboarding-company.gateway';
import { OutboxScheduler } from './infrastructure/outbox.scheduler';
import { ReconciliationScheduler } from './infrastructure/reconciliation.scheduler';
import { OutboxRecord } from './infrastructure/persistence/outbox.record';
import { PaymentRecord } from './infrastructure/persistence/payment.record';
import { TypeOrmOutboxRepository } from './infrastructure/persistence/typeorm-outbox.repository';
import { TypeOrmPaymentRepository } from './infrastructure/persistence/typeorm-payment.repository';
import { TypeOrmWebhookEventRepository } from './infrastructure/persistence/typeorm-webhook-event.repository';
import { WebhookEventRecord } from './infrastructure/persistence/webhook-event.record';
import { MockPaymentProvider } from './infrastructure/providers/mock-payment.provider';
import { StripePaymentProvider } from './infrastructure/providers/stripe-payment.provider';
import { CheckoutConfigController } from './presentation/checkout-config.controller';
import { MockPaymentsDevController } from './presentation/mock-payments-dev.controller';
import { PaymentsController } from './presentation/payments.controller';
import { WebhooksController } from './presentation/webhooks.controller';

@Module({
  imports: [TypeOrmModule.forFeature([PaymentRecord, WebhookEventRecord, OutboxRecord]), OnboardingModule, JwtAuthModule],
  controllers: [PaymentsController, CheckoutConfigController, WebhooksController, MockPaymentsDevController],
  providers: [
    StartPaymentUseCase,
    GetPaymentUseCase,
    HandleProviderEventUseCase,
    ReconcilePaymentsUseCase,
    ReconciliationScheduler,
    PaymentSynchronizer,
    OutboxDispatcher,
    OutboxScheduler,
    PaymentSucceededHandler,
    // The handlers the dispatcher can deliver to. Supporting a new message type means adding a handler here.
    { provide: OUTBOX_HANDLERS, useFactory: (succeeded: PaymentSucceededHandler) => [succeeded], inject: [PaymentSucceededHandler] },
    { provide: OutboxRepository, useClass: TypeOrmOutboxRepository },
    { provide: CompanyActivation, useClass: OnboardingCompanyActivation },
    { provide: PaymentRepository, useClass: TypeOrmPaymentRepository },
    { provide: WebhookEventRepository, useClass: TypeOrmWebhookEventRepository },
    { provide: CompanyGateway, useClass: OnboardingCompanyGateway },
    { provide: PlanPricing, useClass: ConfigPlanPricing },
    {
      // The composition root for the integration: the ONE place that chooses a concrete provider, from configuration.
      provide: PaymentProvider,
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>): PaymentProvider => {
        const { provider, stripe } = config.get('payments', { infer: true });
        return provider === PaymentProviderName.Stripe
          ? new StripePaymentProvider({ secretKey: stripe.secretKey, webhookSecret: stripe.webhookSecret })
          : new MockPaymentProvider();
      },
    },
  ],
})
export class PaymentsModule {}
