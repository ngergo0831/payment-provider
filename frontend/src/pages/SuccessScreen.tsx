import type { Session } from '../session';

export function SuccessScreen({ session }: { session: Session }) {
  return (
    <section className="card">
      <h2>You're all set 🎉</h2>
      <p>
        <strong>{session.companyName}</strong> is now active, and your team can start using the product.
      </p>
    </section>
  );
}
