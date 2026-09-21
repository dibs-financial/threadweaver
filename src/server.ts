import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { UnknownLabel } from "./cabinet.js";
import { formatCite } from "./cite.js";
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
  "If a tool fails, say the card is unreachable. Do not improvise policy.",
].join(" ");

export function createServer(store: Store): McpServer {
  const cabinet = store.cabinet;
  const shelves = () => store.shelves;
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION }, { instructions: INSTRUCTIONS });

  const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
  const writes = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };

  server.registerTool(
    "list_labels",
    {
      title: "List labels",
      description: `"I can talk about…" — the shelves in the ${cabinet.name} cabinet, with counts per rail.`,
      inputSchema: {},
      annotations: readOnly,
    },
    async () => {
      const labels = shelves().listLabels();
      const lines = labels.map(
        (l) =>
          `- ${l.name} — ${l.title} (${l.current} current, ${l.open} open${l.superseded ? `, ${l.superseded} superseded` : ""})`,
      );
      const text = labels.length === 0 ? "Nothing is filed yet." : `I can talk about:\n${lines.join("\n")}`;
      return { content: [{ type: "text", text }], structuredContent: { cabinet: store.cabinet.name, kind: store.cabinet.kind, writable: store.writable, labels } };
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
      },
      annotations: readOnly,
    },
    async ({ label, includeHistory }) => {
      try {
        const shelf = shelves().locate(label, includeHistory ?? false);
        return { content: [{ type: "text", text: renderPack(shelf) }], structuredContent: { ...shelf } };
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
      inputSchema: { query: z.string().min(1).describe("Words to match, all required") },
      annotations: readOnly,
    },
    async ({ query }) => {
      const hits = shelves().searchCurrent(query);
      const text =
        hits.length === 0
          ? `Nothing current or open matches "${query}". I do not have a cite for that.`
          : hits.map((h) => `- [${h.claim.rail}] ${h.label}: ${h.claim.text}\n  Cite: ${h.claim.cite}`).join("\n");
      return { content: [{ type: "text", text }], structuredContent: { query, hits } };
    },
  );

  server.registerTool(
    "continue",
    {
      title: "Continue",
      description: "The default continue pack for one label: current + open with cites, and a one-line offer of history.",
      inputSchema: { label: z.string().describe("Label name as list_labels gives it") },
      annotations: readOnly,
    },
    async ({ label }) => {
      try {
        const shelf = shelves().locate(label, false);
        return { content: [{ type: "text", text: renderPack(shelf) }], structuredContent: { ...shelf } };
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
        const shelf = shelves().locate(label, true);
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
      },
      annotations: writes,
    },
    async (input) => {
      try {
        const source = await store.mutate((draft) => fileThread(draft, input));
        const shelfLines =
          source.label !== undefined ? renderPack(shelves().locate(source.label)) : `Shelves on file: ${labelList()}`;
        const text = [
          `Filed ${source.platform}, ${source.date}, "${source.title}" (${source.scope === "from" ? "from one message, " : ""}${source.messages.length} messages).`,
          "Now file each rule it states with file_claim, citing this thread. Mark what it replaces with supersedes, or record it as a copy with copyOf.",
          "",
          shelfLines,
        ].join("\n");
        return { content: [{ type: "text", text }], structuredContent: { source: sourceSummary(source) } };
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
      },
      annotations: writes,
    },
    async (input) => {
      try {
        const result = await store.mutate((draft) => fileClaim(draft, input));
        const verb = result.created ? `Filed on the ${result.claim.rail} rail of ${result.claim.label}` : `Recorded against ${result.claim.label}`;
        const text = [
          `${verb}: ${result.claim.text}`,
          `Cite: ${formatCite(result.claim.cite)}`,
          ...result.notes.map((n) => `Note: ${n}`),
          "",
          renderPack(shelves().locate(result.claim.label)),
        ].join("\n");
        return {
          content: [{ type: "text", text }],
          structuredContent: { claimId: result.claim.id, created: result.created, notes: result.notes },
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
        "Take one claim, or every claim citing one thread, off this card. Nothing outside this cabinet is touched, and no superseded rule comes back to life.",
      inputSchema: {
        claimId: z.string().optional(),
        thread: z.object({ platform: Platform, title: z.string().min(1) }).optional(),
      },
      annotations: { ...writes, destructiveHint: true },
    },
    async (input) => {
      try {
        const result = await store.mutate((draft) => unfile(draft, input));
        const lines = result.claims.map((c) => `- ${c.text} (${formatCite(c.cite)})`);
        const text = [
          result.claims.length === 0 ? "No claims removed." : `Unfiled ${result.claims.length} claim${result.claims.length === 1 ? "" : "s"} from this card:`,
          ...lines,
          result.source ? `The thread ${result.source.platform}, "${result.source.title}" is off this card. It still exists wherever it was written.` : "",
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

  function labelList(): string {
    const names = shelves().listLabels().map((l) => l.name);
    return names.length ? names.join(", ") : "none yet";
  }

  return server;
}

function sourceSummary(source: { id: string; platform: string; title: string; date: string; scope: string; messages: unknown[] }) {
  return { id: source.id, platform: source.platform, title: source.title, date: source.date, scope: source.scope, messages: source.messages.length };
}

function unknownLabelResult(err: unknown) {
  if (err instanceof UnknownLabel) {
    return { content: [{ type: "text" as const, text: err.message }], isError: true };
  }
  throw err;
}

function filingErrorResult(err: unknown) {
  if (err instanceof FilingError || err instanceof UnknownLabel || err instanceof ReadOnlyCabinet) {
    return { content: [{ type: "text" as const, text: err.message }], isError: true };
  }
  throw err;
}
