import { Company } from '../onboarding/domain/company.entity';
import { User } from '../onboarding/domain/user.entity';

/**
 * Every ORM entity, listed explicitly (no folder globs, which behave differently under ts-node, Jest and the
 * compiled build). Each feature adds its entities here together with its migration.
 */
export const ENTITIES: Function[] = [Company, User];
