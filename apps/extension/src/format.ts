const dateTime = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const date = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });
const count = new Intl.NumberFormat("en-GB");

export const formatPlayed = (timestamp: number) => dateTime.format(new Date(timestamp * 1000)).replace(",", "");
export const formatDate = (timestamp: number) => date.format(new Date(timestamp * 1000));
export const formatCount = (n: number) => count.format(n);

export function formatAgo(millis: number, now = Date.now()): string {
  const minutes = Math.floor((now - millis) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}

const shortSameYear = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** "5 Nov 01:39", with the year only when it isn't the current one: for narrow lists like the Preview. */
export function formatPlayedShort(timestamp: number, now = new Date()): string {
  const date = new Date(timestamp * 1000);
  return date.getFullYear() === now.getFullYear() ? shortSameYear.format(date).replace(",", "") : formatPlayed(timestamp);
}
