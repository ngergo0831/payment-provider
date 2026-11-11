import type { InputHTMLAttributes } from 'react';

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  name: string;
  label: string;
  error?: string;
}

export function Field({ label, error, ...input }: FieldProps) {
  const errorId = `${input.name}-error`;
  return (
    <div className="field">
      <label htmlFor={input.name}>{label}</label>
      <input id={input.name} aria-invalid={error ? true : undefined} aria-describedby={error ? errorId : undefined} {...input} />
      {error && (
        <p id={errorId} className="field-error">
          {error}
        </p>
      )}
    </div>
  );
}
