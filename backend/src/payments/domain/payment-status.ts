/**
 * The lifecycle of one payment, independent of any provider.
 *
 *   CREATED ──► REQUIRES_ACTION ──► PROCESSING ──► SUCCEEDED   (final)
 *      │              │                  │
 *      └──────────────┴──────────────────┴──────► FAILED ──(customer retries on the SAME payment)──┐
 *                                                    ▲                                            │
 *                                                    └────────────────────────────────────────────┘
 *   CREATED / REQUIRES_ACTION / FAILED ──► CANCELED                                                  (final)
 *
 * Only SUCCEEDED and CANCELED are final. FAILED is NOT: a declined card is not the end of the payment,
 * the customer may try another card on the same provider payment. (See ADR 0003.)
 */
export enum PaymentStatus {
  CREATED = 'CREATED',
  REQUIRES_ACTION = 'REQUIRES_ACTION',
  PROCESSING = 'PROCESSING',
  SUCCEEDED = 'SUCCEEDED',
  FAILED = 'FAILED',
  CANCELED = 'CANCELED',
}

const ALLOWED_TRANSITIONS: Readonly<Record<PaymentStatus, readonly PaymentStatus[]>> = {
  [PaymentStatus.CREATED]: [
    PaymentStatus.REQUIRES_ACTION,
    PaymentStatus.PROCESSING,
    PaymentStatus.SUCCEEDED,
    PaymentStatus.FAILED,
    PaymentStatus.CANCELED,
  ],
  [PaymentStatus.REQUIRES_ACTION]: [
    PaymentStatus.PROCESSING,
    PaymentStatus.SUCCEEDED,
    PaymentStatus.FAILED,
    PaymentStatus.CANCELED,
  ],
  // Once submitted, money may be in flight: it cannot be canceled, only resolved one way or the other.
  [PaymentStatus.PROCESSING]: [PaymentStatus.SUCCEEDED, PaymentStatus.FAILED],
  [PaymentStatus.FAILED]: [
    PaymentStatus.REQUIRES_ACTION,
    PaymentStatus.PROCESSING,
    PaymentStatus.SUCCEEDED,
    PaymentStatus.CANCELED,
  ],
  [PaymentStatus.SUCCEEDED]: [],
  [PaymentStatus.CANCELED]: [],
};

export function canTransition(from: PaymentStatus, to: PaymentStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function isFinal(status: PaymentStatus): boolean {
  return ALLOWED_TRANSITIONS[status].length === 0;
}

export const OPEN_STATUSES: readonly PaymentStatus[] = Object.values(PaymentStatus).filter((status) => !isFinal(status));
