import { Injectable } from '@nestjs/common';
import { PaymentNotFoundException } from '../../../common/errors/payment-exceptions';
import { Payment } from '../../domain/payment';
import { PaymentRepository } from '../ports/repositories';

@Injectable()
export class GetPaymentUseCase {
  constructor(private readonly payments: PaymentRepository) {}

  /**
   * Reads our stored record (no call to the provider: it is cheap, and safe to poll).
   * Another company's payment is reported as "not found", never "forbidden": its existence is not revealed.
   */
  async execute(paymentId: string, companyId: string): Promise<Payment> {
    const payment = await this.payments.findById(paymentId);
    if (!payment || payment.companyId !== companyId) throw new PaymentNotFoundException();
    return payment;
  }
}
