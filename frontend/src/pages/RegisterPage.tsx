import { type ChangeEvent, type FormEvent, useState } from 'react';
import { api, ApiError } from '../api/client';
import { Field } from '../components/Field';
import { sampleRegistration } from '../sampleData';
import type { Session } from '../session';

export interface RegisterFormValues {
  fullName: string;
  email: string;
  companyName: string;
  country: string;
  taxId: string;
}

const EMPTY: RegisterFormValues = { fullName: '', email: '', companyName: '', country: '', taxId: '' };

/** Which server field each input belongs to, so the backend's `details` can be shown next to the right input. */
const SERVER_FIELD: Record<keyof RegisterFormValues, string> = {
  fullName: 'fullName',
  email: 'email',
  companyName: 'company.name',
  country: 'company.country',
  taxId: 'company.taxId',
};

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
    error: fieldErrors[SERVER_FIELD[name]],
    onChange: (event: ChangeEvent<HTMLInputElement>) => setValues({ ...values, [name]: event.target.value }),
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
      onRegistered({ token: account.accessToken, companyName: account.company.name, email: account.user.email });
    } catch (error) {
      showError(error);
    } finally {
      setSubmitting(false);
    }
  }

  function showError(error: unknown) {
    if (!(error instanceof ApiError)) throw error;
    if (error.code === 'EMAIL_ALREADY_REGISTERED') setFieldErrors({ email: error.message });
    else if (error.details.length > 0) setFieldErrors(error.fieldMessages);
    else setFormError(error.message);
  }

  return (
    <form onSubmit={submit} noValidate aria-labelledby="register-title">
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
