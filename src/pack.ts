import type { Shelf } from "./cabinet.js";

/**
 * The default continue pack: current + open, each with its cite, in reading order.
 * Two current lines that disagree stay two lines. Copies are pointers, not repeats.
 */
export function renderPack(shelf: Shelf): string {
  const lines: string[] = [`# ${shelf.label.title} (${shelf.label.name})`];
  if (shelf.label.summary) lines.push("", shelf.label.summary);

  lines.push("", "## Current");
  if (shelf.current.length === 0) lines.push("_Nothing is current on this shelf._");
  for (const c of shelf.current) {
    lines.push(`- ${c.text}`, `  Cite: ${c.cite}`);
    for (const copy of c.copies) lines.push(`  Also filed in: ${copy}`);
  }
  if (shelf.current.length > 1) {
    lines.push("", "_Two or more current lines. They stay separate; do not blend them._");
  }

  lines.push("", "## Open");
  if (shelf.open.length === 0) lines.push("_Nothing is open on this shelf._");
  for (const c of shelf.open) {
    lines.push(`- ${c.text}`, `  Cite: ${c.cite}`);
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
  return lines.join("\n");
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
