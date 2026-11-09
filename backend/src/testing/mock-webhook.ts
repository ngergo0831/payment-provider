import { randomUUID } from 'node:crypto';
import { MOCK_WEBHOOK_SIGNATURE } from '../payments/infrastructure/providers/mock-payment.provider';

export function signedMockWebhook(providerRef: string, paymentId: string | null): { rawBody: Buffer; signature: string } {
  const body = { id: `evt_mock_${randomUUID()}`, type: 'mock.payment.updated', providerRef, paymentId };
  return { rawBody: Buffer.from(JSON.stringify(body)), signature: MOCK_WEBHOOK_SIGNATURE };
}
