import type { Shelf } from "./cabinet.js";

/**
 * The default continue pack: current + open, each with its cite, in reading order.
 * Two current lines that disagree stay two lines. Copies are pointers, not repeats.
 */
export function renderPack(shelf: Shelf, privateOnly: Shelf | null = null): string {
  const lines: string[] = [`# ${shelf.label.title} (${shelf.label.name})`];
  if (shelf.label.summary) lines.push("", shelf.label.summary);

  lines.push("", "## Current");
  if (shelf.current.length === 0) lines.push("_Nothing is current on this shelf._");
  for (const c of shelf.current) {
    lines.push(`- ${c.text}`, `  Cite: ${c.cite}${filedBy(c)}`);
    for (const copy of c.copies) lines.push(`  Also filed in: ${copy}`);
  }
  if (shelf.current.length > 1) {
    lines.push("", "_Two or more current lines. They stay separate; do not blend them._");
  }

  lines.push("", "## Open");
  if (shelf.open.length === 0) lines.push("_Nothing is open on this shelf._");
  for (const c of shelf.open) {
    lines.push(`- ${c.text}`, `  Cite: ${c.cite}${filedBy(c)}`);
    if (c.note) lines.push(`  Note: ${c.note}`);
  }

  if (shelf.superseded) {
    lines.push("", "## Superseded (dead, on request)");
    if (shelf.superseded.length === 0) lines.push("_No history on this shelf._");
    for (const c of shelf.superseded) {
      lines.push(`- [dead] ${c.text}`, `  Cite: ${c.cite}`);
      if (c.replaced) lines.push(`  ${capitalize(c.replaced)}`);
    }
  } else if (shelf.historyNote) {
    lines.push("", `_${shelf.historyNote}_`);
  }

  if (privateOnly) {
    lines.push("", "## From your private cabinet (not on this card)");
    for (const c of privateOnly.current) lines.push(`- [current, private] ${c.text}`, `  Cite: ${c.cite}`);
    for (const c of privateOnly.open) {
      lines.push(`- [open, private] ${c.text}`, `  Cite: ${c.cite}`);
      if (c.note) lines.push(`  Note: ${c.note}`);
    }
    for (const c of privateOnly.superseded ?? []) lines.push(`- [dead, private] ${c.text}`, `  Cite: ${c.cite}`);
  }
  return lines.join("\n");
}

function filedBy(c: { filedBy?: string }): string {
  return c.filedBy ? ` (filed by ${c.filedBy})` : "";
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
