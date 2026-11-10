import { Controller, Get, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AuthenticatedUser, CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { ErrorResponse } from '../../common/http/error-response';
import { GetOnboardingStatusUseCase, OnboardingStep } from '../application/get-onboarding-status.use-case';
import { CompanyStatus } from '../domain/company.entity';

class CompanySummaryDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ example: 'Acme Ltd' }) name: string;
  @ApiProperty({ enum: CompanyStatus }) status: CompanyStatus;
  @ApiProperty({ type: String, format: 'date-time', nullable: true, description: 'Null until the company is active' })
  activatedAt: Date | null;
}

class OnboardingStatusDto {
  @ApiProperty({ type: CompanySummaryDto }) company: CompanySummaryDto;
  @ApiProperty({ enum: OnboardingStep, description: 'What the UI should show next' }) nextStep: OnboardingStep;
}

@ApiTags('onboarding')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('onboarding')
export class OnboardingController {
  constructor(private readonly getStatus: GetOnboardingStatusUseCase) {}

  /** Takes no id: the company comes from the token, so a caller can only ever see their own. */
  @Get('status')
  @ApiOperation({ summary: "Where is the caller's company in onboarding?" })
  @ApiOkResponse({ type: OnboardingStatusDto })
  @ApiUnauthorizedResponse({ type: ErrorResponse, description: 'UNAUTHORIZED: token missing, invalid or expired' })
  @ApiNotFoundResponse({ type: ErrorResponse, description: 'COMPANY_NOT_FOUND: the token outlived its company' })
  async status(@CurrentUser() user: AuthenticatedUser): Promise<OnboardingStatusDto> {
    const { company, nextStep } = await this.getStatus.execute(user.companyId);
    return {
      company: { id: company.id, name: company.name, status: company.status, activatedAt: company.activatedAt },
      nextStep,
    };
  }
}
