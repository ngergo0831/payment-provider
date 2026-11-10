import { Module } from '@nestjs/common';
import { PaymentsModule } from './payments.module';
import { MockPaymentsDevController } from './presentation/mock-payments-dev.controller';

@Module({
  imports: [PaymentsModule],
  controllers: [MockPaymentsDevController],
})
export class MockPaymentsDevModule {}
