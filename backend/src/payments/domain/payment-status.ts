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

export const LIVE_STATUSES: readonly PaymentStatus[] = Object.values(PaymentStatus).filter((status) => status !== PaymentStatus.CANCELED);
