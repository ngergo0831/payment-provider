import { Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import {
  ApiBadGatewayResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AuthenticatedUser } from '../../auth/domain/authenticated-user';
import { CurrentUser } from '../../auth/presentation/current-user.decorator';
import { JwtAuthGuard } from '../../auth/presentation/jwt-auth.guard';
import { ErrorResponse } from '../../common/http/error-response';
import { GetPaymentUseCase } from '../application/use-cases/get-payment.use-case';
import { StartPaymentUseCase } from '../application/use-cases/start-payment.use-case';
import { PaymentCheckoutDto, PaymentDto } from './payments.dto';

@ApiTags('payments')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('payments')
export class PaymentsController {
  constructor(
    private readonly startPayment: StartPaymentUseCase,
    private readonly getPayment: GetPaymentUseCase,
  ) {}

  /**
   * 200, not 201, even on first use: the same call "starts or resumes", and a client should not need to know which.
   * The company always comes from the token: a caller cannot start a payment for someone else.
   */
  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Start paying for the plan, or resume the payment already in progress',
    description:
      'Idempotent: calling it again returns the same open payment (and the same `clientSecret`), so a double click, a page ' +
      'reload, a retry after a declined card, or a retry after an outage are all safe. A company never has two open payments. ' +
      'The account is activated later, after the provider confirms the payment; this call only starts it.',
  })
  @ApiOkResponse({ type: PaymentCheckoutDto })
  @ApiUnauthorizedResponse({ type: ErrorResponse, description: 'UNAUTHORIZED' })
  @ApiConflictResponse({ type: ErrorResponse, description: 'COMPANY_ALREADY_ACTIVE: nothing to pay' })
  @ApiNotFoundResponse({ type: ErrorResponse, description: 'COMPANY_NOT_FOUND: the token outlived its company' })
  @ApiServiceUnavailableResponse({ type: ErrorResponse, description: 'PAYMENT_PROVIDER_UNAVAILABLE: nothing was charged; retry shortly' })
  @ApiBadGatewayResponse({ type: ErrorResponse, description: 'PAYMENT_PROVIDER_ERROR: the provider rejected our request' })
  async start(@CurrentUser() user: AuthenticatedUser): Promise<PaymentCheckoutDto> {
    return PaymentCheckoutDto.from(await this.startPayment.execute(user.companyId));
  }

  @Get(':id')
  @ApiOperation({ summary: 'Current status of one payment (cheap to poll)', description: 'Reads our stored record; the provider is not called.' })
  @ApiOkResponse({ type: PaymentDto })
  @ApiUnauthorizedResponse({ type: ErrorResponse, description: 'UNAUTHORIZED' })
  @ApiNotFoundResponse({ type: ErrorResponse, description: "PAYMENT_NOT_FOUND (also returned for another company's payment)" })
  async get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser): Promise<PaymentDto> {
    return PaymentDto.from(await this.getPayment.execute(id, user.companyId));
  }
}
