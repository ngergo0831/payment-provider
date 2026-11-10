import { Injectable, Logger } from '@nestjs/common';
import { CompanyAlreadyActiveException, CompanyNotFoundException } from '../../../common/errors/exceptions';
import { Payment } from '../../domain/payment';
import { PaymentStatus } from '../../domain/payment-status';
import { PaymentSynchronizer } from '../payment-synchronizer';
import { CompanyGateway, PlanPricing } from '../ports/collaborators';
import { PaymentProvider, ProviderPayment, ProviderPaymentNotFoundError } from '../ports/payment-provider';
import { LivePaymentAlreadyExistsError, PaymentRepository } from '../ports/repositories';

export interface PaymentCheckout {
  payment: Payment;
  clientSecret: string | null;
}

/**
 * "Start or resume" the company's payment. Safe to call again and again (double click, page reload, a retry after a
 * decline, a retry after the provider was down): it always converges on the company's one live payment.
 *
 * The order of operations is deliberate:
 *   1. save our intent first (CREATED, not yet known to the provider)  -> a crash here loses nothing
 *   2. call the provider, idempotent on our payment id                  -> a timeout here is safe to retry
 *   3. record the provider's reference and state
 */
@Injectable()
export class StartPaymentUseCase {
  private readonly logger = new Logger(StartPaymentUseCase.name);

  constructor(
    private readonly companies: CompanyGateway,
    private readonly pricing: PlanPricing,
    private readonly provider: PaymentProvider,
    private readonly payments: PaymentRepository,
    private readonly synchronizer: PaymentSynchronizer,
  ) {}

  async execute(companyId: string): Promise<PaymentCheckout> {
    const company = await this.companies.findBillingProfile(companyId);
    if (!company) throw new CompanyNotFoundException();
    if (company.isActive) throw new CompanyAlreadyActiveException();

    const checkout = await this.startOrResume(companyId);

    // The payment may be dead: canceled by the provider (e.g. it expired), unknown to it, or made with a provider that
    // is no longer configured. Begin a fresh one instead of handing the customer a dead checkout.
    if (checkout.payment.status === PaymentStatus.CANCELED) return this.startOrResume(companyId);
    return checkout;
  }

  private async startOrResume(companyId: string): Promise<PaymentCheckout> {
    const payment = (await this.payments.findLiveByCompany(companyId)) ?? (await this.createIntent(companyId));

    // Already paid; the company is activated shortly after. Nothing is left to collect, and nothing new is started.
    if (payment.isSucceeded()) return { payment, clientSecret: null };

    const remote = await this.fetchRemote(payment);
    if (!remote) {
      this.logger.warn(`Payment ${payment.id} is unknown to the ${this.provider.name} provider; closing it`);
      return { payment: await this.synchronizer.retire(payment.id), clientSecret: null };
    }

    const saved = await this.synchronizer.apply(payment.id, remote);
    return { payment: saved, clientSecret: saved.isFinal() ? null : remote.clientSecret };
  }

  /** The provider's record of the payment, or null if the configured provider cannot know it. */
  private async fetchRemote(payment: Payment): Promise<ProviderPayment | null> {
    if (payment.provider !== this.provider.name) return null;
    if (!payment.providerRef) {
      return this.provider.createPayment({ paymentId: payment.id, companyId: payment.companyId, amount: payment.amount });
    }
    try {
      return await this.provider.retrievePayment(payment.providerRef);
    } catch (error) {
      if (error instanceof ProviderPaymentNotFoundError) return null;
      throw error;
    }
  }

  private async createIntent(companyId: string): Promise<Payment> {
    const payment = Payment.start({ companyId, provider: this.provider.name, amount: this.pricing.price });
    try {
      await this.payments.insert(payment);
      return payment;
    } catch (error) {
      if (!(error instanceof LivePaymentAlreadyExistsError)) throw error;
      const winner = await this.payments.findLiveByCompany(companyId);
      if (!winner) throw error;
      return winner;
    }
  }
}
