import type { RegisterFormValues } from './pages/RegisterPage';

let counter = 0;

export function sampleRegistration(): RegisterFormValues {
  return {
    fullName: 'Jane Doe',
    email: `jane.${Date.now().toString(36)}${++counter}@acme.example`,
    companyName: 'Acme Kft',
    country: 'HU',
    taxId: 'HU12345678',
  };
}
