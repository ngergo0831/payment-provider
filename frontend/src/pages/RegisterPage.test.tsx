import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, NETWORK_ERROR } from '../api/client';
import { RegisterPage } from './RegisterPage';

afterEach(() => vi.restoreAllMocks());

const account = {
  user: { id: 'u1', email: 'jane@acme.example', fullName: 'Jane Doe', role: 'ADMIN' },
  company: { id: 'c1', name: 'Acme Kft', status: 'PENDING_PAYMENT' as const },
  accessToken: 'token-1',
};

async function fillSampleAndSubmit() {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Fill sample data' }));
  await user.click(screen.getByRole('button', { name: 'Create account' }));
}

describe('RegisterPage', () => {
  it('"Fill sample data" fills every field with a unique email each time', async () => {
    const user = userEvent.setup();
    render(<RegisterPage onRegistered={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Fill sample data' }));
    const first = (screen.getByLabelText('Work email') as HTMLInputElement).value;
    await user.click(screen.getByRole('button', { name: 'Fill sample data' }));
    const second = (screen.getByLabelText('Work email') as HTMLInputElement).value;

    expect(screen.getByLabelText('Company name')).toHaveValue('Acme Kft');
    expect(screen.getByLabelText('Country (2-letter code)')).toHaveValue('HU');
    expect(first).not.toBe(second);
  });

  it('sends what was typed and hands the session to the app', async () => {
    const register = vi.spyOn(api, 'register').mockResolvedValue(account);
    const onRegistered = vi.fn();
    render(<RegisterPage onRegistered={onRegistered} />);

    await fillSampleAndSubmit();

    expect(register).toHaveBeenCalledWith(
      expect.objectContaining({ fullName: 'Jane Doe', company: { name: 'Acme Kft', country: 'HU', taxId: 'HU12345678' } }),
    );
    expect(onRegistered).toHaveBeenCalledWith({ token: 'token-1', companyName: 'Acme Kft', email: 'jane@acme.example' });
  });

  it('leaves the tax id out of the request when it is empty', async () => {
    const register = vi.spyOn(api, 'register').mockResolvedValue(account);
    const user = userEvent.setup();
    render(<RegisterPage onRegistered={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Fill sample data' }));
    await user.clear(screen.getByLabelText('Tax ID (optional)'));
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(register).toHaveBeenCalledWith(expect.objectContaining({ company: { name: 'Acme Kft', country: 'HU' } }));
  });

  it("shows the server's validation messages next to the right inputs", async () => {
    vi.spyOn(api, 'register').mockRejectedValue(
      new ApiError(422, 'VALIDATION_FAILED', 'Request validation failed', [
        { field: 'email', messages: ['email must be an email'] },
        { field: 'company.country', messages: ['country must be a valid ISO 3166-1 alpha-2 country code'] },
      ]),
    );
    render(<RegisterPage onRegistered={vi.fn()} />);

    await userEvent.setup().click(screen.getByRole('button', { name: 'Create account' }));

    expect(screen.getByLabelText('Work email')).toHaveAccessibleDescription('email must be an email');
    expect(screen.getByLabelText('Country (2-letter code)')).toBeInvalid();
    expect(screen.getByLabelText('Full name')).toBeValid();
  });

  it('puts "email already registered" on the email field', async () => {
    vi.spyOn(api, 'register').mockRejectedValue(new ApiError(409, 'EMAIL_ALREADY_REGISTERED', 'An account with this email already exists'));
    render(<RegisterPage onRegistered={vi.fn()} />);

    await fillSampleAndSubmit();

    expect(screen.getByLabelText('Work email')).toHaveAccessibleDescription('An account with this email already exists');
  });

  it('shows a general message when the server cannot be reached, and lets the user retry', async () => {
    vi.spyOn(api, 'register').mockRejectedValueOnce(new ApiError(0, NETWORK_ERROR, 'Cannot reach the server. Check your connection and try again.'));
    render(<RegisterPage onRegistered={vi.fn()} />);

    await fillSampleAndSubmit();

    expect(screen.getByRole('alert')).toHaveTextContent('Cannot reach the server');
    expect(screen.getByRole('button', { name: 'Create account' })).toBeEnabled();
  });
});
