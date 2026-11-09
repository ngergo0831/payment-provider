import { Body, Controller, Post } from '@nestjs/common';
import { ApiConflictResponse, ApiCreatedResponse, ApiOperation, ApiTags, ApiUnprocessableEntityResponse } from '@nestjs/swagger';
import { ErrorResponse } from '../../common/http/error-response';
import { RegisterCompanyAdminUseCase } from '../../onboarding/application/register-company-admin.use-case';
import { TokenIssuer } from '../application/token-issuer';
import { RegisterDto } from './register.dto';
import { RegisteredAccountDto } from './registered-account.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly registerCompanyAdmin: RegisterCompanyAdminUseCase,
    private readonly tokens: TokenIssuer,
  ) {}

  @Post('register')
  @ApiOperation({
    summary: 'Register a company and its first admin',
    description:
      'Creates both in one step and returns an access token. The company starts as `PENDING_PAYMENT` and becomes ' +
      '`ACTIVE` once it has paid. The example request is pre-filled; change the email to register again.',
  })
  @ApiCreatedResponse({ type: RegisteredAccountDto })
  @ApiUnprocessableEntityResponse({ type: ErrorResponse, description: 'VALIDATION_FAILED: `details` lists every bad field' })
  @ApiConflictResponse({ type: ErrorResponse, description: 'EMAIL_ALREADY_REGISTERED' })
  async register(@Body() dto: RegisterDto): Promise<RegisteredAccountDto> {
    const account = await this.registerCompanyAdmin.execute(dto);
    const token = await this.tokens.issue({
      userId: account.admin.id,
      companyId: account.company.id,
      role: account.admin.role,
    });
    return RegisteredAccountDto.from(account, token);
  }
}
