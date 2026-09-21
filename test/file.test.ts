import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { loadCabinet } from "../src/cabinet.js";
import { FilingError, fileClaim, fileThread, unfile } from "../src/file.js";
import { parseCabinet, type Cabinet } from "../src/schema.js";
import { createServer } from "../src/server.js";
import { Store, emptyCabinet } from "../src/store.js";

const SEED = new URL("../seed/bond-factory.json", import.meta.url).pathname;

const waterfallThread = {
  platform: "Claude" as const,
  title: "Bond Factory waterfall v2",
  date: "2026-05-14",
  messages: [
    { id: "m1", role: "user" as const, text: "Who funds the bond now?" },
    { id: "m2", role: "assistant" as const, text: "The provider supplies the $75k bond. Margin recovers that cost first; remaining profit splits 80/20." },
  ],
};

describe("fileThread", () => {
  let draft: Cabinet;
  beforeEach(() => {
    draft = emptyCabinet("test");
  });

  it("puts a whole thread on record", () => {
    const src = fileThread(draft, waterfallThread, new Date("2026-09-21T00:00:00Z"));
    expect(src.id).toBe("src-1");
    expect(src.scope).toBe("whole");
    expect(src.messages).toHaveLength(2);
    expect(draft.sources).toHaveLength(1);
    expect(() => parseCabinet(draft)).not.toThrow();
  });

  it("files from one message onward", () => {
    const src = fileThread(draft, { ...waterfallThread, fromMessageId: "m2" });
    expect(src.scope).toBe("from");
    expect(src.messages.map((m) => m.id)).toEqual(["m2"]);
  });

  it("refuses an unknown fromMessageId and an unknown label", () => {
    expect(() => fileThread(draft, { ...waterfallThread, fromMessageId: "m9" })).toThrow(FilingError);
    expect(() => fileThread(draft, { ...waterfallThread, label: "bond-rule" })).toThrow(/No shelf named "bond-rule"/);
  });

  it("refiling the same thread replaces the record, not duplicates it", () => {
    fileThread(draft, waterfallThread);
    fileThread(draft, { ...waterfallThread, messages: waterfallThread.messages.slice(0, 1) });
    expect(draft.sources).toHaveLength(1);
    expect(draft.sources[0]?.messages).toHaveLength(1);
  });
});

describe("fileClaim", () => {
  const cite = (platform: "Grok" | "ChatGPT" | "Claude" | "Gemini" | "Perplexity" | "RubyVox", date: string, thread: string) => ({ platform, date, thread });

  it("creates a shelf with the first claim and needs a title to do so", () => {
    const draft = emptyCabinet("test");
    expect(() =>
      fileClaim(draft, { label: "bond-rule", text: "x", rail: "current", cite: cite("Grok", "2026-04-02", "one-pager") }),
    ).toThrow(/Give a title/);
    const r = fileClaim(draft, {
      label: "bond-rule", title: "Who funds the bond", text: "The renter funds the $75k bond.", rail: "current",
      cite: cite("Grok", "2026-04-02", "Bond Factory one-pager"),
    });
    expect(r.claim.id).toBe("bond-rule-1");
    expect(r.notes).toContain("New shelf: bond-rule.");
    expect(() => parseCabinet(draft)).not.toThrow();
  });

  it("supersedes: old rule moves to the dead rail and points back", () => {
    const draft = emptyCabinet("test");
    const old = fileClaim(draft, {
      label: "bond-rule", title: "Who funds the bond", text: "The renter funds the $75k bond.", rail: "current",
      cite: cite("Grok", "2026-04-02", "Bond Factory one-pager"),
    }).claim;
    const r = fileClaim(draft, {
      label: "bond-rule", text: "The provider supplies the $75k bond. Margin recovers that cost first; remaining profit splits 80/20.",
      rail: "current", cite: cite("Claude", "2026-05-14", "Bond Factory waterfall v2"), supersedes: [old.id],
    });
    const parsed = parseCabinet(draft);
    const dead = parsed.claims.find((c) => c.id === old.id)!;
    expect(dead.rail).toBe("superseded");
    expect(dead.supersededBy).toBe(r.claim.id);
    expect(dead.supersededOn).toBe("2026-05-14");
    expect(parsed.claims.filter((c) => c.rail === "current")).toHaveLength(1);
  });

  it("an older thread cannot supersede a newer rule", () => {
    const draft = emptyCabinet("test");
    const live = fileClaim(draft, {
      label: "bond-rule", title: "t", text: "The provider supplies the bond.", rail: "current",
      cite: cite("Claude", "2026-05-14", "waterfall v2"),
    }).claim;
    expect(() =>
      fileClaim(draft, {
        label: "bond-rule", text: "The renter funds the bond.", rail: "current",
        cite: cite("Grok", "2026-04-02", "one-pager"), supersedes: [live.id],
      }),
    ).toThrow(/An older thread cannot supersede a newer rule/);
  });

  it("a RubyVox call is a source, not a new current", () => {
    const draft = emptyCabinet("test");
    expect(() =>
      fileClaim(draft, {
        label: "bond-rule", title: "t", text: "The renter funds the bond.", rail: "current",
        cite: cite("RubyVox", "2026-06-01", "Call with the renter"),
      }),
    ).toThrow(/A RubyVox call is a source, not a new current/);
  });

  it("a RubyVox call can be filed as a copy of what it spoke", () => {
    const draft = emptyCabinet("test");
    const live = fileClaim(draft, {
      label: "bond-rule", title: "t", text: "The provider supplies the bond.", rail: "current",
      cite: cite("Claude", "2026-05-14", "waterfall v2"),
    }).claim;
    const r = fileClaim(draft, {
      label: "bond-rule", text: "provider supplies the bond", rail: "current",
      cite: cite("RubyVox", "2026-06-01", "Call with the renter"), copyOf: live.id,
    });
    expect(r.created).toBe(false);
    expect(r.claim.copies).toEqual([{ platform: "RubyVox", thread: "Call with the renter", date: "2026-06-01" }]);
    expect(r.claim.text).toBe("The provider supplies the bond.");
    expect(() =>
      fileClaim(draft, {
        label: "bond-rule", text: "x", rail: "current", cite: cite("RubyVox", "2026-06-01", "Call"), copyOf: live.id, keepWording: "new",
      }),
    ).toThrow(/RubyVox wording never becomes the wording on file/);
  });

  it("a copy can take over the wording; the old cite becomes the pointer", () => {
    const draft = emptyCabinet("test");
    const live = fileClaim(draft, {
      label: "bond-rule", title: "t", text: "Provider pays bond, 80/20 after.", rail: "current",
      cite: cite("ChatGPT", "2026-05-16", "May waterfall"),
    }).claim;
    const r = fileClaim(draft, {
      label: "bond-rule", text: "The provider supplies the $75k bond. Margin recovers that cost first; remaining profit splits 80/20.",
      rail: "current", cite: cite("Claude", "2026-05-14", "Bond Factory waterfall v2"), copyOf: live.id, keepWording: "new",
    });
    expect(r.claim.cite.thread).toBe("Bond Factory waterfall v2");
    expect(r.claim.copies).toEqual([{ platform: "ChatGPT", thread: "May waterfall", date: "2026-05-16" }]);
    expect(draft.claims).toHaveLength(1);
  });

  it("a copy of a dead rule stays dead", () => {
    const draft = emptyCabinet("test");
    const old = fileClaim(draft, { label: "a", title: "A", text: "old rule", rail: "current", cite: cite("Grok", "2026-01-01", "t1") }).claim;
    fileClaim(draft, { label: "a", text: "new rule", rail: "current", cite: cite("Grok", "2026-02-01", "t2"), supersedes: [old.id] });
    expect(() =>
      fileClaim(draft, { label: "a", text: "old rule", rail: "current", cite: cite("Gemini", "2026-03-01", "t3"), copyOf: old.id }),
    ).toThrow(/A copy of a dead rule stays dead/);
  });

  it("an exact restatement is refused and pointed at copyOf", () => {
    const draft = emptyCabinet("test");
    fileClaim(draft, { label: "a", title: "A", text: "The provider supplies the bond.", rail: "current", cite: cite("Claude", "2026-05-14", "t1") });
    expect(() =>
      fileClaim(draft, { label: "a", text: "the provider supplies the bond", rail: "current", cite: cite("Gemini", "2026-05-20", "t2") }),
    ).toThrow(/already on the current rail of a .* copyOf/);
  });

  it("similar is not current: a near-duplicate is filed as a second line and flagged", () => {
    const draft = emptyCabinet("test");
    fileClaim(draft, { label: "a", title: "A", text: "The provider supplies the $75k bond and recovers it first.", rail: "current", cite: cite("Claude", "2026-05-14", "t1") });
    const r = fileClaim(draft, { label: "a", text: "The provider supplies the $75k bond and recovers it last.", rail: "current", cite: cite("Gemini", "2026-05-20", "t2") });
    expect(r.created).toBe(true);
    expect(r.notes.some((n) => n.startsWith("Similar to the current line"))).toBe(true);
    expect(r.notes).toContain("a now has 2 current lines. They stay separate lines; nothing is blended.");
    expect(parseCabinet(draft).claims.filter((c) => c.rail === "current")).toHaveLength(2);
  });

  it("an open item does not supersede", () => {
    const draft = emptyCabinet("test");
    const live = fileClaim(draft, { label: "a", title: "A", text: "rule", rail: "current", cite: cite("Claude", "2026-05-14", "t1") }).claim;
    expect(() =>
      fileClaim(draft, { label: "a", text: "question", rail: "open", cite: cite("Claude", "2026-05-20", "t2"), supersedes: [live.id] }),
    ).toThrow(/An open item does not supersede/);
  });
});

describe("unfile", () => {
  it("removes one claim and never promotes what it superseded", () => {
    const draft = emptyCabinet("test");
    const old = fileClaim(draft, { label: "a", title: "A", text: "old", rail: "current", cite: { platform: "Grok", date: "2026-01-01", thread: "t1" } }).claim;
    const live = fileClaim(draft, { label: "a", text: "new", rail: "current", cite: { platform: "Grok", date: "2026-02-01", thread: "t2" }, supersedes: [old.id] }).claim;
    const r = unfile(draft, { claimId: live.id });
    expect(r.claims.map((c) => c.id)).toEqual([live.id]);
    const parsed = parseCabinet(draft);
    expect(parsed.claims.find((c) => c.id === old.id)?.rail).toBe("superseded");
    expect(parsed.claims.filter((c) => c.rail === "current")).toHaveLength(0);
  });

  it("removes a thread's claims, its pointers, and its record, from this card only", () => {
    const draft = emptyCabinet("test");
    fileThread(draft, waterfallThread);
    const live = fileClaim(draft, { label: "a", title: "A", text: "rule", rail: "current", cite: { platform: "Claude", date: "2026-05-14", thread: "Bond Factory waterfall v2" } }).claim;
    fileClaim(draft, { label: "a", text: "rule", rail: "current", cite: { platform: "ChatGPT", date: "2026-05-16", thread: "May waterfall" }, copyOf: live.id });
    const other = fileClaim(draft, { label: "b", title: "B", text: "other", rail: "open", cite: { platform: "Gemini", date: "2026-05-16", thread: "g" } }).claim;
    fileClaim(draft, { label: "b", text: "other", rail: "open", cite: { platform: "Claude", date: "2026-05-14", thread: "Bond Factory waterfall v2" }, copyOf: other.id });

    const r = unfile(draft, { thread: { platform: "Claude", title: "Bond Factory waterfall v2" } });
    expect(r.claims.map((c) => c.id)).toEqual([live.id]);
    expect(r.source?.id).toBe("src-1");
    expect(draft.sources).toHaveLength(0);
    expect(draft.claims.find((c) => c.id === other.id)?.copies).toEqual([]);
    expect(() => unfile(draft, { thread: { platform: "Claude", title: "Bond Factory waterfall v2" } })).toThrow(/Nothing on this card cites/);
    expect(() => unfile(draft, {})).toThrow(/Say what to unfile/);
  });
});

describe("store", () => {
  it("creates an empty cabinet for a missing file, writes after each change, and reloads clean", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "tw-"));
    const file = path.join(dir, "mine.json");
    const store = await Store.open(file, { writable: true });
    expect(store.cabinet).toEqual({ version: 1, name: "mine", kind: "private", members: [], labels: [], claims: [], sources: [] });

    await store.mutate((d) => fileThread(d, waterfallThread));
    await store.mutate((d) =>
      fileClaim(d, { label: "bond-rule", title: "Who funds the bond", text: "The provider supplies the $75k bond.", rail: "current", cite: { platform: "Claude", date: "2026-05-14", thread: "Bond Factory waterfall v2" } }),
    );
    const onDisk = parseCabinet(JSON.parse(await readFile(file, "utf8")));
    expect(onDisk.claims).toHaveLength(1);
    expect(onDisk.sources).toHaveLength(1);

    const again = await Store.open(file, { writable: true });
    expect(again.shelves.locate("bond-rule").current[0]?.text).toBe("The provider supplies the $75k bond.");
  });

  it("a rejected change leaves the cabinet and the file untouched", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "tw-"));
    const file = path.join(dir, "mine.json");
    const store = await Store.open(file, { writable: true });
    const before = await readFile(file, "utf8");
    await expect(
      store.mutate((d) => fileClaim(d, { label: "a", text: "x", rail: "current", cite: { platform: "RubyVox", date: "2026-01-01", thread: "call" } })),
    ).rejects.toThrow(FilingError);
    expect(await readFile(file, "utf8")).toBe(before);
    expect(store.cabinet.claims).toHaveLength(0);
  });

  it("concurrent mutations apply in order and none is lost", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "tw-"));
    const file = path.join(dir, "mine.json");
    const store = await Store.open(file, { writable: true });
    const cite = (n: number) => ({ platform: "Claude" as const, date: "2026-05-14", thread: `t${n}` });
    await Promise.all([
      store.mutate((d) => fileThread(d, waterfallThread)),
      store.mutate((d) => fileClaim(d, { label: "a", title: "A", text: "first", rail: "current", cite: cite(1) })),
      store.mutate((d) => fileClaim(d, { label: "a", text: "second", rail: "open", cite: cite(2) })),
      store.mutate((d) => fileClaim(d, { label: "b", title: "B", text: "third", rail: "current", cite: cite(3) })),
    ]);
    const onDisk = parseCabinet(JSON.parse(await readFile(file, "utf8")));
    expect(onDisk.sources).toHaveLength(1);
    expect(onDisk.claims.map((c) => c.id)).toEqual(["a-1", "a-2", "b-1"]);
  });

  it("a missing file stays an error when the store is read-only", async () => {
    await expect(Store.open("/nonexistent/tw/x.json", { writable: false })).rejects.toThrow();
  });
});

describe("file tools over MCP", () => {
  function textOf(result: { content: unknown }): string {
    return (result.content as Array<{ type: string; text?: string }>).map((b) => b.text ?? "").join("\n");
  }

  it("files a thread, then a claim that supersedes the seed's current rule, and the card follows", async () => {
    const seed = await loadCabinet(SEED);
    const server = createServer(Store.inMemory(seed, true));
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await server.connect(st);
    const client = new Client({ name: "t", version: "0" });
    await client.connect(ct);

    const filed = await client.callTool({
      name: "file_thread",
      arguments: { platform: "Gemini", title: "June bond revision", date: "2026-06-10", label: "bond-rule", messages: [{ id: "g1", text: "Provider bond drops to $50k from July." }] },
    });
    expect(filed.isError).toBeFalsy();
    expect(textOf(filed)).toContain('Filed Gemini, 2026-06-10, "June bond revision" (1 messages).');
    expect(textOf(filed)).toContain("The provider supplies the $75k bond.");

    const current = (await client.callTool({ name: "locate_label", arguments: { label: "bond-rule" } })).structuredContent as { current: Array<{ id: string }> };
    const liveId = current.current[0]!.id;

    const claimed = await client.callTool({
      name: "file_claim",
      arguments: {
        label: "bond-rule", rail: "current", text: "The provider supplies a $50k bond from July. Margin recovers that cost first; remaining profit splits 80/20.",
        cite: { platform: "Gemini", date: "2026-06-10", thread: "June bond revision" }, supersedes: [liveId],
      },
    });
    expect(claimed.isError).toBeFalsy();
    expect(textOf(claimed)).toContain("Filed on the current rail of bond-rule");

    const voice = textOf(await client.callTool({ name: "continue_voice", arguments: { label: "bond-rule", mode: "loud" } }));
    expect(voice).toContain("replaced on 10 June 2026");
    const pack = textOf(await client.callTool({ name: "continue", arguments: { label: "bond-rule" } }));
    expect(pack).toContain("- The provider supplies a $50k bond from July.");
    expect(pack).not.toContain("- The provider supplies the $75k bond.");
    expect(pack).toContain("There are 2 superseded versions. Ask if you want them.");

    const gone = await client.callTool({ name: "unfile", arguments: { thread: { platform: "Gemini", title: "June bond revision" } } });
    expect(textOf(gone)).toContain("Unfiled 1 claim from this card");
    expect(textOf(gone)).toContain("Off this card only: it still exists wherever it was written.");
    const after = textOf(await client.callTool({ name: "continue", arguments: { label: "bond-rule" } }));
    expect(after).toContain("Nothing is current on this shelf.");

    await client.close();
    await server.close();
  });
});
