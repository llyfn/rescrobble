/** The value a datetime-local input uses for this moment, in local time, to the minute. */
export function toLocalInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Unix seconds for a datetime-local value, or null when it isn't a complete date and time. */
export function fromLocalInputValue(value: string): number | null {
  const millis = new Date(value).getTime();
  return Number.isNaN(millis) ? null : Math.floor(millis / 1000);
}

export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export function formatPlayedAt(timestamp: number, now = new Date()): string {
  const date = new Date(timestamp * 1000);
  const time = date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  if (date.toDateString() === now.toDateString()) return `Today ${time}`;
  return `${date.toLocaleDateString("en-GB", { day: "numeric", month: "short" })} ${time}`;
}
