import { strings } from "./strings.ts";

export function Settings({ onRebuild }: { onRebuild: () => void }) {
  const s = strings.settings;
  return (
    <div className="settings">
      <h1>{s.heading}</h1>
      <section>
        <button type="button" className="rs-btn" onClick={onRebuild}>{s.rebuild}</button>
        <p className="rs-hint">{s.rebuildHint}</p>
      </section>
    </div>
  );
}
