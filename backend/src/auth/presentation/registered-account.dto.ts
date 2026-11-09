import { ApiProperty } from '@nestjs/swagger';
import { RegisteredAccount } from '../../onboarding/application/register-company-admin.use-case';
import { CompanyStatus } from '../../onboarding/domain/company.entity';
import { UserRole } from '../../onboarding/domain/user.entity';
import { IssuedToken } from '../application/token-issuer';

class RegisteredUserDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ example: 'jane.doe@acme.example' }) email: string;
  @ApiProperty({ example: 'Jane Doe' }) fullName: string;
  @ApiProperty({ enum: UserRole }) role: UserRole;
}

class RegisteredCompanyDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ example: 'Acme Ltd' }) name: string;
  @ApiProperty({ enum: CompanyStatus, example: CompanyStatus.PENDING_PAYMENT, description: 'Becomes ACTIVE after payment' })
  status: CompanyStatus;
}

/** What the API returns, built field by field: entities are never serialised directly, so no column leaks by accident. */
export class RegisteredAccountDto {
  @ApiProperty({ type: RegisteredUserDto }) user: RegisteredUserDto;
  @ApiProperty({ type: RegisteredCompanyDto }) company: RegisteredCompanyDto;

  @ApiProperty({ description: 'Send as `Authorization: Bearer <accessToken>`. In Swagger: click Authorize and paste it.' })
  accessToken: string;

  @ApiProperty({ example: 'Bearer' })
  tokenType: 'Bearer';

  static from({ admin, company }: RegisteredAccount, token: IssuedToken): RegisteredAccountDto {
    return {
      user: { id: admin.id, email: admin.email, fullName: admin.fullName, role: admin.role },
      company: { id: company.id, name: company.name, status: company.status },
      ...token,
    };
  }
}
