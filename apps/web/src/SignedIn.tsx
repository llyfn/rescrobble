import { strings } from "./strings.ts";

export function SignedIn() {
  return (
    <main className="page">
      <h1>{strings.signedIn.heading}</h1>
    </main>
  );
}
