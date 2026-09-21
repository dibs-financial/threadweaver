import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { UnknownLabel } from "./cabinet.js";
import { formatCite } from "./cite.js";
import { NoPrivateCabinet, isGroup, listLabels, locate, searchCurrent, shelvesFor, type Desk } from "./desk.js";
import { FilingError, fileClaim, fileThread, unfile } from "./file.js";
import { renderPack } from "./pack.js";
import { Cite, Message, Platform } from "./schema.js";
import { ReadOnlyCabinet, type Store } from "./store.js";
import { renderVoice } from "./voice.js";

export const SERVER_NAME = "threadweaver";
export const SERVER_VERSION = "0.1.0";

const INSTRUCTIONS = [
  "ThreadWeaver serves one Living State Card per label. Answer from current + open only.",
  "Every live claim carries a cite: platform + date + thread title. Never quote a message id.",
  "If history exists, offer it in one sentence and open it only when asked.",
  "Two current lines that disagree stay two lines. Do not blend them.",
  "The only extra verb is file: file_thread puts a thread on record, then file_claim places each rule it states on a rail with a cite to it. Suggest filing; never file what the person did not hand you.",
  "In a group, read the group card. Mix in the private cabinet only when the person says \"also use my private cabinet\" (includePrivate). Unfile removes from the card only; it never deletes a personal thread.",
  "If a tool fails, say the card is unreachable. Do not improvise policy.",
].join(" ");

export function createServer(deskOrStore: Desk | Store): McpServer {
  const desk: Desk = "card" in deskOrStore ? deskOrStore : { card: deskOrStore };
  const store = desk.card;
  const filer = { member: desk.member };
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION }, { instructions: INSTRUCTIONS });

  const includePrivate = z
    .boolean()
    .optional()
    .describe("Also use my private cabinet. Default false: the card only.");
  const to = z
    .enum(["card", "private"])
    .optional()
    .describe("Where to file. Default card (the group card when in a group). private files to your own cabinet only.");
  const target = (where: "card" | "private" | undefined): { store: Store; filer: { member?: string | undefined } } => {
    if (where === "private") {
      if (!desk.privateCabinet) throw new NoPrivateCabinet();
      return { store: desk.privateCabinet, filer: {} };
    }
    return { store, filer };
  };

  const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
  const writes = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };

  server.registerTool(
    "list_labels",
    {
      title: "List labels",
      description: `"I can talk about…" — the shelves in the ${store.cabinet.name} cabinet, with counts per rail.`,
      inputSchema: { includePrivate },
      annotations: readOnly,
    },
    async ({ includePrivate: mix }) => {
      const { card, priv } = await shelvesFor(desk, mix ?? false);
      const labels = listLabels(card, priv);
      const lines = labels.map(
        (l) =>
          `- ${l.name} — ${l.title} (${l.current} current, ${l.open} open${l.superseded ? `, ${l.superseded} superseded` : ""})`,
      );
      const text = labels.length === 0 ? "Nothing is filed yet." : `I can talk about:\n${lines.join("\n")}`;
      const c = store.cabinet;
      return {
        content: [{ type: "text", text }],
        structuredContent: {
          cabinet: c.name, kind: c.kind, writable: store.writable,
          ...(isGroup(desk) ? { member: desk.member, members: c.members.map((m) => m.name) } : {}),
          privateCabinet: desk.privateCabinet?.cabinet.name ?? null,
          labels,
        },
      };
    },
  );

  server.registerTool(
    "locate_label",
    {
      title: "Locate label",
      description: "Pull one shelf: current and open with cites. Pass includeHistory to open the superseded rail, labelled dead.",
      inputSchema: {
        label: z.string().describe("Label name as list_labels gives it"),
        includeHistory: z.boolean().optional().describe("Open the superseded rail. Default false."),
        includePrivate,
      },
      annotations: readOnly,
    },
    async ({ label, includeHistory, includePrivate: mix }) => {
      try {
        const { card, priv } = await shelvesFor(desk, mix ?? false);
        const { shelf, privateOnly } = locate(card, priv, label, includeHistory ?? false);
        return { content: [{ type: "text", text: renderPack(shelf, privateOnly) }], structuredContent: { ...shelf, privateOnly } };
      } catch (err) {
        return unknownLabelResult(err);
      }
    },
  );

  server.registerTool(
    "search_current",
    {
      title: "Search current",
      description: "Search current + open claims across every label. Superseded claims never match.",
      inputSchema: { query: z.string().min(1).describe("Words to match, all required"), includePrivate },
      annotations: readOnly,
    },
    async ({ query, includePrivate: mix }) => {
      try {
        const { card, priv } = await shelvesFor(desk, mix ?? false);
        const hits = searchCurrent(card, priv, query);
        const text =
          hits.length === 0
            ? `Nothing current or open matches "${query}". I do not have a cite for that.`
            : hits
                .map((h) => `- [${h.claim.rail}${h.where === "private" ? ", private" : ""}] ${h.label}: ${h.claim.text}\n  Cite: ${h.claim.cite}`)
                .join("\n");
        return { content: [{ type: "text", text }], structuredContent: { query, hits } };
      } catch (err) {
        return unknownLabelResult(err);
      }
    },
  );

  server.registerTool(
    "continue",
    {
      title: "Continue",
      description: "The default continue pack for one label: current + open with cites, and a one-line offer of history.",
      inputSchema: { label: z.string().describe("Label name as list_labels gives it"), includePrivate },
      annotations: readOnly,
    },
    async ({ label, includePrivate: mix }) => {
      try {
        const { card, priv } = await shelvesFor(desk, mix ?? false);
        const { shelf, privateOnly } = locate(card, priv, label, false);
        return { content: [{ type: "text", text: renderPack(shelf, privateOnly) }], structuredContent: { ...shelf, privateOnly } };
      } catch (err) {
        return unknownLabelResult(err);
      }
    },
  );

  server.registerTool(
    "continue_voice",
    {
      title: "Continue (voice)",
      description:
        "What RubyVox should say for one label. Spoken budget, no ids. Modes: current (default), chatty (one clause of history first), loud (the replaced-rule warning and a question).",
      inputSchema: {
        label: z.string().describe("Label name as list_labels gives it"),
        mode: z.enum(["current", "chatty", "loud"]).optional(),
      },
      annotations: readOnly,
    },
    async ({ label, mode }) => {
      try {
        const { card } = await shelvesFor(desk, false);
        const shelf = card.locate(label, true);
        const text = renderVoice(shelf, mode ?? "current");
        return { content: [{ type: "text", text }], structuredContent: { label, mode: mode ?? "current", text } };
      } catch (err) {
        return unknownLabelResult(err);
      }
    },
  );

  server.registerTool(
    "file_thread",
    {
      title: "File this thread",
      description:
        "Put a thread on record, whole or from one message, so claims can cite it. Pass only what the person handed you. Then call file_claim for each rule the thread states.",
      inputSchema: {
        platform: Platform,
        title: z.string().min(1).describe("Thread title as the platform shows it"),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Thread date, YYYY-MM-DD"),
        messages: z.array(Message).min(1),
        fromMessageId: z.string().optional().describe("File from this message onward instead of the whole thread"),
        label: z.string().optional().describe("The shelf this is for, if the person said \"this label\""),
        to,
      },
      annotations: writes,
    },
    async ({ to: where, ...input }) => {
      try {
        const t = target(where);
        const source = await t.store.mutate((draft) => fileThread(draft, input, t.filer));
        const shelfLines =
          source.label !== undefined ? renderPack(t.store.shelves.locate(source.label)) : `Shelves on file: ${labelList(t.store)}`;
        const text = [
          `Filed ${source.platform}, ${source.date}, "${source.title}" (${source.scope === "from" ? "from one message, " : ""}${source.messages.length} messages).`,
          "Now file each rule it states with file_claim, citing this thread. Mark what it replaces with supersedes, or record it as a copy with copyOf.",
          "",
          shelfLines,
        ].join("\n");
        return { content: [{ type: "text", text }], structuredContent: { to: where ?? "card", source: sourceSummary(source) } };
      } catch (err) {
        return filingErrorResult(err);
      }
    },
  );

  server.registerTool(
    "file_claim",
    {
      title: "File a claim",
      description:
        "Place one claim on the current or open rail with its cite. supersedes moves the named claims to the superseded rail. copyOf records this thread as a restatement of a claim already on file instead of a new line. A RubyVox cite can only be a copy.",
      inputSchema: {
        label: z.string().min(1),
        title: z.string().optional().describe("Only for a new label"),
        text: z.string().min(1),
        rail: z.enum(["current", "open"]),
        cite: Cite,
        note: z.string().optional().describe("For an open item: what it does and does not reopen"),
        supersedes: z.array(z.string()).optional().describe("Claim ids this replaces"),
        copyOf: z.string().optional().describe("Claim id this thread restates"),
        keepWording: z.enum(["existing", "new"]).optional().describe("With copyOf: which wording the card keeps"),
        to,
      },
      annotations: writes,
    },
    async ({ to: where, ...input }) => {
      try {
        const t = target(where);
        const result = await t.store.mutate((draft) => fileClaim(draft, input, t.filer));
        const verb = result.created ? `Filed on the ${result.claim.rail} rail of ${result.claim.label}` : `Recorded against ${result.claim.label}`;
        const text = [
          `${verb}: ${result.claim.text}`,
          `Cite: ${formatCite(result.claim.cite)}`,
          ...result.notes.map((n) => `Note: ${n}`),
          "",
          renderPack(t.store.shelves.locate(result.claim.label)),
        ].join("\n");
        return {
          content: [{ type: "text", text }],
          structuredContent: { to: where ?? "card", claimId: result.claim.id, created: result.created, notes: result.notes },
        };
      } catch (err) {
        return filingErrorResult(err);
      }
    },
  );

  server.registerTool(
    "unfile",
    {
      title: "Unfile",
      description:
        "Take one claim, or every claim citing one thread, off this card. On a group card only the member who filed it can. Nothing outside this cabinet is touched, your private cabinet included, and no superseded rule comes back to life.",
      inputSchema: {
        claimId: z.string().optional(),
        thread: z.object({ platform: Platform, title: z.string().min(1) }).optional(),
        to,
      },
      annotations: { ...writes, destructiveHint: true },
    },
    async ({ to: where, ...input }) => {
      try {
        const t = target(where);
        const result = await t.store.mutate((draft) => unfile(draft, input, t.filer));
        const lines = result.claims.map((c) => `- ${c.text} (${formatCite(c.cite)})`);
        const text = [
          result.claims.length === 0 ? "No claims removed." : `Unfiled ${result.claims.length} claim${result.claims.length === 1 ? "" : "s"} from this card:`,
          ...lines,
          result.source ? `The thread ${result.source.platform}, "${result.source.title}" is off this card.` : "",
          `Off this card only: it still exists wherever it was written${desk.privateCabinet && where !== "private" ? ", your private cabinet included" : ""}.`,
        ]
          .filter(Boolean)
          .join("\n");
        return {
          content: [{ type: "text", text }],
          structuredContent: { removed: result.claims.map((c) => c.id), source: result.source ? sourceSummary(result.source) : null },
        };
      } catch (err) {
        return filingErrorResult(err);
      }
    },
  );

  function labelList(s: Store): string {
    const names = s.shelves.listLabels().map((l) => l.name);
    return names.length ? names.join(", ") : "none yet";
  }

  return server;
}

function sourceSummary(source: { id: string; platform: string; title: string; date: string; scope: string; messages: unknown[] }) {
  return { id: source.id, platform: source.platform, title: source.title, date: source.date, scope: source.scope, messages: source.messages.length };
}

function unknownLabelResult(err: unknown) {
  if (err instanceof UnknownLabel || err instanceof NoPrivateCabinet) {
    return { content: [{ type: "text" as const, text: err.message }], isError: true };
  }
  throw err;
}

function filingErrorResult(err: unknown) {
  if (err instanceof FilingError || err instanceof UnknownLabel || err instanceof ReadOnlyCabinet || err instanceof NoPrivateCabinet) {
    return { content: [{ type: "text" as const, text: err.message }], isError: true };
  }
  throw err;
}
