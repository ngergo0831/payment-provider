import { Injectable } from '@nestjs/common';
import { OutboxHandler } from './outbox-dispatcher';
import { PAYMENT_SUCCEEDED, PaymentSucceededPayload } from './outbox';
import { CompanyActivation } from './ports/collaborators';

/** "A payment succeeded" -> activate the company that paid. */
@Injectable()
export class PaymentSucceededHandler implements OutboxHandler {
  readonly type = PAYMENT_SUCCEEDED;

  constructor(private readonly activation: CompanyActivation) {}

  async handle(payload: unknown): Promise<void> {
    const companyId = (payload as Partial<PaymentSucceededPayload> | null | undefined)?.companyId;
    // A malformed message can never succeed: fail loudly (it will be recorded and, after the retries, left for a person).
    if (typeof companyId !== 'string') throw new Error('payment.succeeded message has no companyId');

    await this.activation.activate(companyId);
  }
}
