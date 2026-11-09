import type { InputHTMLAttributes } from 'react';

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  /** The server's message for this field, shown right under the input. */
  error?: string;
}

/** A labelled input with its inline error, wired up for screen readers (aria-invalid + aria-describedby). */
export function Field({ label, error, id, ...input }: FieldProps) {
  const fieldId = id ?? input.name ?? label;
  const errorId = `${fieldId}-error`;
  return (
    <div className="field">
      <label htmlFor={fieldId}>{label}</label>
      <input id={fieldId} aria-invalid={error ? true : undefined} aria-describedby={error ? errorId : undefined} {...input} />
      {error && (
        <p id={errorId} className="field-error">
          {error}
        </p>
      )}
    </div>
  );
}
