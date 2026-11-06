import { strings } from "./strings.ts";

export function SignedOut() {
  const s = strings.signedOut;
  return (
    <main className="page signed-out">
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
