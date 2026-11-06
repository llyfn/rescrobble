import { useSessionResults } from "./session.ts";
import { SessionResults } from "./SessionResults.tsx";
import { strings } from "./strings.ts";
import { TrackForm } from "./TrackForm.tsx";

export function SignedIn() {
  const session = useSessionResults();
  return (
    <main className="page">
      <h1>{strings.signedIn.heading}</h1>
      <TrackForm onResults={session.add} />
      <SessionResults results={session.results} />
    </main>
  );
}
