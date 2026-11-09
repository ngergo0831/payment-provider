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

/** Everything goes through one prefix: Vite's dev proxy (and the production reverse proxy) forwards it to the backend. */
const BASE = '/api';

/** The browser could not reach the web server at all (offline, server down): there is no HTTP response to read. */
export const NETWORK_ERROR = 'NETWORK_ERROR';
/**
 * The web server answered, but the API behind it did not (a proxy's 502/503/504 page, e.g. the API is restarting).
 * Our own API always answers with a JSON error envelope, so a gateway status WITHOUT one means "the API is not there".
 */
export const SERVER_UNAVAILABLE = 'SERVER_UNAVAILABLE';

const GATEWAY_STATUSES = new Set([502, 503, 504]);

/**
 * The ONE error type the UI deals with. Every failure, whether a validation problem, an outage or a dropped
 * connection, arrives in this shape, so screens have a single place to look.
 */
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

  /** We could not talk to the API at all. Nothing was processed, so it is always safe to try again. */
  get unreachable(): boolean {
    return this.code === NETWORK_ERROR || this.code === SERVER_UNAVAILABLE;
  }

  /** Field path -> first message, for showing errors next to the inputs. */
  get fieldMessages(): Record<string, string> {
    return Object.fromEntries(this.details.map((d) => [d.field, d.messages[0]]));
  }
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

  // The backend's error envelope: { statusCode, code, message, details?, requestId }. A proxy error page is not JSON.
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
  /** Starts a payment, or resumes the open one: safe to call again (a double click, a page reload). */
  startPayment: (token: string) => request<PaymentCheckout>('POST', '/payments', { token }),
  getPayment: (token: string, id: string) => request<Payment>('GET', `/payments/${id}`, { token }),

  /** Mock provider only (the backend answers 404 for these with Stripe or in production). */
  simulatePayment: (providerRef: string, outcome: MockOutcome, deliverWebhook = true) =>
    request<{ webhook: string }>('POST', `/dev/mock-payments/${providerRef}/simulate`, { body: { outcome, deliverWebhook } }),
  setMockOutage: (enabled: boolean) => request<{ outage: boolean }>('POST', '/dev/mock-payments/outage', { body: { enabled } }),
};
