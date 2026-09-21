import type { Cabinet, Cite, Claim, Message, Platform, Source } from "./schema.js";

/**
 * The file verb. Three moves, all on a draft cabinet, all throwing FilingError
 * with a sentence the model can repeat to the person:
 *
 *   fileThread  — put a thread on record, whole or from one message
 *   fileClaim   — place one claim on a rail with its cite; supersede or copy
 *   unfile      — take a claim, or a thread's claims, off this card
 *
 * The server never reads the thread for you. The model that is talking to the
 * person proposes the claims; these functions keep the rails honest.
 */

export class FilingError extends Error {}

export interface FileThreadInput {
  platform: Platform;
  title: string;
  date: string;
  messages: Message[];
  fromMessageId?: string | undefined;
  label?: string | undefined;
}

/** On a group card every filing carries the member doing it. */
export interface Filer {
  member?: string | undefined;
}

function requireMember(draft: Cabinet, filer: Filer): string | undefined {
  if (draft.kind !== "group") return undefined;
  if (!filer.member) throw new FilingError("This is a group card. Say who is filing (THREADWEAVER_MEMBER).");
  if (!draft.members.some((m) => m.id === filer.member)) {
    throw new FilingError(`"${filer.member}" is not a member of ${draft.name}. Joining a group is done by its members, not by filing.`);
  }
  return filer.member;
}

export function fileThread(draft: Cabinet, input: FileThreadInput, filer: Filer = {}, now = new Date()): Source {
  const filedBy = requireMember(draft, filer);
  if (input.label !== undefined && !draft.labels.some((l) => l.name === input.label)) {
    throw new FilingError(`No shelf named "${input.label}". File the first claim with a title to create it.`);
  }
  let messages = input.messages;
  let scope: Source["scope"] = "whole";
  if (input.fromMessageId !== undefined) {
    const at = messages.findIndex((m) => m.id === input.fromMessageId);
    if (at < 0) throw new FilingError(`No message with id "${input.fromMessageId}" in that thread.`);
    messages = messages.slice(at);
    scope = "from";
  }
  if (messages.length === 0) throw new FilingError("Nothing to file: the thread has no messages.");

  const existing = draft.sources.find((s) => s.platform === input.platform && s.title === input.title);
  const source: Source = {
    id: existing?.id ?? nextId("src", draft.sources.map((s) => s.id)),
    platform: input.platform,
    title: input.title,
    date: input.date,
    scope,
    ...(input.fromMessageId !== undefined ? { fromMessageId: input.fromMessageId } : {}),
    ...(input.label !== undefined ? { label: input.label } : {}),
    ...(filedBy !== undefined ? { filedBy } : {}),
    filedAt: now.toISOString(),
    messages,
  };
  if (existing && filedBy !== undefined && existing.filedBy !== filedBy) {
    throw new FilingError(`That thread is already on this card, filed by ${memberName(draft, existing.filedBy)}. Only they can refile it.`);
  }
  if (existing) {
    draft.sources[draft.sources.indexOf(existing)] = source;
  } else {
    draft.sources.push(source);
  }
  return source;
}

export interface FileClaimInput {
  label: string;
  /** Needed only when the label does not exist yet. */
  title?: string | undefined;
  text: string;
  rail: "current" | "open";
  cite: Cite;
  note?: string | undefined;
  /** Ids of current or open claims this one replaces. They move to the superseded rail. */
  supersedes?: string[] | undefined;
  /** File as a restatement of an existing claim instead of a new line. */
  copyOf?: string | undefined;
  /** With copyOf: which wording the card keeps. Default keeps what is on file. */
  keepWording?: "existing" | "new" | undefined;
}

export interface FileClaimResult {
  claim: Claim;
  created: boolean;
  /** Things the filer should hear: a second current line, a near-duplicate, a copy recorded. */
  notes: string[];
}

export function fileClaim(draft: Cabinet, input: FileClaimInput, filer: Filer = {}): FileClaimResult {
  const notes: string[] = [];
  const byId = new Map(draft.claims.map((c) => [c.id, c]));
  const filedBy = requireMember(draft, filer);

  if (input.copyOf !== undefined) {
    return recordCopy(draft, byId, input);
  }

  if (input.cite.platform === "RubyVox") {
    throw new FilingError(
      "A RubyVox call is a source, not a new current. File it as a copy of the claim it spoke (copyOf), or cite the thread that set the rule.",
    );
  }

  if (!draft.labels.some((l) => l.name === input.label)) {
    if (!input.title) {
      throw new FilingError(`No shelf named "${input.label}". Give a title to create it, or pick one from list_labels.`);
    }
    if (!/^[a-z0-9][a-z0-9-]*$/.test(input.label)) {
      throw new FilingError(`Label names are kebab-case: "${input.label}" is not.`);
    }
    draft.labels.push({ name: input.label, title: input.title });
    notes.push(`New shelf: ${input.label}.`);
  }

  const shelf = draft.claims.filter((c) => c.label === input.label);
  const same = shelf.find((c) => c.rail !== "superseded" && normalize(c.text) === normalize(input.text));
  if (same) {
    throw new FilingError(
      `That claim is already on the ${same.rail} rail of ${input.label} (${citeText(same.cite)}). File this thread as a copy of it with copyOf, or change the wording.`,
    );
  }

  const supersedes = input.supersedes ?? [];
  const cite = { ...input.cite };
  for (const oldId of supersedes) {
    const old = byId.get(oldId);
    if (!old) throw new FilingError(`No claim with id "${oldId}" to supersede.`);
    if (old.label !== input.label) throw new FilingError(`Claim "${oldId}" is on ${old.label}, not ${input.label}.`);
    if (old.rail === "superseded") throw new FilingError(`Claim "${oldId}" is already superseded.`);
    if (cite.date < old.cite.date) {
      throw new FilingError(
        `An older thread cannot supersede a newer rule: this cite is ${cite.date}, the rule on file is ${old.cite.date}.`,
      );
    }
  }
  if (input.rail === "open" && supersedes.length > 0) {
    throw new FilingError("An open item does not supersede anything. File it as current, or leave supersedes empty.");
  }

  const claim: Claim = {
    id: nextId(input.label, draft.claims.map((c) => c.id)),
    label: input.label,
    rail: input.rail,
    text: input.text.trim(),
    cite,
    supersedes,
    copies: [],
    ...(input.note !== undefined ? { note: input.note } : {}),
    ...(filedBy !== undefined ? { filedBy } : {}),
  };

  for (const oldId of supersedes) {
    const old = byId.get(oldId)!;
    old.rail = "superseded";
    old.supersededBy = claim.id;
    old.supersededOn = cite.date;
    delete old.note;
  }
  draft.claims.push(claim);

  const live = draft.claims.filter((c) => c.label === input.label && c.rail !== "superseded" && c.id !== claim.id);
  for (const other of live) {
    const score = similarity(other.text, claim.text);
    if (score >= 0.6) {
      notes.push(
        `Similar to the ${other.rail} line "${other.text}" (${citeText(other.cite)}). Similar is not current: if it is the same rule, unfile this and file it as a copy; if it replaces it, unfile and refile with supersedes.`,
      );
    }
  }
  const currentCount = draft.claims.filter((c) => c.label === input.label && c.rail === "current").length;
  if (claim.rail === "current" && currentCount > 1) {
    notes.push(`${input.label} now has ${currentCount} current lines. They stay separate lines; nothing is blended.`);
  }

  return { claim, created: true, notes };
}

function recordCopy(draft: Cabinet, byId: Map<string, Claim>, input: FileClaimInput): FileClaimResult {
  const target = byId.get(input.copyOf!);
  if (!target) throw new FilingError(`No claim with id "${input.copyOf}" to copy.`);
  if (target.rail === "superseded") {
    throw new FilingError(`Claim "${input.copyOf}" is superseded. A copy of a dead rule stays dead; file it under the claim that replaced it, or not at all.`);
  }
  if (input.supersedes?.length) throw new FilingError("A copy does not supersede anything.");

  const notes: string[] = [];
  const pointer = { platform: input.cite.platform, thread: input.cite.thread, date: input.cite.date };
  const already =
    (target.cite.platform === pointer.platform && target.cite.thread === pointer.thread) ||
    target.copies.some((c) => c.platform === pointer.platform && c.thread === pointer.thread);

  if (input.keepWording === "new") {
    if (input.cite.platform === "RubyVox") {
      throw new FilingError("RubyVox wording never becomes the wording on file. Keep the existing wording.");
    }
    const old = { platform: target.cite.platform, thread: target.cite.thread, date: target.cite.date };
    target.copies = target.copies.filter((c) => !(c.platform === pointer.platform && c.thread === pointer.thread));
    if (!target.copies.some((c) => c.platform === old.platform && c.thread === old.thread)) target.copies.push(old);
    target.cite = { ...input.cite };
    target.text = input.text.trim();
    notes.push(`Kept the new wording. The earlier wording is now filed as a copy in ${old.platform}, "${old.thread}".`);
  } else if (!already) {
    target.copies.push(pointer);
    notes.push(`Filed as a copy. The card keeps the wording on file and points at ${pointer.platform}, "${pointer.thread}".`);
  } else {
    notes.push("That room is already on file for this claim. Nothing changed.");
  }
  return { claim: target, created: false, notes };
}

export interface UnfileInput {
  claimId?: string | undefined;
  thread?: { platform: Platform; title: string } | undefined;
}

export interface UnfileResult {
  claims: Claim[];
  source: Source | null;
}

/**
 * Take a claim, or every claim that cites one thread, off this card. The thread's own
 * record is removed from this cabinet only; nothing outside it is touched, and no
 * superseded rule is promoted back to current.
 */
export function unfile(draft: Cabinet, input: UnfileInput, filer: Filer = {}): UnfileResult {
  const me = requireMember(draft, filer);
  const mine = (filedBy: string | undefined) => me === undefined || filedBy === me;

  if (input.claimId !== undefined) {
    const at = draft.claims.findIndex((c) => c.id === input.claimId);
    if (at < 0) throw new FilingError(`No claim with id "${input.claimId}" on this card.`);
    const claim = draft.claims[at]!;
    if (!mine(claim.filedBy)) {
      throw new FilingError(`That claim was filed by ${memberName(draft, claim.filedBy)}. Only the member who filed it can unfile it.`);
    }
    draft.claims.splice(at, 1);
    return { claims: [claim], source: null };
  }
  if (input.thread) {
    const { platform, title } = input.thread;
    const claims = draft.claims.filter((c) => c.cite.platform === platform && c.cite.thread === title);
    const source0 = draft.sources.find((s) => s.platform === platform && s.title === title);
    const theirs = [...claims.map((c) => c.filedBy), ...(source0 ? [source0.filedBy] : [])].find((f) => !mine(f));
    if (theirs !== undefined) {
      throw new FilingError(`That thread was filed by ${memberName(draft, theirs)}. Only the member who filed it can unfile it.`);
    }
    for (const c of claims) draft.claims.splice(draft.claims.indexOf(c), 1);
    for (const c of draft.claims) c.copies = c.copies.filter((k) => !(k.platform === platform && k.thread === title));
    const at = draft.sources.findIndex((s) => s.platform === platform && s.title === title);
    const source = at >= 0 ? draft.sources.splice(at, 1)[0] ?? null : null;
    if (claims.length === 0 && !source) throw new FilingError(`Nothing on this card cites ${platform}, "${title}".`);
    return { claims, source };
  }
  throw new FilingError("Say what to unfile: a claimId, or a thread by platform and title.");
}

function memberName(draft: Cabinet, id: string | undefined): string {
  return draft.members.find((m) => m.id === id)?.name ?? id ?? "another member";
}

function nextId(prefix: string, taken: string[]): string {
  const have = new Set(taken);
  let n = taken.filter((id) => id.startsWith(`${prefix}-`)).length + 1;
  while (have.has(`${prefix}-${n}`)) n += 1;
  return `${prefix}-${n}`;
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9$%]+/g, " ").trim();
}

/** Word-set overlap. Cheap on purpose: it flags, it never merges. */
function similarity(a: string, b: string): number {
  const wa = new Set(normalize(a).split(" ").filter((w) => w.length > 2));
  const wb = new Set(normalize(b).split(" ").filter((w) => w.length > 2));
  if (wa.size === 0 || wb.size === 0) return 0;
  let both = 0;
  for (const w of wa) if (wb.has(w)) both += 1;
  return both / (wa.size + wb.size - both);
}

function citeText(c: Cite): string {
  return `${c.platform}, ${c.date}, "${c.thread}"`;
}
