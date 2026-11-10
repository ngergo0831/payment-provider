import { Money } from '../../domain/money';

export interface BillingProfile {
  companyId: string;
  isActive: boolean;
}

/** What payments needs from onboarding. */
export abstract class CompanyGateway {
  abstract findBillingProfile(companyId: string): Promise<BillingProfile | null>;

  /** Activates a company that has paid. Must be idempotent: it may be asked more than once. */
  abstract activate(companyId: string): Promise<void>;
}

export abstract class PlanPricing {
  abstract readonly price: Money;
}
