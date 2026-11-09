import type { RegisterFormValues } from './pages/RegisterPage';

let counter = 0;

/** Demo data for the "Fill sample data" button. The email is unique each time, so the demo can be repeated. */
export function sampleRegistration(): RegisterFormValues {
  return {
    fullName: 'Jane Doe',
    email: `jane.${Date.now().toString(36)}${++counter}@acme.example`,
    companyName: 'Acme Kft',
    country: 'HU',
    taxId: 'HU12345678',
  };
}
