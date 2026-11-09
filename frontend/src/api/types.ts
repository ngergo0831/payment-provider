// The shapes the backend returns. Kept in step with the presentation DTOs in the backend (and Swagger at /docs).

export type CompanyStatus = 'PENDING_PAYMENT' | 'ACTIVE';

export type PaymentStatus = 'CREATED' | 'REQUIRES_ACTION' | 'PROCESSING' | 'SUCCEEDED' | 'FAILED' | 'CANCELED';

export interface Money {
  /** Integer minor units (cents). Never a decimal. */
  amountMinor: number;
  currency: string;
}

export interface RegisterRequest {
  email: string;
  fullName: string;
  company: { name: string; country: string; taxId?: string; billingEmail?: string };
}

export interface RegisteredAccount {
  user: { id: string; email: string; fullName: string; role: string };
  company: { id: string; name: string; status: CompanyStatus };
  accessToken: string;
}

export interface OnboardingStatus {
  company: { id: string; name: string; status: CompanyStatus; activatedAt: string | null };
  nextStep: 'PAYMENT' | 'DONE';
}

export interface Payment {
  id: string;
  status: PaymentStatus;
  amount: Money;
  /** Why the last attempt failed, e.g. `card_declined`; null otherwise. */
  failureCode: string | null;
  providerRef: string | null;
  createdAt: string;
}

export interface PaymentCheckout {
  payment: Payment;
  /** For the provider's browser SDK. Null when the payment is already final. */
  clientSecret: string | null;
}

export interface CheckoutConfig {
  provider: 'stripe' | 'mock';
  /** Stripe's publishable key (safe to expose); null for the mock. */
  publishableKey: string | null;
  price: Money;
}

/** What the fake customer / bank can do in mock mode (dev endpoints only). */
export type MockOutcome = 'succeed' | 'decline' | 'require_action' | 'processing' | 'cancel';

/** Mirrors the backend's ErrorCode enum. Branch on this, never on the message. */
export type ErrorCode =
  | 'VALIDATION_FAILED'
  | 'BAD_REQUEST'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'EMAIL_ALREADY_REGISTERED'
  | 'COMPANY_NOT_FOUND'
  | 'COMPANY_ALREADY_ACTIVE'
  | 'PAYMENT_NOT_FOUND'
  | 'PAYMENT_PROVIDER_UNAVAILABLE'
  | 'PAYMENT_PROVIDER_ERROR'
  | 'INVALID_WEBHOOK_SIGNATURE'
  | 'INTERNAL_ERROR';

export interface FieldError {
  /** Path to the field; nested fields use dots, e.g. `company.name`. */
  field: string;
  messages: string[];
}
