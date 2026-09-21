import type { LabelSummary, RenderedClaim, SearchHit, Shelf, Shelves } from "./cabinet.js";
import { UnknownLabel } from "./cabinet.js";
import type { Store } from "./store.js";

/**
 * A desk is one person's seat: the card they read by default, and optionally their
 * own private cabinet beside it.
 *
 * In a group, the card is the group card. Private notes come in only when the
 * person says "also use my private cabinet". A private line that restates a group
 * line becomes a pointer under it, never a second copy.
 */
export interface Desk {
  card: Store;
  privateCabinet?: Store | undefined;
  /** Who sits here. Required when the card is a group card. */
  member?: string | undefined;
}

export class NoPrivateCabinet extends Error {
  constructor() {
    super("No private cabinet is configured at this desk. Set THREADWEAVER_CABINET to add one.");
  }
}

export interface MixedShelf {
  shelf: Shelf;
  /** Private lines that are not on the card. Rendered as their own section. */
  privateOnly: Shelf | null;
}

export async function shelvesFor(desk: Desk, includePrivate: boolean): Promise<{ card: Shelves; priv: Shelves | null }> {
  await desk.card.refresh();
  if (!includePrivate) return { card: desk.card.shelves, priv: null };
  if (!desk.privateCabinet) throw new NoPrivateCabinet();
  await desk.privateCabinet.refresh();
  return { card: desk.card.shelves, priv: desk.privateCabinet.shelves };
}

export function isGroup(desk: Desk): boolean {
  return desk.card.cabinet.kind === "group";
}

export function listLabels(card: Shelves, priv: Shelves | null): LabelSummary[] {
  const out = card.listLabels();
  if (!priv) return out;
  const seen = new Set(out.map((l) => l.name));
  for (const l of priv.listLabels()) {
    if (seen.has(l.name)) continue;
    out.push({ ...l, title: `${l.title} (private cabinet only)` });
  }
  return out;
}

export function locate(card: Shelves, priv: Shelves | null, label: string, includeHistory: boolean): MixedShelf {
  const onCard = card.hasLabel(label);
  const inPrivate = priv?.hasLabel(label) ?? false;
  if (!onCard && !inPrivate) throw new UnknownLabel(label);

  if (!priv) return { shelf: card.locate(label, includeHistory), privateOnly: null };

  const privShelf = inPrivate ? priv.locate(label, includeHistory) : null;
  if (!onCard) {
    return { shelf: emptyShelf(privShelf!), privateOnly: privShelf };
  }
  const shelf = card.locate(label, includeHistory);
  if (!privShelf) return { shelf, privateOnly: null };

  const rest: Shelf = { label: privShelf.label, current: [], open: [] };
  if (privShelf.superseded) rest.superseded = [];
  const rails = ["current", "open", "superseded"] as const;
  for (const rail of rails) {
    for (const mine of privShelf[rail] ?? []) {
      const twin = (shelf[rail] ?? []).find((c) => normalize(c.text) === normalize(mine.text));
      if (twin) {
        twin.copies.push(`your private cabinet, ${mine.cite}`);
      } else {
        rest[rail]?.push(mine);
      }
    }
  }
  const anything = rest.current.length + rest.open.length + (rest.superseded?.length ?? 0) > 0;
  return { shelf, privateOnly: anything ? rest : null };
}

export function searchCurrent(card: Shelves, priv: Shelves | null, query: string): Array<SearchHit & { where: "card" | "private" }> {
  const hits: Array<SearchHit & { where: "card" | "private" }> = card.searchCurrent(query).map((h) => ({ ...h, where: "card" }));
  if (!priv) return hits;
  const onCard = new Set(hits.map((h) => `${h.label}|${normalize(h.claim.text)}`));
  for (const h of priv.searchCurrent(query)) {
    if (onCard.has(`${h.label}|${normalize(h.claim.text)}`)) continue;
    hits.push({ ...h, where: "private" });
  }
  return hits;
}

function emptyShelf(from: Shelf): Shelf {
  return { label: { ...from.label, title: `${from.label.title} (not on this card)` }, current: [], open: [] };
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9$%]+/g, " ").trim();
}

export type { RenderedClaim };
