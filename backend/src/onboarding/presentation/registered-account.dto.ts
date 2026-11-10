import { ApiProperty } from '@nestjs/swagger';
import { RegisteredAccount } from '../application/register-company-admin.use-case';
import { CompanyStatus } from '../domain/company.entity';

class RegisteredUserDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ example: 'jane.doe@acme.example' }) email: string;
  @ApiProperty({ example: 'Jane Doe' }) fullName: string;
}

class RegisteredCompanyDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ example: 'Acme Ltd' }) name: string;
  @ApiProperty({ enum: CompanyStatus, example: CompanyStatus.PENDING_PAYMENT, description: 'Becomes ACTIVE after payment' })
  status: CompanyStatus;
}

export class RegisteredAccountDto {
  @ApiProperty({ type: RegisteredUserDto }) user: RegisteredUserDto;
  @ApiProperty({ type: RegisteredCompanyDto }) company: RegisteredCompanyDto;

  @ApiProperty({ description: 'Send as `Authorization: Bearer <accessToken>`. In Swagger: click Authorize and paste it.' })
  accessToken: string;

  @ApiProperty({ example: 'Bearer' })
  tokenType: 'Bearer';

  static from({ admin, company }: RegisteredAccount, accessToken: string): RegisteredAccountDto {
    return {
      user: { id: admin.id, email: admin.email, fullName: admin.fullName },
      company: { id: company.id, name: company.name, status: company.status },
      accessToken,
      tokenType: 'Bearer',
    };
  }
}
