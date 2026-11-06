import { useEffect, useState } from "react";

export const SUGGEST_MIN_CHARS = 2;
export const SUGGEST_DELAY_MS = 300;

export type Search<T> = (query: string, signal: AbortSignal) => Promise<T[]>;

/**
 * Suggestions for `query`, fetched once typing pauses. A newer query aborts the older request,
 * so a slow earlier response can never replace fresher suggestions. Failures yield no suggestions.
 */
export function useSuggestions<T>(query: string, search: Search<T>): T[] {
  const [suggestions, setSuggestions] = useState<T[]>([]);

  useEffect(() => {
    const trimmed = query.trim();
    const controller = new AbortController();
    const timer = setTimeout(() => {
      if (trimmed.length < SUGGEST_MIN_CHARS) return setSuggestions([]);
      search(trimmed, controller.signal).then(
        (found) => !controller.signal.aborted && setSuggestions(found),
        () => !controller.signal.aborted && setSuggestions([]),
      );
    }, trimmed.length < SUGGEST_MIN_CHARS ? 0 : SUGGEST_DELAY_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, search]);

  return suggestions;
}
