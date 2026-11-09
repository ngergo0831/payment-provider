import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtAuthModule } from '../auth/jwt-auth.module';
import { OnboardingModule } from '../onboarding/onboarding.module';
import { PaymentSynchronizer } from './application/payment-synchronizer';
import { CompanyGateway, PlanPricing } from './application/ports/collaborators';
import { PaymentProvider } from './application/ports/payment-provider';
import { PaymentRepository, WebhookEventRepository } from './application/ports/repositories';
import { GetPaymentUseCase } from './application/use-cases/get-payment.use-case';
import { StartPaymentUseCase } from './application/use-cases/start-payment.use-case';
import { ConfigPlanPricing, OnboardingCompanyGateway } from './infrastructure/onboarding-company.gateway';
import { PaymentRecord } from './infrastructure/persistence/payment.record';
import { TypeOrmPaymentRepository } from './infrastructure/persistence/typeorm-payment.repository';
import { TypeOrmWebhookEventRepository } from './infrastructure/persistence/typeorm-webhook-event.repository';
import { WebhookEventRecord } from './infrastructure/persistence/webhook-event.record';
import { MockPaymentProvider } from './infrastructure/providers/mock-payment.provider';
import { PaymentsController } from './presentation/payments.controller';

@Module({
  imports: [TypeOrmModule.forFeature([PaymentRecord, WebhookEventRecord]), OnboardingModule, JwtAuthModule],
  controllers: [PaymentsController],
  providers: [
    StartPaymentUseCase,
    GetPaymentUseCase,
    PaymentSynchronizer,
    { provide: PaymentRepository, useClass: TypeOrmPaymentRepository },
    { provide: WebhookEventRepository, useClass: TypeOrmWebhookEventRepository },
    { provide: CompanyGateway, useClass: OnboardingCompanyGateway },
    { provide: PlanPricing, useClass: ConfigPlanPricing },
    {
      // The composition root for the integration: the ONE place that chooses a concrete provider.
      // Only the mock exists so far; choosing Stripe by configuration arrives with the Stripe adapter (task 23).
      provide: PaymentProvider,
      useFactory: (): PaymentProvider => new MockPaymentProvider(),
    },
  ],
  exports: [PaymentRepository, WebhookEventRepository, PaymentProvider],
})
export class PaymentsModule {}
