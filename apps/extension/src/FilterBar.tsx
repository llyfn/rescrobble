import { useId, useState, type FormEvent, type ReactNode } from "react";
import { conditionError, type Condition, type TextField, type TextMode } from "@rescrobble/core";
import { formatPlayed } from "./format.ts";
import { strings } from "./strings.ts";

const f = strings.filters;
type FieldChoice = TextField | "played" | "duplicates";

export function chipText(c: Condition): string {
  if (c.kind === "text") {
    const base = f.chipText(f.fields[c.field], f.modes[c.mode], c.mode === "empty" ? "" : c.value);
    return c.caseSensitive && c.mode !== "empty" ? `${base} (${f.chipCase})` : base;
  }
  if (c.kind === "dateRange") return f.chipDates(c.from === null ? null : formatPlayed(c.from), c.to === null ? null : formatPlayed(c.to));
  return f.chipDuplicates(c.withinSeconds);
}

const toSeconds = (value: string) => (value ? Math.floor(new Date(value).getTime() / 1000) : null);

function Editor({ onAdd, onCancel }: { onAdd: (c: Condition) => void; onCancel: () => void }) {
  const id = useId();
  const [field, setField] = useState<FieldChoice>("track");
  const [mode, setMode] = useState<TextMode>("contains");
  const [value, setValue] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [within, setWithin] = useState("30");

  function submit(event: FormEvent) {
    event.preventDefault();
    if (field === "played") return onAdd({ kind: "dateRange", from: toSeconds(from), to: toSeconds(to) });
    if (field === "duplicates") return onAdd({ kind: "duplicates", withinSeconds: Math.max(0, Number(within) || 0) });
    onAdd({ kind: "text", field, mode, value, caseSensitive });
  }

  const labelled = (key: string, label: string, control: ReactNode) => (
    <div className="rs-field">
      <label className="rs-label" htmlFor={`${id}-${key}`}>{label}</label>
      {control}
    </div>
  );

  return (
    <form className="filter-editor" aria-label={f.editorLabel} onSubmit={submit}>
      {labelled("field", f.field, (
        <select id={`${id}-field`} className="rs-select" value={field} onChange={(e) => setField(e.target.value as FieldChoice)}>
          {(Object.keys(f.fields) as FieldChoice[]).map((k) => <option key={k} value={k}>{f.fields[k]}</option>)}
        </select>
      ))}
      {(field === "artist" || field === "track" || field === "album") && (
        <>
          {labelled("mode", f.mode, (
            <select id={`${id}-mode`} className="rs-select" value={mode} onChange={(e) => setMode(e.target.value as TextMode)}>
              {(Object.keys(f.modes) as TextMode[]).map((k) => <option key={k} value={k}>{f.modes[k]}</option>)}
            </select>
          ))}
          {mode !== "empty" && labelled("value", f.value, (
            <input id={`${id}-value`} className="rs-input" value={value} onChange={(e) => setValue(e.target.value)} autoComplete="off" />
          ))}
          {mode !== "empty" && (
            <label className="case">
              <input className="rs-check" type="checkbox" checked={caseSensitive} onChange={(e) => setCaseSensitive(e.target.checked)} />
              {f.caseSensitive}
            </label>
          )}
        </>
      )}
      {field === "played" && (
        <>
          {labelled("from", f.from, <input id={`${id}-from`} className="rs-input rs-num" type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} />)}
          {labelled("to", f.to, <input id={`${id}-to`} className="rs-input rs-num" type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} />)}
        </>
      )}
      {field === "duplicates" && labelled("within", f.within, (
        <input id={`${id}-within`} className="rs-input rs-num" type="number" min="0" value={within} onChange={(e) => setWithin(e.target.value)} />
      ))}
      <div className="actions">
        <button type="submit" className="rs-btn rs-btn--primary">{f.apply}</button>
        <button type="button" className="rs-btn rs-btn--quiet" onClick={onCancel}>{f.cancel}</button>
      </div>
    </form>
  );
}

export function FilterBar({ conditions, onChange }: { conditions: Condition[]; onChange: (next: Condition[]) => void }) {
  const [editing, setEditing] = useState(false);
  return (
    <div className="filters">
      <div className="chips" role="group" aria-label={f.label}>
        {conditions.map((c, i) => {
          const error = conditionError(c);
          const text = chipText(c);
          return (
            <span key={i} className={`rs-chip${error ? " invalid" : ""}`} title={error ? f.invalid(error) : undefined}>
              <span>{text}</span>
              <button type="button" className="rs-chip__remove" aria-label={f.remove(text)} onClick={() => onChange(conditions.filter((_, j) => j !== i))}>
                <svg className="rs-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" /></svg>
              </button>
              {error && <span className="rs-hint rs-hint--error chip-error" role="alert">{f.invalid(error)}</span>}
            </span>
          );
        })}
        {!editing && (
          <button type="button" className="rs-chip rs-chip--add" onClick={() => setEditing(true)}>
            <svg className="rs-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10" /></svg>
            {f.add}
          </button>
        )}
      </div>
      {editing && (
        <Editor
          onAdd={(c) => {
            onChange([...conditions, c]);
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      )}
    </div>
  );
}
