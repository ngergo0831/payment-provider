import { Injectable } from '@nestjs/common';
import { PaymentNotFoundException } from '../../../common/errors/exceptions';
import { Payment } from '../../domain/payment';
import { PaymentRepository } from '../ports/repositories';

@Injectable()
export class GetPaymentUseCase {
  constructor(private readonly payments: PaymentRepository) {}

  async execute(paymentId: string, companyId: string): Promise<Payment> {
    const payment = await this.payments.findById(paymentId);
    if (!payment || payment.companyId !== companyId) throw new PaymentNotFoundException();
    return payment;
  }
}
