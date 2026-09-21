import type { Cite, Copy } from "./schema.js";

/** Platform + date + thread title. Never a message id. */
export function formatCite(cite: Cite): string {
  return `${cite.platform}, ${cite.date}, "${cite.thread}"`;
}

/** Spoken form: the date is read out, quotes are dropped. */
export function speakCite(cite: Cite): string {
  return `${cite.platform}, ${speakDate(cite.date)}, ${cite.thread}`;
}

export function formatCopy(copy: Copy): string {
  return copy.date ? `${copy.platform}, ${copy.date}, "${copy.thread}"` : `${copy.platform}, "${copy.thread}"`;
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function speakDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const month = MONTHS[(m ?? 1) - 1] ?? "";
  return `${d} ${month} ${y}`;
}
