import { type ChangeEvent, type FormEvent, useState } from 'react';
import { api, toApiError } from '../api/client';
import { Field } from '../components/Field';
import type { Session } from '../session';

interface RegisterFormValues {
  fullName: string;
  email: string;
  companyName: string;
  country: string;
  taxId: string;
}

const EMPTY: RegisterFormValues = { fullName: '', email: '', companyName: '', country: '', taxId: '' };

const SERVER_FIELD: Partial<Record<keyof RegisterFormValues, string>> = {
  companyName: 'company.name',
  country: 'company.country',
  taxId: 'company.taxId',
};

let sampleCount = 0;
function sampleRegistration(): RegisterFormValues {
  return {
    fullName: 'Jane Doe',
    email: `jane.${Date.now().toString(36)}${++sampleCount}@acme.example`,
    companyName: 'Acme Kft',
    country: 'HU',
    taxId: 'HU12345678',
  };
}

interface Props {
  onRegistered: (session: Session) => void;
}

export function RegisterPage({ onRegistered }: Props) {
  const [values, setValues] = useState(EMPTY);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  const bind = (name: keyof RegisterFormValues) => ({
    name,
    value: values[name],
    error: fieldErrors[SERVER_FIELD[name] ?? name],
    onChange: (event: ChangeEvent<HTMLInputElement>) => {
      const { value } = event.target;
      setValues((current) => ({ ...current, [name]: value }));
    },
  });

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setFieldErrors({});
    setFormError(undefined);
    try {
      const account = await api.register({
        email: values.email,
        fullName: values.fullName,
        company: { name: values.companyName, country: values.country, ...(values.taxId ? { taxId: values.taxId } : {}) },
      });
      onRegistered({ token: account.accessToken, companyName: account.company.name });
    } catch (e) {
      const error = toApiError(e);
      if (error.code === 'EMAIL_ALREADY_REGISTERED') setFieldErrors({ email: error.message });
      else if (error.details.length > 0) setFieldErrors(error.fieldMessages);
      else setFormError(error.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="card" onSubmit={(event) => void submit(event)} noValidate aria-labelledby="register-title">
      <h2 id="register-title">Create your account</h2>
      <p className="hint">Register your business to get started. Payment comes next.</p>

      <Field label="Full name" autoComplete="name" {...bind('fullName')} />
      <Field label="Work email" type="email" autoComplete="email" {...bind('email')} />
      <Field label="Company name" autoComplete="organization" {...bind('companyName')} />
      <Field label="Country (2-letter code)" placeholder="HU" maxLength={2} {...bind('country')} />
      <Field label="Tax ID (optional)" {...bind('taxId')} />

      {formError && <p role="alert" className="form-error">{formError}</p>}

      <div className="actions">
        <button type="submit" disabled={submitting}>
          {submitting ? 'Creating account…' : 'Create account'}
        </button>
        <button type="button" className="secondary" onClick={() => setValues(sampleRegistration())}>
          Fill sample data
        </button>
      </div>
    </form>
  );
}
