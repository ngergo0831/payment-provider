import { CompanyActivation } from './ports/collaborators';
import { PAYMENT_SUCCEEDED } from './outbox';
import { PaymentSucceededHandler } from './payment-succeeded.handler';

class RecordingActivation extends CompanyActivation {
  readonly activated: string[] = [];
  async activate(companyId: string): Promise<void> {
    this.activated.push(companyId);
  }
}

describe('PaymentSucceededHandler', () => {
  it('handles the payment.succeeded message type', () => {
    expect(new PaymentSucceededHandler(new RecordingActivation()).type).toBe(PAYMENT_SUCCEEDED);
  });

  it('activates the company named in the message', async () => {
    const activation = new RecordingActivation();

    await new PaymentSucceededHandler(activation).handle({ paymentId: 'p1', companyId: 'company-7' });

    expect(activation.activated).toEqual(['company-7']);
  });

  it.each([[null], [undefined], [{}], [{ paymentId: 'p1' }], [{ companyId: 42 }], ['text']])(
    'refuses a malformed message %j instead of activating nobody silently',
    async (payload) => {
      const activation = new RecordingActivation();
      await expect(new PaymentSucceededHandler(activation).handle(payload)).rejects.toThrow(/no companyId/);
      expect(activation.activated).toEqual([]);
    },
  );
});
