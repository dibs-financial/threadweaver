import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { loadCabinet } from "../src/cabinet.js";
import { CABINET_VERSION, parseCabinet } from "../src/schema.js";
import { MOUTH_PROMPT, createServer } from "../src/server.js";
import { Store } from "../src/store.js";

const SEED = new URL("../seed/bond-factory.json", import.meta.url).pathname;

describe("cabinet version", () => {
  const bare = { name: "x", kind: "private", labels: [], claims: [] };

  it("a cabinet without a version is version 1", () => {
    expect(parseCabinet(bare).version).toBe(1);
    expect(CABINET_VERSION).toBe(1);
  });

  it("the seeds declare the current version", async () => {
    expect((await loadCabinet(SEED)).version).toBe(CABINET_VERSION);
  });

  it("a newer cabinet is refused with a sentence, not guessed at", () => {
    expect(() => parseCabinet({ ...bare, version: 2 })).toThrow(/format version 2; this server reads version 1\. Update ThreadWeaver/);
    expect(() => parseCabinet({ ...bare, version: 0 })).toThrow();
  });

  it("writes carry the version", async () => {
    const { mkdtemp } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const path = await import("node:path");
    const file = path.join(await mkdtemp(path.join(tmpdir(), "tw-v-")), "c.json");
    await Store.open(file, { writable: true });
    expect(JSON.parse(await readFile(file, "utf8")).version).toBe(1);
  });
});

describe("mouth prompt", () => {
  it("is served over MCP, without the human note at the top of the file", async () => {
    const server = createServer(Store.inMemory(await loadCabinet(SEED), false));
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await server.connect(st);
    const client = new Client({ name: "t", version: "0" });
    await client.connect(ct);

    const { prompts } = await client.listPrompts();
    expect(prompts.map((p) => p.name)).toEqual(["mouth"]);

    const got = await client.getPrompt({ name: "mouth" });
    const text = got.messages[0]?.content.type === "text" ? got.messages[0].content.text : "";
    expect(text.startsWith("You are the ThreadWeaver mouth.")).toBe(true);
    expect(text).not.toContain("Paste this into the system prompt");
    expect(text).toContain("Two current lines that disagree stay two lines.");
    expect(text).toContain("`file_thread`");

    const onDisk = await readFile(MOUTH_PROMPT, "utf8");
    expect(onDisk).toContain("Paste this into the system prompt");
    await client.close();
    await server.close();
  });
});
