import type { Shelf } from "./cabinet.js";
import { speakDate } from "./cite.js";

export type VoiceMode = "current" | "chatty" | "loud";

/**
 * VoiceFit: what RubyVox says. Current rule first. Spoken budget, no ids.
 *
 * - current: the live rule and open items, nothing else.
 * - chatty:  one clause of history, then the live rule.
 * - loud:    the older-rule warning, then a question. History is not read out.
 */
export function renderVoice(shelf: Shelf, mode: VoiceMode = "current"): string {
  const parts: string[] = [];
  const history = shelf.superseded?.[0] ?? null;
  const replacedOn = replacedDate(shelf);

  if (mode === "loud" && replacedOn) {
    parts.push(
      `I have an older rule on file that was replaced on ${speakDate(replacedOn)}.`,
      "I will not treat it as current.",
      "Do you want the history or the live rule?",
    );
    return parts.join(" ");
  }

  if (mode === "chatty" && history && replacedOn) {
    parts.push(`It used to be that ${lowerFirst(stripPeriod(history.text))}; that changed on ${speakDate(replacedOn)}.`);
  }

  if (shelf.current.length === 0) {
    parts.push(`Nothing is current on ${shelf.label.title}.`);
  } else {
    shelf.current.forEach((c, i) => {
      const lead = shelf.current.length > 1 ? `Current rule ${i + 1}:` : "Current rule:";
      parts.push(`${lead} ${c.text} That is from ${spokenCite(c.cite)}.`);
    });
    if (shelf.current.length > 1) parts.push("Those two lines disagree. I am not blending them.");
  }

  for (const o of shelf.open) {
    parts.push(`Still open: ${stripPeriod(o.text)}.${o.note ? ` ${o.note}` : ""}`);
  }

  if (mode === "current" && replacedOn) {
    parts.push("There is a superseded version. Ask if you want it.");
  }
  return parts.join(" ");
}

function replacedDate(shelf: Shelf): string | null {
  for (const c of shelf.superseded ?? []) {
    const m = /replaced on (\d{4}-\d{2}-\d{2})/.exec(c.replaced ?? "");
    if (m?.[1]) return m[1];
  }
  return null;
}

/** Turn `Claude, 2026-05-14, "Bond Factory waterfall v2"` into words. */
function spokenCite(cite: string): string {
  const m = /^(\w+), (\d{4}-\d{2}-\d{2}), "(.+)"$/.exec(cite);
  if (!m) return cite;
  return `${m[1]}, ${speakDate(m[2] ?? "")}, ${m[3]}`;
}

function stripPeriod(s: string): string {
  return s.replace(/\.\s*$/, "");
}

function lowerFirst(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}
