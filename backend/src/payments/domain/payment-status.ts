/**
 * The lifecycle of one payment, independent of any provider.
 *
 *   CREATED ──► REQUIRES_ACTION ──► PROCESSING ──► SUCCEEDED   (final)
 *      │              │                  │
 *      └──────────────┴──────────────────┴──────► FAILED ──(customer retries on the same payment)──┐
 *                                                    ▲                                            │
 *                                                    └────────────────────────────────────────────┘
 *   CREATED / REQUIRES_ACTION / FAILED ──► CANCELED                                                  (final)
 *
 * Only SUCCEEDED and CANCELED are final. FAILED is not: a declined card is not the end of the payment,
 * the customer may try another card on the same provider payment. (See docs/DESIGN.md.)
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
  [PaymentStatus.REQUIRES_ACTION]: [PaymentStatus.PROCESSING, PaymentStatus.SUCCEEDED, PaymentStatus.FAILED, PaymentStatus.CANCELED],
  [PaymentStatus.PROCESSING]: [PaymentStatus.SUCCEEDED, PaymentStatus.FAILED],
  [PaymentStatus.FAILED]: [PaymentStatus.REQUIRES_ACTION, PaymentStatus.PROCESSING, PaymentStatus.SUCCEEDED, PaymentStatus.CANCELED],
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

/**
 * A company holds at most one payment in these statuses: the one in progress, or the one that already paid.
 * SUCCEEDED is included because activation happens after the payment is saved, and until then the company still
 * looks unpaid; without it a second checkout could be started in that window.
 */
export const LIVE_STATUSES: readonly PaymentStatus[] = Object.values(PaymentStatus).filter((status) => status !== PaymentStatus.CANCELED);
