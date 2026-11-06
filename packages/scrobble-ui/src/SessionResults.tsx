import type { SessionResult } from "./session.ts";
import { strings } from "./strings.ts";
import { formatPlayedAt } from "./time.ts";

const s = strings.session;

function statusOf({ outcome }: SessionResult): { label: string; className: string } {
  if (outcome.status === "accepted") return { label: s.added, className: "rs-status--accepted" };
  if (outcome.status === "ignored") return { label: s.ignored, className: "rs-status--ignored" };
  return { label: s.notSent, className: "rs-status--rejected" };
}

function Corrections({ result }: { result: SessionResult }) {
  const { outcome, entry } = result;
  if (outcome.status !== "accepted") return null;
  const corrections = [
    outcome.artistCorrected && { field: s.fieldLabels.artist, from: entry.artist, to: outcome.artist },
    outcome.trackCorrected && { field: s.fieldLabels.track, from: entry.track, to: outcome.track },
  ].filter(Boolean) as { field: string; from: string; to: string }[];
  return corrections.map((c) => (
    <div className="rs-edit" key={c.field}>
      <span className="rs-label">{c.field}</span>
      <span className="rs-edit__values"><del>{c.from}</del><ins>{c.to}</ins></span>
    </div>
  ));
}

function reasonOf({ outcome, entry }: SessionResult): string {
  const time = formatPlayedAt(entry.timestamp);
  if (outcome.status === "accepted") {
    return outcome.artistCorrected || outcome.trackCorrected ? `${s.corrected} ${time}` : time;
  }
  if (outcome.status === "ignored") return s.ignoredReasons[outcome.code] ?? outcome.message;
  return s.rejectedReasons[outcome.reason] ?? outcome.reason;
}

export function SessionResults({ results }: { results: SessionResult[] }) {
  const latest = results[0];
  return (
    <section className="session" aria-labelledby="session-heading">
      <h2 id="session-heading">{s.heading}</h2>
      <p className="rs-visually-hidden" role="status">
        {latest && s.announce(`${latest.entry.artist} — ${latest.entry.track}`, statusOf(latest).label)}
      </p>
      {results.length === 0 ? (
        <p className="rs-hint">{s.empty}</p>
      ) : (
        <ul className="results rs-num">
          {results.map((result) => {
            const status = statusOf(result);
            return (
              <li key={result.id}>
                <span className="what">{result.entry.artist} — {result.entry.track}</span>
                <span className={`rs-status ${status.className}`}>{status.label}</span>
                <Corrections result={result} />
                <span className="why">{reasonOf(result)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
