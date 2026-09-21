import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { loadCabinet } from "../src/cabinet.js";
import { createServer } from "../src/server.js";
import { Store } from "../src/store.js";

const SEED = new URL("../seed/bond-factory.json", import.meta.url).pathname;

function textOf(result: { content: unknown }): string {
  const blocks = result.content as Array<{ type: string; text?: string }>;
  return blocks.filter((b) => b.type === "text").map((b) => b.text ?? "").join("\n");
}

describe("mcp server", () => {
  let client: Client;
  let close: () => Promise<void>;

  beforeEach(async () => {
    const server = createServer(Store.inMemory(await loadCabinet(SEED), false));
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    client = new Client({ name: "test", version: "0.0.0" });
    await client.connect(clientTransport);
    close = async () => {
      await client.close();
      await server.close();
    };
  });

  afterEach(async () => {
    await close();
  });

  it("exposes the five read tools and the three file tools", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      ["continue", "continue_voice", "file_claim", "file_thread", "list_labels", "locate_label", "search_current", "unfile"].sort(),
    );
    const readOnly = tools.filter((t) => t.annotations?.readOnlyHint).map((t) => t.name).sort();
    expect(readOnly).toEqual(["continue", "continue_voice", "list_labels", "locate_label", "search_current"]);
    expect(tools.find((t) => t.name === "unfile")?.annotations?.destructiveHint).toBe(true);
  });

  it("refuses to file into the read-only sample cabinet", async () => {
    const r = await client.callTool({
      name: "file_claim",
      arguments: { label: "bond-rule", text: "x", rail: "open", cite: { platform: "Grok", date: "2026-06-01", thread: "t" } },
    });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain("read-only");
  });

  it("list_labels says what it can talk about", async () => {
    const r = await client.callTool({ name: "list_labels", arguments: {} });
    expect(textOf(r)).toContain("I can talk about:");
    expect(textOf(r)).toContain("- bond-rule — Who funds the $75k bond");
  });

  it("continue answers the bond deal from the current card only", async () => {
    const r = await client.callTool({ name: "continue", arguments: { label: "bond-rule" } });
    const text = textOf(r);
    expect(text).toContain("The provider supplies the $75k bond.");
    expect(text).not.toContain("renter");
    expect(text).toContain("There is a superseded version.");
  });

  it("locate_label opens history only when asked", async () => {
    const closed = textOf(await client.callTool({ name: "locate_label", arguments: { label: "bond-rule" } }));
    const open = textOf(await client.callTool({ name: "locate_label", arguments: { label: "bond-rule", includeHistory: true } }));
    expect(closed).not.toContain("[dead]");
    expect(open).toContain("[dead] The renter funds");
  });

  it("search_current never surfaces the dead rail", async () => {
    const r = await client.callTool({ name: "search_current", arguments: { query: "renter" } });
    expect(textOf(r)).toContain("I do not have a cite for that.");
  });

  it("continue_voice speaks the loud warning", async () => {
    const r = await client.callTool({ name: "continue_voice", arguments: { label: "bond-rule", mode: "loud" } });
    expect(textOf(r)).toContain("I will not treat it as current.");
  });

  it("an unknown label is a tool error, not a guess", async () => {
    const r = await client.callTool({ name: "locate_label", arguments: { label: "nope" } });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain('No shelf named "nope"');
  });
});
