import { Money } from '../../domain/money';

export interface BillingProfile {
  companyId: string;
  isActive: boolean;
}

export abstract class CompanyGateway {
  abstract findBillingProfile(companyId: string): Promise<BillingProfile | null>;
  abstract activate(companyId: string): Promise<void>;
}

export abstract class PlanPricing {
  abstract readonly price: Money;
}
