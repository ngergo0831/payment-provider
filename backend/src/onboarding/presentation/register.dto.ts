import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsEmail, IsISO31661Alpha2, IsObject, IsOptional, IsString, Length, MaxLength, ValidateNested } from 'class-validator';
import { normalizeEmail } from '../domain/email';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const email = ({ value }: { value: unknown }) => (typeof value === 'string' ? normalizeEmail(value) : value);
const upperCase = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toUpperCase() : value);

export class CompanyDetailsDto {
  @ApiProperty({ example: 'Acme Ltd' })
  @Transform(trim)
  @IsString()
  @Length(2, 200)
  name: string;

  @ApiProperty({
    example: 'HU',
    description: 'ISO 3166-1 alpha-2 country code (case-insensitive)',
  })
  @Transform(upperCase)
  @IsISO31661Alpha2()
  country: string;

  @ApiPropertyOptional({ example: 'HU12345678' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(4, 64)
  taxId?: string;

  @ApiPropertyOptional({
    example: 'billing@acme.example',
    description: 'Receipts go here. Defaults to the admin email.',
  })
  @IsOptional()
  @Transform(email)
  @IsEmail()
  @MaxLength(320)
  billingEmail?: string;
}

export class RegisterDto {
  @ApiProperty({
    example: 'jane.doe@acme.example',
    description: 'Stored trimmed and lower-case',
  })
  @Transform(email)
  @IsEmail()
  @MaxLength(320)
  email: string;

  @ApiProperty({ example: 'Jane Doe' })
  @Transform(trim)
  @IsString()
  @Length(2, 120)
  fullName: string;

  @ApiProperty({ type: CompanyDetailsDto })
  // @ValidateNested alone is not enough: it SKIPS a missing value and validates an array element by element
  // (an empty array has none, so it passes). Either would reach the use case and end as a 500.
  // @IsObject rejects undefined, null, strings, numbers and arrays, so "company is required" is an explicit 422.
  @IsObject()
  @ValidateNested()
  @Type(() => CompanyDetailsDto)
  company: CompanyDetailsDto;
}
