import { strings } from "./strings.ts";

export function SignedOut({ notice }: { notice?: string }) {
  const s = strings.signedOut;
  return (
    <main className="page signed-out">
      {notice && (
        <div className="rs-notice rs-notice--warn" role="status">
          <svg className="rs-icon" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6" /><path d="M8 7.5v3.5M8 5h.01" /></svg>
          <span>{notice}</span>
        </div>
      )}
      <h1>{s.heading}</h1>
      <p>{s.intro}</p>
      <a className="rs-btn rs-btn--primary rs-btn--block" href="/auth/login">{s.logIn}</a>
      <p className="rs-hint">{s.privacy}</p>
      <p className="extension">
        {s.extension} <span className="rs-label">{s.extensionStatus}</span>
      </p>
    </main>
  );
}
