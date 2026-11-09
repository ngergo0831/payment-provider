import { Injectable } from '@nestjs/common';
import { CompanyAlreadyActiveException, CompanyNotFoundException } from '../../../common/errors/exceptions';
import { Payment } from '../../domain/payment';
import { PaymentStatus } from '../../domain/payment-status';
import { PaymentSynchronizer } from '../payment-synchronizer';
import { CompanyGateway, PlanPricing } from '../ports/collaborators';
import { PaymentProvider } from '../ports/payment-provider';
import { OpenPaymentAlreadyExistsError, PaymentRepository } from '../ports/repositories';

export interface PaymentCheckout {
  payment: Payment;
  clientSecret: string | null;
}

/**
 * "Start or resume" the company's payment. Safe to call again and again (double click, page reload, a retry after a
 * decline, a retry after the provider was down): it always converges on the company's ONE open payment.
 *
 * The order of operations is deliberate:
 *   1. save OUR intent first (CREATED, not yet known to the provider)  -> a crash here loses nothing
 *   2. call the provider, idempotent on our payment id                  -> a timeout here is safe to retry
 *   3. record the provider's reference and state
 */
@Injectable()
export class StartPaymentUseCase {
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

    // The provider may have canceled the payment on its side (e.g. it expired). Then this one is dead and the company
    // has no open payment any more, so begin a fresh one instead of handing the customer a dead checkout.
    if (checkout.payment.status === PaymentStatus.CANCELED) return this.startOrResume(companyId);
    return checkout;
  }

  private async startOrResume(companyId: string): Promise<PaymentCheckout> {
    const payment = (await this.payments.findOpenByCompany(companyId)) ?? (await this.createIntent(companyId));

    const remote = payment.providerRef
      ? await this.provider.retrievePayment(payment.providerRef)
      : await this.provider.createPayment({ paymentId: payment.id, companyId, amount: payment.amount });

    const saved = await this.synchronizer.apply(payment.id, remote);
    return { payment: saved, clientSecret: saved.isFinal() ? null : remote.clientSecret };
  }

  private async createIntent(companyId: string): Promise<Payment> {
    const payment = Payment.start({ companyId, provider: this.provider.name, amount: this.pricing.price });
    try {
      await this.payments.insert(payment);
      return payment;
    } catch (error) {
      if (!(error instanceof OpenPaymentAlreadyExistsError)) throw error;
      const winner = await this.payments.findOpenByCompany(companyId);
      if (!winner) throw error;
      return winner;
    }
  }
}
