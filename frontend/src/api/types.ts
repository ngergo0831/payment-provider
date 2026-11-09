export type CompanyStatus = 'PENDING_PAYMENT' | 'ACTIVE';

export type PaymentStatus = 'CREATED' | 'REQUIRES_ACTION' | 'PROCESSING' | 'SUCCEEDED' | 'FAILED' | 'CANCELED';

export interface Money {
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
  failureCode: string | null;
  providerRef: string | null;
  createdAt: string;
}

export interface PaymentCheckout {
  payment: Payment;
  clientSecret: string | null;
}

export interface CheckoutConfig {
  provider: 'stripe' | 'mock';
  publishableKey: string | null;
  price: Money;
}

export type MockOutcome = 'succeed' | 'decline' | 'require_action' | 'processing' | 'cancel';

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
  field: string;
  messages: string[];
}
