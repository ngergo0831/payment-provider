import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { ThrottlerGuard } from '@nestjs/throttler';
import { AuthTokenService } from '../../auth/auth-token.service';
import { ErrorResponse } from '../../common/http/error-response';
import { RegisterCompanyAdminUseCase } from '../application/register-company-admin.use-case';
import { RegisterDto } from './register.dto';
import { RegisteredAccountDto } from './registered-account.dto';

@ApiTags('auth')
@Controller('auth')
export class RegistrationController {
  constructor(
    private readonly registerCompanyAdmin: RegisterCompanyAdminUseCase,
    private readonly tokens: AuthTokenService,
  ) {}

  @Post('register')
  @UseGuards(ThrottlerGuard)
  @ApiOperation({
    summary: 'Register a company and its first admin',
    description:
      'Creates both in one step and returns an access token. The company starts as `PENDING_PAYMENT` and becomes ' +
      '`ACTIVE` once it has paid. The example request is pre-filled; change the email to register again.',
  })
  @ApiCreatedResponse({ type: RegisteredAccountDto })
  @ApiUnprocessableEntityResponse({ type: ErrorResponse, description: 'VALIDATION_FAILED: `details` lists every bad field' })
  @ApiConflictResponse({ type: ErrorResponse, description: 'EMAIL_ALREADY_REGISTERED' })
  @ApiTooManyRequestsResponse({ type: ErrorResponse, description: 'TOO_MANY_REQUESTS: retry in a minute' })
  async register(@Body() dto: RegisterDto): Promise<RegisteredAccountDto> {
    const account = await this.registerCompanyAdmin.execute(dto);
    const accessToken = await this.tokens.issue({ userId: account.admin.id, companyId: account.company.id });
    return RegisteredAccountDto.from(account, accessToken);
  }
}
