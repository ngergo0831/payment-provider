import { Company } from '../onboarding/domain/company.entity';
import { User } from '../onboarding/domain/user.entity';
import { OutboxRecord } from '../payments/infrastructure/persistence/outbox.record';
import { PaymentRecord } from '../payments/infrastructure/persistence/payment.record';

export const ENTITIES = [Company, User, PaymentRecord, OutboxRecord];
