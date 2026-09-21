import { z } from "zod";

/**
 * The three rails. Default answers use `current` and `open` only.
 * `superseded` is history: offered in one sentence, opened on request, always labelled dead.
 */
export const Rail = z.enum(["current", "open", "superseded"]);
export type Rail = z.infer<typeof Rail>;

export const Platform = z.enum(["Grok", "ChatGPT", "Claude", "Gemini", "Perplexity", "RubyVox"]);
export type Platform = z.infer<typeof Platform>;

/**
 * A cite is platform + date + thread title. That is what a person reads or hears.
 * `messageId` is for the filer's own bookkeeping and is never rendered.
 */
export const Cite = z.object({
  platform: Platform,
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
  thread: z.string().min(1),
  messageId: z.string().optional(),
});
export type Cite = z.infer<typeof Cite>;

/** A restatement of the same claim in another room. Kept as a pointer, not a duplicate. */
export const Copy = z.object({
  platform: Platform,
  thread: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
export type Copy = z.infer<typeof Copy>;

export const Member = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "member ids are kebab-case"),
  name: z.string().min(1),
});
export type Member = z.infer<typeof Member>;

export const Claim = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  rail: Rail,
  text: z.string().min(1),
  cite: Cite,
  /** In a group cabinet: the member who filed it. Only they can unfile it. */
  filedBy: z.string().optional(),
  /** Ids of claims this one replaced. Those must be on the superseded rail. */
  supersedes: z.array(z.string()).default([]),
  /** Set on a superseded claim: the id of the claim that replaced it, and when. */
  supersededBy: z.string().optional(),
  supersededOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  /** For an open item: a note on what it does and does not reopen. */
  note: z.string().optional(),
  copies: z.array(Copy).default([]),
});
export type Claim = z.infer<typeof Claim>;

const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD");

export const Message = z.object({
  id: z.string().optional(),
  role: z.enum(["user", "assistant", "system", "other"]).default("other"),
  author: z.string().optional(),
  date: IsoDate.optional(),
  text: z.string().min(1),
});
export type Message = z.infer<typeof Message>;

/**
 * A filed thread. This is the only way text enters a cabinet: someone said
 * "file this thread", whole or from one message. Nothing is vacuumed.
 */
export const Source = z.object({
  id: z.string().min(1),
  platform: Platform,
  title: z.string().min(1),
  date: IsoDate,
  scope: z.enum(["whole", "from"]),
  fromMessageId: z.string().optional(),
  /** The shelf the filer meant this for, if they said "this label". */
  label: z.string().optional(),
  filedBy: z.string().optional(),
  filedAt: z.string().min(1),
  messages: z.array(Message),
});
export type Source = z.infer<typeof Source>;

export const Label = z.object({
  name: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "label names are kebab-case"),
  title: z.string().min(1),
  summary: z.string().optional(),
});
export type Label = z.infer<typeof Label>;

export const Cabinet = z.object({
  name: z.string().min(1),
  kind: z.enum(["private", "group", "sample"]),
  /** A group card has members. Joining one ingests nothing; it only lets you read and file. */
  members: z.array(Member).default([]),
  labels: z.array(Label),
  claims: z.array(Claim),
  sources: z.array(Source).default([]),
});
export type Cabinet = z.infer<typeof Cabinet>;

export class CabinetError extends Error {}

/**
 * Parse and cross-check a cabinet. Beyond the shape, the rails must agree with each other:
 * a claim on `supersedes` must be superseded, and a superseded claim must name its replacement.
 */
export function parseCabinet(input: unknown): Cabinet {
  const cabinet = Cabinet.parse(input);
  const labels = new Set(cabinet.labels.map((l) => l.name));
  const byId = new Map(cabinet.claims.map((c) => [c.id, c]));

  if (byId.size !== cabinet.claims.length) {
    throw new CabinetError("claim ids must be unique");
  }
  if (new Set(cabinet.labels.map((l) => l.name)).size !== cabinet.labels.length) {
    throw new CabinetError("label names must be unique");
  }
  if (new Set(cabinet.sources.map((s) => s.id)).size !== cabinet.sources.length) {
    throw new CabinetError("source ids must be unique");
  }
  const members = new Set(cabinet.members.map((m) => m.id));
  if (members.size !== cabinet.members.length) {
    throw new CabinetError("member ids must be unique");
  }
  if (cabinet.kind === "group") {
    if (members.size === 0) throw new CabinetError("a group cabinet needs at least one member");
    for (const claim of cabinet.claims) {
      if (!claim.filedBy) throw new CabinetError(`claim ${claim.id} on a group card must say who filed it`);
      if (!members.has(claim.filedBy)) throw new CabinetError(`claim ${claim.id} was filed by ${claim.filedBy}, who is not a member`);
    }
    for (const source of cabinet.sources) {
      if (!source.filedBy) throw new CabinetError(`thread ${source.id} on a group card must say who filed it`);
      if (!members.has(source.filedBy)) throw new CabinetError(`thread ${source.id} was filed by ${source.filedBy}, who is not a member`);
    }
  }
  for (const claim of cabinet.claims) {
    if (!labels.has(claim.label)) {
      throw new CabinetError(`claim ${claim.id} names unknown label ${claim.label}`);
    }
    for (const oldId of claim.supersedes) {
      const old = byId.get(oldId);
      if (!old) throw new CabinetError(`claim ${claim.id} supersedes unknown claim ${oldId}`);
      if (old.rail !== "superseded") {
        throw new CabinetError(`claim ${oldId} is superseded by ${claim.id} but sits on the ${old.rail} rail`);
      }
      if (old.supersededBy !== claim.id) {
        throw new CabinetError(`claim ${oldId} must name ${claim.id} as supersededBy`);
      }
    }
    if (claim.rail === "superseded" && !claim.supersededBy) {
      throw new CabinetError(`superseded claim ${claim.id} must name what replaced it`);
    }
    if (claim.rail !== "superseded" && claim.supersededBy) {
      throw new CabinetError(`claim ${claim.id} names supersededBy but is on the ${claim.rail} rail`);
    }
  }
  return cabinet;
}
