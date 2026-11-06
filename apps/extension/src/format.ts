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
