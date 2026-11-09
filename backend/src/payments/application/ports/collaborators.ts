import { Money } from '../../domain/money';

/** Payments sees only the slice of "company" it needs (an anti-corruption layer): not the whole Company entity. */
export interface BillingProfile {
  companyId: string;
  isActive: boolean;
}

export abstract class CompanyGateway {
  abstract findBillingProfile(companyId: string): Promise<BillingProfile | null>;
}

/** What a company is charged. One fixed plan in this slice; a pricing service would implement this in a real product. */
export abstract class PlanPricing {
  abstract readonly price: Money;
}
