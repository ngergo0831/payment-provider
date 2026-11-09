import { ValidationError, ValidationPipe } from '@nestjs/common';
import { FieldError } from '../errors/domain.exception';
import { ValidationFailedException } from '../errors/validation-failed.exception';

/** Flattens class-validator's nested error tree into `[{ field: 'company.name', messages: [...] }]`. */
function flatten(errors: ValidationError[], parent = ''): FieldError[] {
  return errors.flatMap((error) => {
    const field = parent ? `${parent}.${error.property}` : error.property;
    const own = error.constraints ? [{ field, messages: Object.values(error.constraints) }] : [];
    return [...own, ...flatten(error.children ?? [], field)];
  });
}

/**
 * Global input validation for every DTO:
 * - whitelist + forbidNonWhitelisted: unknown fields are REJECTED, not silently ignored
 *   (a typo like `emial` fails loudly; a client cannot smuggle in `role: "ADMIN"`)
 * - transform: bodies become real DTO class instances, with types converted
 * - failures become our own ValidationFailedException -> 422 with field-level details
 */
export const createValidationPipe = (): ValidationPipe =>
  new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    exceptionFactory: (errors) => new ValidationFailedException(flatten(errors)),
  });
