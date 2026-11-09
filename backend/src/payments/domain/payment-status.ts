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
  /** Our record exists; the customer has not done anything yet. */
  CREATED = 'CREATED',
  /** The bank wants extra verification (e.g. 3-D Secure). */
  REQUIRES_ACTION = 'REQUIRES_ACTION',
  /** Submitted; the bank has not answered yet. */
  PROCESSING = 'PROCESSING',
  /** Paid. */
  SUCCEEDED = 'SUCCEEDED',
  /** The last attempt was refused (card declined, ...). The customer can retry. */
  FAILED = 'FAILED',
  /** Abandoned. */
  CANCELED = 'CANCELED',
}

/**
 * THE SPECIFICATION: for each status, the statuses it may move to.
 * Typed as Record<PaymentStatus, ...>, so adding a status without deciding its moves does not compile.
 * Staying in the same status is not a move; it is handled separately as "nothing changed".
 */
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

/** A final status has no way out: nothing can happen to the payment any more. */
export function isFinal(status: PaymentStatus): boolean {
  return ALLOWED_TRANSITIONS[status].length === 0;
}

/**
 * "Open" = not final. A company may have at most ONE open payment at a time; the database will enforce that
 * with a partial unique index (task 13), using exactly this definition.
 */
export const OPEN_STATUSES: readonly PaymentStatus[] = Object.values(PaymentStatus).filter((status) => !isFinal(status));
