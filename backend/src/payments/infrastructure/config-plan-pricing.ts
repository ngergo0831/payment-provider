import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../../config/configuration';
import { PlanPricing } from '../application/ports/collaborators';
import { Money } from '../domain/money';

/** The plan price from configuration, already validated at startup. */
@Injectable()
export class ConfigPlanPricing extends PlanPricing {
  readonly price: Money;

  constructor(config: ConfigService<AppConfig, true>) {
    super();
    const { priceMinor, currency } = config.get('payments', { infer: true }).plan;
    this.price = Money.of(priceMinor, currency);
  }
}
