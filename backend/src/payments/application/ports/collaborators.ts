import { Money } from '../../domain/money';

export interface BillingProfile {
  companyId: string;
  isActive: boolean;
}

export abstract class CompanyGateway {
  abstract findBillingProfile(companyId: string): Promise<BillingProfile | null>;
}

/** Payments asks onboarding to activate a company that has paid. Must be idempotent: it may be asked more than once. */
export abstract class CompanyActivation {
  abstract activate(companyId: string): Promise<void>;
}

export abstract class PlanPricing {
  abstract readonly price: Money;
}
