import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { strings } from "./strings.ts";
import { useSuggestions, type Search } from "./suggestions.ts";

interface Props<T> {
  id: string;
  label: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
  search: Search<T>;
  onPick: (option: T) => void;
  optionKey: (option: T) => string;
  renderOption: (option: T) => ReactNode;
  error?: string;
  placeholder?: string;
}

/** A text field with suggestions, following the ARIA combobox pattern. Free typing always works. */
export function Combobox<T>({ id, label, name, value, onChange, search, onPick, optionKey, renderOption, error, placeholder }: Props<T>) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const options = useSuggestions(open ? value : "", search);
  const expanded = open && options.length > 0;
  const listId = `${id}-list`;
  const input = useRef<HTMLInputElement>(null);

  function pick(option: T) {
    onPick(option);
    setOpen(false);
    setActive(-1);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" && expanded) {
      event.preventDefault();
      setActive((i) => Math.min(i + 1, options.length - 1));
    } else if (event.key === "ArrowUp" && expanded) {
      event.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (event.key === "Enter" && expanded && active >= 0) {
      event.preventDefault();
      pick(options[active]!);
    } else if (event.key === "Escape" && expanded) {
      event.preventDefault();
      setOpen(false);
    }
  }

  return (
    <div className="rs-field">
      <label className="rs-label" htmlFor={id}>{label}</label>
      <div className={value ? "rs-combobox rs-combobox--filled" : "rs-combobox"}>
        <input
          ref={input}
          id={id}
          name={name}
          className="rs-input"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={expanded}
          aria-controls={listId}
          aria-activedescendant={expanded && active >= 0 ? `${listId}-${active}` : undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          autoComplete="off"
          placeholder={placeholder}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            setOpen(true);
            setActive(-1);
          }}
          onKeyDown={onKeyDown}
          onBlur={() => setOpen(false)}
        />
        {value && (
          <button
            type="button"
            className="rs-clear"
            aria-label={strings.clear(label)}
            tabIndex={-1}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              onChange("");
              setActive(-1);
              input.current?.focus();
            }}
          >
            <svg viewBox="0 0 10 10" aria-hidden="true"><path d="M1.5 1.5l7 7M8.5 1.5l-7 7" /></svg>
          </button>
        )}
        <ul className="rs-listbox" id={listId} role="listbox" aria-label={strings.suggestions(label)} hidden={!expanded}>
          {expanded && options.map((option, i) => (
            <li
              key={optionKey(option)}
              id={`${listId}-${i}`}
              className="rs-option"
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(option)}
            >
              {renderOption(option)}
            </li>
          ))}
        </ul>
      </div>
      {error && <span className="rs-hint rs-hint--error" id={`${id}-error`}>{error}</span>}
    </div>
  );
}
