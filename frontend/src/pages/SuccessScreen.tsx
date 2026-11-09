import type { Session } from '../session';

export function SuccessScreen({ session }: { session: Session }) {
  return (
    <section>
      <h2>You're all set 🎉</h2>
      <p>
        <strong>{session.companyName}</strong> is now active. Your team can start using the product ({session.email}).
      </p>
    </section>
  );
}
