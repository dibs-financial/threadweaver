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

export const Claim = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  rail: Rail,
  text: z.string().min(1),
  cite: Cite,
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

export const Label = z.object({
  name: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "label names are kebab-case"),
  title: z.string().min(1),
  summary: z.string().optional(),
});
export type Label = z.infer<typeof Label>;

export const Cabinet = z.object({
  name: z.string().min(1),
  kind: z.enum(["private", "group", "sample"]),
  labels: z.array(Label),
  claims: z.array(Claim),
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
