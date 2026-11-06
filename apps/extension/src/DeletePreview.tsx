import { useState } from "react";
import { checkTimestamp } from "@rescrobble/core";
import type { Scrobble } from "./mirror/db.ts";
import { runDeleteJob, type TargetStatus } from "./jobs/deleteJob.ts";
import type { WebsiteGateway } from "./website/gateway.ts";
import { formatPlayedShort } from "./format.ts";
import { strings } from "./strings.ts";

const p = strings.preview;
const statusClass: Record<TargetStatus, string> = {
  queued: "rs-status--pending",
  done: "rs-status--accepted",
  notFound: "rs-status--ignored",
  failed: "rs-status--rejected",
};

interface Props {
  targets: Scrobble[];
  gateway: WebsiteGateway;
  user: string;
  onDeleted: (ids: string[]) => void;
  onClose: () => void;
}

type Phase = "preview" | "running" | "finished";

export function DeletePreview({ targets, gateway, user, onDeleted, onClose }: Props) {
  const [phase, setPhase] = useState<Phase>("preview");
  const [statuses, setStatuses] = useState<ReadonlyMap<string, TargetStatus>>(new Map());
  const [stopped, setStopped] = useState<string | null>(null);

  const [now] = useState(() => Math.floor(Date.now() / 1000));
  const irreversible = new Set(targets.filter((t) => checkTimestamp(t.timestamp, now) === "tooOld").map((t) => t.id));
  const count = p.count(targets.length);
  const tally = (status: TargetStatus) => [...statuses.values()].filter((s) => s === status).length;
  const handled = statuses.size;

  async function confirm() {
    setPhase("running");
    await runDeleteJob(gateway, user, targets, {
      onStatus: (id, status) => {
        setStatuses((current) => new Map(current).set(id, status));
        if (status === "done") onDeleted([id]);
      },
      onStopped: (reason) => setStopped(p.stopped[reason] ?? reason),
    });
    setPhase("finished");
  }

  return (
    <aside className="preview" aria-label={p.label}>
      <header>
        <h2 className="rs-num">{p.deleteHeading(count)}</h2>
        {irreversible.size > 0 && phase === "preview" && (
          <div className="rs-notice rs-notice--danger">
            <svg className="rs-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.5l6 11H2l6-11z" /><path d="M8 7v3M8 12h.01" /></svg>
            <span>{p.irreversible(irreversible.size, targets.length)}</span>
          </div>
        )}
        {phase !== "preview" && (
          <div className="rs-notice">
            <svg className="rs-icon" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6" /><path d="M8 7.5v3.5M8 5h.01" /></svg>
            <span>{p.backgroundTab}</span>
          </div>
        )}
        {stopped && (
          <div className="rs-notice rs-notice--warn" role="alert">
            <svg className="rs-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.5l6 11H2l6-11z" /><path d="M8 7v3M8 12h.01" /></svg>
            <span>{stopped}</span>
          </div>
        )}
      </header>
      <ul className="records rs-num">
        {targets.map((t) => {
          const status = statuses.get(t.id) ?? "queued";
          return (
            <li key={t.id} data-status={status}>
              <div className={status === "done" ? "rs-edit rs-edit--applied" : "rs-edit"}>
                <span className="rs-edit__meta">{formatPlayedShort(t.timestamp)}</span>
                <span className="rs-edit__values">
                  {status === "done" ? <del>{t.track}</del> : <span className="track">{t.track}</span>}
                  <span className="secondary">{t.album ? `${t.artist} · ${t.album}` : t.artist}</span>
                  {irreversible.has(t.id) && status === "queued" && <span className="rs-label irreversible">{p.irreversibleTag}</span>}
                </span>
              </div>
              <span className={`rs-status ${statusClass[status]}`} hidden={phase === "preview"}>{p.status[status]}</span>
            </li>
          );
        })}
      </ul>
      <footer>
        {phase === "finished" ? (
          <>
            <p className="rs-hint" role="status">{p.summary(tally("done"), tally("notFound"), tally("failed"))}</p>
            <button type="button" className="rs-btn rs-btn--primary rs-btn--block" onClick={onClose}>{p.close}</button>
          </>
        ) : (
          <>
            <button type="button" className="rs-btn rs-btn--danger rs-btn--block" onClick={confirm} aria-busy={phase === "running" || undefined} disabled={phase === "running"}>
              {phase === "running" ? p.deleting(handled, targets.length) : p.confirmDelete(count)}
            </button>
            {phase === "preview" && <button type="button" className="rs-btn rs-btn--quiet rs-btn--block" onClick={onClose}>{p.cancel}</button>}
          </>
        )}
      </footer>
    </aside>
  );
}
