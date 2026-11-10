import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppConfig } from '../config/configuration';
import { PaymentProviderName } from '../config/env.validation';
import { AuthModule } from '../auth/auth.module';
import { OnboardingModule } from '../onboarding/onboarding.module';
import { OutboxDispatcher } from './application/outbox-dispatcher';
import { PaymentSynchronizer } from './application/payment-synchronizer';
import { CompanyGateway, PlanPricing } from './application/ports/collaborators';
import { PaymentProvider } from './application/ports/payment-provider';
import { OutboxRepository, PaymentRepository } from './application/ports/repositories';
import { GetPaymentUseCase } from './application/use-cases/get-payment.use-case';
import { HandleProviderEventUseCase } from './application/use-cases/handle-provider-event.use-case';
import { ReconcilePaymentsUseCase } from './application/use-cases/reconcile-payments.use-case';
import { StartPaymentUseCase } from './application/use-cases/start-payment.use-case';
import { Money } from './domain/money';
import { OnboardingCompanyGateway } from './infrastructure/onboarding-company.gateway';
import { PaymentBackgroundJobs } from './infrastructure/payment-background-jobs';
import { OutboxRecord } from './infrastructure/persistence/outbox.record';
import { PaymentRecord } from './infrastructure/persistence/payment.record';
import { TypeOrmOutboxRepository } from './infrastructure/persistence/typeorm-outbox.repository';
import { TypeOrmPaymentRepository } from './infrastructure/persistence/typeorm-payment.repository';
import { MockPaymentProvider } from './infrastructure/providers/mock-payment.provider';
import { StripePaymentProvider } from './infrastructure/providers/stripe-payment.provider';
import { CheckoutConfigController } from './presentation/checkout-config.controller';
import { PaymentsController } from './presentation/payments.controller';
import { WebhooksController } from './presentation/webhooks.controller';

@Module({
  imports: [TypeOrmModule.forFeature([PaymentRecord, OutboxRecord]), OnboardingModule, AuthModule],
  controllers: [PaymentsController, CheckoutConfigController, WebhooksController],
  exports: [PaymentProvider, HandleProviderEventUseCase],
  providers: [
    StartPaymentUseCase,
    GetPaymentUseCase,
    HandleProviderEventUseCase,
    ReconcilePaymentsUseCase,
    PaymentSynchronizer,
    OutboxDispatcher,
    PaymentBackgroundJobs,
    { provide: OutboxRepository, useClass: TypeOrmOutboxRepository },
    { provide: PaymentRepository, useClass: TypeOrmPaymentRepository },
    { provide: CompanyGateway, useClass: OnboardingCompanyGateway },
    {
      provide: PlanPricing,
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>): PlanPricing => {
        const { priceMinor, currency } = config.get('payments', { infer: true }).plan;
        return { price: Money.of(priceMinor, currency) };
      },
    },
    {
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
