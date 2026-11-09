import { Injectable } from '@nestjs/common';
import { OutboxHandler } from './outbox-dispatcher';
import { PAYMENT_SUCCEEDED, PaymentSucceededPayload } from './outbox';
import { CompanyActivation } from './ports/collaborators';

@Injectable()
export class PaymentSucceededHandler implements OutboxHandler {
  readonly type = PAYMENT_SUCCEEDED;

  constructor(private readonly activation: CompanyActivation) {}

  async handle(payload: unknown): Promise<void> {
    const companyId = (payload as Partial<PaymentSucceededPayload> | null | undefined)?.companyId;
    if (typeof companyId !== 'string') throw new Error('payment.succeeded message has no companyId');

    await this.activation.activate(companyId);
  }
}
