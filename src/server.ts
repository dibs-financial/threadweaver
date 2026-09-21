import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { Shelves, UnknownLabel } from "./cabinet.js";
import { renderPack } from "./pack.js";
import { renderVoice } from "./voice.js";
import type { Cabinet } from "./schema.js";

export const SERVER_NAME = "threadweaver";
export const SERVER_VERSION = "0.1.0";

const INSTRUCTIONS = [
  "ThreadWeaver serves one Living State Card per label. Answer from current + open only.",
  "Every live claim carries a cite: platform + date + thread title. Never quote a message id.",
  "If history exists, offer it in one sentence and open it only when asked.",
  "Two current lines that disagree stay two lines. Do not blend them.",
  "If a tool fails, say the card is unreachable. Do not improvise policy.",
].join(" ");

export function createServer(cabinet: Cabinet): McpServer {
  const shelves = new Shelves(cabinet);
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION }, { instructions: INSTRUCTIONS });

  const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

  server.registerTool(
    "list_labels",
    {
      title: "List labels",
      description: `"I can talk about…" — the shelves in the ${cabinet.name} cabinet, with counts per rail.`,
      inputSchema: {},
      annotations: readOnly,
    },
    async () => {
      const labels = shelves.listLabels();
      const lines = labels.map(
        (l) =>
          `- ${l.name} — ${l.title} (${l.current} current, ${l.open} open${l.superseded ? `, ${l.superseded} superseded` : ""})`,
      );
      const text = labels.length === 0 ? "Nothing is filed yet." : `I can talk about:\n${lines.join("\n")}`;
      return { content: [{ type: "text", text }], structuredContent: { cabinet: cabinet.name, kind: cabinet.kind, labels } };
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
        const shelf = shelves.locate(label, includeHistory ?? false);
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
      const hits = shelves.searchCurrent(query);
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
        const shelf = shelves.locate(label, false);
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
        const shelf = shelves.locate(label, true);
        const text = renderVoice(shelf, mode ?? "current");
        return { content: [{ type: "text", text }], structuredContent: { label, mode: mode ?? "current", text } };
      } catch (err) {
        return unknownLabelResult(err);
      }
    },
  );

  return server;
}

function unknownLabelResult(err: unknown) {
  if (err instanceof UnknownLabel) {
    return { content: [{ type: "text" as const, text: err.message }], isError: true };
  }
  throw err;
}
