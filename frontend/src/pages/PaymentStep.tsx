import { useCallback, useEffect, useRef, useState } from "react";
import { api, toApiError, type ApiError } from "../api/client";
import {
  isSubmitted,
  type CheckoutConfig,
  type PaymentCheckout,
} from "../api/types";
import { MockCheckout, OutageToggle } from "../components/MockCheckout";
import { StripeCheckout } from "../components/StripeCheckout";
import { formatMoney } from "../format";
import type { Session } from "../session";

interface Props {
  session: Session;
  onSubmitted: (paymentId: string) => void;
  onAlreadyActive: () => void;
  onSessionExpired: () => void;
}

type State =
  | { phase: "loading" }
  | { phase: "error"; error: ApiError; config?: CheckoutConfig }
  | { phase: "ready"; config: CheckoutConfig; checkout: PaymentCheckout };

export function PaymentStep({
  session,
  onSubmitted,
  onAlreadyActive,
  onSessionExpired,
}: Props) {
  const [state, setState] = useState<State>({ phase: "loading" });
  const [outage, setOutage] = useState(false);
  const config = useRef<CheckoutConfig>(undefined);
  const latestLoad = useRef(0);

  const load = useCallback(async () => {
    const thisLoad = ++latestLoad.current;
    const isCurrent = () => thisLoad === latestLoad.current;

    const configRequest = config.current
      ? Promise.resolve(config.current)
      : api.checkoutConfig().then((fetched) => (config.current = fetched));
    try {
      const [cfg, checkout] = await Promise.all([
        configRequest,
        api.startPayment(session.token),
      ]);
      if (!isCurrent()) return;
      if (isSubmitted(checkout.payment.status))
        onSubmitted(checkout.payment.id);
      else setState({ phase: "ready", config: cfg, checkout });
    } catch (e) {
      const error = toApiError(e);
      const knownConfig = await configRequest.catch(() => undefined);

      if (!isCurrent()) return;
      if (error.status === 401) onSessionExpired();
      else if (error.code === "COMPANY_ALREADY_ACTIVE") onAlreadyActive();
      else setState({ phase: "error", error, config: knownConfig });
    }
  }, [session.token, onSubmitted, onAlreadyActive, onSessionExpired]);

  const reload = () => {
    setState({ phase: "loading" });
    void load();
  };

  useEffect(() => {
    void load();
    const loads = latestLoad;
    return () => {
      loads.current++;
    };
  }, [load]);

  if (state.phase === "loading")
    return <p role="status">Preparing your payment…</p>;

  if (state.phase === "error") {
    return (
      <section className="card">
        <p role="alert" className="form-error">
          {state.error.message}
        </p>
        {state.error.requestId && (
          <p className="hint">Reference: {state.error.requestId}</p>
        )}
        <div className="actions">
          <button type="button" onClick={reload}>
            Try again
          </button>
        </div>
        {state.config?.provider === "mock" && (
          <OutageToggle outage={outage} onChange={setOutage} />
        )}
      </section>
    );
  }

  const { config: checkoutConfig, checkout } = state;
  const { payment, clientSecret } = checkout;
  return (
    <section className="card">
      <h2>Pay for your plan</h2>
      <p className="price">{formatMoney(checkoutConfig.price)}</p>

      {payment.status === "FAILED" && (
        <p role="alert" className="form-error">
          Your last attempt failed
          {payment.failureCode
            ? ` (${payment.failureCode.replaceAll("_", " ")})`
            : ""}
          . Nothing was charged: try again or use another card.
        </p>
      )}
      {payment.status === "REQUIRES_ACTION" && (
        <p className="hint">
          Your bank needs to verify this payment. Continue below to complete it.
        </p>
      )}

      {checkoutConfig.provider === "stripe" &&
      checkoutConfig.publishableKey &&
      clientSecret ? (
        <StripeCheckout
          publishableKey={checkoutConfig.publishableKey}
          clientSecret={clientSecret}
          onSubmitted={() => onSubmitted(payment.id)}
        />
      ) : checkoutConfig.provider === "mock" && payment.providerRef ? (
        <MockCheckout
          providerRef={payment.providerRef}
          outage={outage}
          onOutageChange={setOutage}
          onSubmitted={() => onSubmitted(payment.id)}
          onNeedsAttention={reload}
        />
      ) : (
        <p role="alert" className="form-error">
          Payments are not available right now.
        </p>
      )}
    </section>
  );
}
