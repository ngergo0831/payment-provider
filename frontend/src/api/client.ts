import type {
  CheckoutConfig,
  ErrorCode,
  FieldError,
  MockOutcome,
  OnboardingStatus,
  Payment,
  PaymentCheckout,
  RegisteredAccount,
  RegisterRequest,
} from './types';

const BASE = '/api';

export const NETWORK_ERROR = 'NETWORK_ERROR';
export const SERVER_UNAVAILABLE = 'SERVER_UNAVAILABLE';

// Our API always answers with a JSON error envelope, so a gateway status without one means the API is not there.
const GATEWAY_STATUSES = new Set([502, 503, 504]);

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode | typeof NETWORK_ERROR | typeof SERVER_UNAVAILABLE,
    message: string,
    readonly details: FieldError[] = [],
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  get unreachable(): boolean {
    return this.code === NETWORK_ERROR || this.code === SERVER_UNAVAILABLE;
  }

  get fieldMessages(): Record<string, string> {
    return Object.fromEntries(this.details.map((d) => [d.field, d.messages[0]]));
  }
}

export function toApiError(error: unknown): ApiError {
  return error instanceof ApiError ? error : new ApiError(0, 'INTERNAL_ERROR', 'Something went wrong. Please try again.');
}

interface RequestOptions {
  body?: unknown;
  token?: string;
}

async function request<T>(method: 'GET' | 'POST', path: string, { body, token }: RequestOptions = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(BASE + path, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, NETWORK_ERROR, 'Cannot reach the server. Check your internet connection and try again.');
  }

  const payload: unknown = await response.json().catch(() => null);
  if (response.ok) return payload as T;

  const error = (payload ?? {}) as Partial<{ code: ErrorCode; message: string; details: FieldError[]; requestId: string }>;
  if (!error.code && GATEWAY_STATUSES.has(response.status)) {
    throw new ApiError(
      response.status,
      SERVER_UNAVAILABLE,
      'The service is temporarily unavailable. If you were paying, your payment is safe. Please try again in a moment.',
    );
  }
  throw new ApiError(
    response.status,
    error.code ?? 'INTERNAL_ERROR',
    error.message ?? 'Something went wrong. Please try again.',
    error.details,
    error.requestId,
  );
}

export const api = {
  register: (data: RegisterRequest) => request<RegisteredAccount>('POST', '/auth/register', { body: data }),
  checkoutConfig: () => request<CheckoutConfig>('GET', '/checkout-config'),
  onboardingStatus: (token: string) => request<OnboardingStatus>('GET', '/onboarding/status', { token }),
  // Starts a payment, or resumes the open one: safe to call again.
  startPayment: (token: string) => request<PaymentCheckout>('POST', '/payments', { token }),
  getPayment: (token: string, id: string) => request<Payment>('GET', `/payments/${id}`, { token }),

  simulatePayment: (providerRef: string, outcome: MockOutcome, deliverWebhook = true) =>
    request<{ webhook: string }>('POST', `/dev/mock-payments/${providerRef}/simulate`, { body: { outcome, deliverWebhook } }),
  setMockOutage: (enabled: boolean) => request<{ outage: boolean }>('POST', '/dev/mock-payments/outage', { body: { enabled } }),
};
