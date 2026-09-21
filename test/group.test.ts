import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { loadCabinet } from "../src/cabinet.js";
import { openDesk } from "../src/index.js";
import { fileClaim, fileThread, unfile } from "../src/file.js";
import { parseCabinet, type Cabinet } from "../src/schema.js";
import { createServer } from "../src/server.js";
import { Store, emptyCabinet } from "../src/store.js";

const GROUP_SEED = new URL("../seed/bond-factory-group.json", import.meta.url).pathname;
const PRIVATE_SEED = new URL("../seed/bond-factory.json", import.meta.url).pathname;

function textOf(result: { content: unknown }): string {
  return (result.content as Array<{ type: string; text?: string }>).map((b) => b.text ?? "").join("\n");
}

async function connect(server: ReturnType<typeof createServer>) {
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st);
  const client = new Client({ name: "t", version: "0" });
  await client.connect(ct);
  return { client, close: async () => { await client.close(); await server.close(); } };
}

const cite = (platform: "Grok" | "ChatGPT" | "Claude" | "Gemini", date: string, thread: string) => ({ platform, date, thread });

describe("group schema", () => {
  it("loads the group seed", async () => {
    const g = await loadCabinet(GROUP_SEED);
    expect(g.kind).toBe("group");
    expect(g.members.map((m) => m.id)).toEqual(["provider-desk", "renter-desk"]);
  });

  it("a group card needs members, and every claim says who filed it", async () => {
    const g = await loadCabinet(GROUP_SEED);
    expect(() => parseCabinet({ ...g, members: [] })).toThrow(/needs at least one member/);
    const noFiler = structuredClone(g);
    delete noFiler.claims[1]!.filedBy;
    expect(() => parseCabinet(noFiler)).toThrow(/must say who filed it/);
    const stranger = structuredClone(g);
    stranger.claims[1]!.filedBy = "nobody";
    expect(() => parseCabinet(stranger)).toThrow(/not a member/);
  });
});

describe("filing on a group card", () => {
  let g: Cabinet;
  const fresh = async () => structuredClone((g ??= await loadCabinet(GROUP_SEED)));

  it("needs a member, and the member must belong", async () => {
    const d = await fresh();
    const input = { label: "bond-rule", text: "x", rail: "open" as const, cite: cite("Gemini", "2026-06-01", "t") };
    expect(() => fileClaim(d, input)).toThrow(/Say who is filing/);
    expect(() => fileClaim(d, input, { member: "stranger" })).toThrow(/not a member .* Joining a group is done by its members/);
    const r = fileClaim(d, input, { member: "renter-desk" });
    expect(r.claim.filedBy).toBe("renter-desk");
    expect(() => parseCabinet(d)).not.toThrow();
  });

  it("only the member who filed a claim can unfile it", async () => {
    const d = await fresh();
    expect(() => unfile(d, { claimId: "bond-rule-2" }, { member: "renter-desk" })).toThrow(/filed by Provider desk\. Only the member who filed it can unfile it/);
    const r = unfile(d, { claimId: "bond-rule-2" }, { member: "provider-desk" });
    expect(r.claims.map((c) => c.id)).toEqual(["bond-rule-2"]);
  });

  it("only the member who filed a thread can unfile or refile it", async () => {
    const d = await fresh();
    const thread = { platform: "Gemini" as const, title: "June revision", date: "2026-06-10", messages: [{ text: "hi" }] };
    fileThread(d, thread, { member: "renter-desk" });
    expect(() => fileThread(d, thread, { member: "provider-desk" })).toThrow(/already on this card, filed by Renter desk/);
    expect(() => unfile(d, { thread: { platform: "Gemini", title: "June revision" } }, { member: "provider-desk" })).toThrow(/filed by Renter desk/);
    expect(unfile(d, { thread: { platform: "Gemini", title: "June revision" } }, { member: "renter-desk" }).source?.title).toBe("June revision");
  });

  it("a private cabinet ignores the member", async () => {
    const d = emptyCabinet("mine");
    const r = fileClaim(d, { label: "a", title: "A", text: "x", rail: "open", cite: cite("Gemini", "2026-06-01", "t") }, { member: "whoever" });
    expect(r.claim.filedBy).toBeUndefined();
  });
});

describe("desk", () => {
  it("refuses a group card to a non-member, and a non-group file as a group", async () => {
    await expect(openDesk({ THREADWEAVER_GROUP: GROUP_SEED, THREADWEAVER_MEMBER: "stranger" })).rejects.toThrow(/not a member .* nothing was read/);
    await expect(openDesk({ THREADWEAVER_GROUP: GROUP_SEED })).rejects.toThrow(/needs THREADWEAVER_MEMBER/);
    await expect(openDesk({ THREADWEAVER_GROUP: PRIVATE_SEED, THREADWEAVER_MEMBER: "x" })).rejects.toThrow(/is a sample cabinet, not a group card/);
  });

  it("with nothing set, serves the read-only sample", async () => {
    const desk = await openDesk({});
    expect(desk.card.writable).toBe(false);
    expect(desk.member).toBeUndefined();
    expect(desk.privateCabinet).toBeUndefined();
  });

  it("reads the group card by default and mixes the private cabinet only when asked", async () => {
    const group = Store.inMemory(await loadCabinet(GROUP_SEED));
    const mine = emptyCabinet("mine");
    // A private restatement of the group's current rule, and a private note the group has never seen.
    fileClaim(mine, { label: "bond-rule", title: "Bond", text: "The provider supplies the $75k bond. Margin recovers that cost first; remaining profit splits 80/20.", rail: "current", cite: cite("Gemini", "2026-05-18", "My notes") });
    fileClaim(mine, { label: "bond-rule", text: "Ask legal whether the bond is assignable.", rail: "open", cite: cite("Gemini", "2026-05-19", "My notes") });
    fileClaim(mine, { label: "side-letter", title: "Side letter", text: "There is a side letter on the renter's insurance.", rail: "current", cite: cite("Perplexity" as never, "2026-05-19", "My notes") });
    const priv = Store.inMemory(mine);
    const { client, close } = await connect(createServer({ card: group, privateCabinet: priv, member: "renter-desk" }));

    const plain = textOf(await client.callTool({ name: "continue", arguments: { label: "bond-rule" } }));
    expect(plain).toContain("(filed by Provider desk)");
    expect(plain).not.toContain("private");
    expect(plain).not.toContain("assignable");

    const mixed = textOf(await client.callTool({ name: "continue", arguments: { label: "bond-rule", includePrivate: true } }));
    expect(mixed).toContain('Also filed in: your private cabinet, Gemini, 2026-05-18, "My notes"');
    expect(mixed).toContain("## From your private cabinet (not on this card)");
    expect(mixed).toContain("- [open, private] Ask legal whether the bond is assignable.");
    expect(mixed.match(/The provider supplies the \$75k bond/g)).toHaveLength(1);

    const labels = textOf(await client.callTool({ name: "list_labels", arguments: { includePrivate: true } }));
    expect(labels).toContain("side-letter — Side letter (private cabinet only)");
    expect(textOf(await client.callTool({ name: "list_labels", arguments: {} }))).not.toContain("side-letter");

    const onlyPrivate = textOf(await client.callTool({ name: "locate_label", arguments: { label: "side-letter", includePrivate: true } }));
    expect(onlyPrivate).toContain("(not on this card)");
    expect(onlyPrivate).toContain("- [current, private] There is a side letter");
    expect((await client.callTool({ name: "locate_label", arguments: { label: "side-letter" } })).isError).toBe(true);

    const search = textOf(await client.callTool({ name: "search_current", arguments: { query: "assignable", includePrivate: true } }));
    expect(search).toContain("[open, private] bond-rule: Ask legal");
    expect(textOf(await client.callTool({ name: "search_current", arguments: { query: "assignable" } }))).toContain("I do not have a cite");

    await close();
  });

  it("asking for the private cabinet when there is none is a tool error", async () => {
    const group = Store.inMemory(await loadCabinet(GROUP_SEED));
    const { client, close } = await connect(createServer({ card: group, member: "renter-desk" }));
    const r = await client.callTool({ name: "continue", arguments: { label: "bond-rule", includePrivate: true } });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain("No private cabinet is configured");
    await close();
  });

  it("files to the card as the member by default, to the private cabinet on request, and unfile never touches the private cabinet", async () => {
    const group = Store.inMemory(await loadCabinet(GROUP_SEED));
    const priv = Store.inMemory(emptyCabinet("mine"));
    const { client, close } = await connect(createServer({ card: group, privateCabinet: priv, member: "renter-desk" }));

    const onCard = await client.callTool({
      name: "file_claim",
      arguments: { label: "residual-basis", text: "Monthly pool, per the June call.", rail: "current", cite: cite("Gemini", "2026-06-10", "June call") },
    });
    expect(onCard.isError).toBeFalsy();
    expect(textOf(onCard)).toContain("(filed by Renter desk)");
    expect(group.cabinet.claims.at(-1)?.filedBy).toBe("renter-desk");

    const toPrivate = await client.callTool({
      name: "file_claim",
      arguments: { label: "residual-basis", title: "Residual", text: "My own note on the pool.", rail: "open", cite: cite("Gemini", "2026-06-11", "My notes"), to: "private" },
    });
    expect(toPrivate.isError).toBeFalsy();
    expect(priv.cabinet.claims).toHaveLength(1);
    expect(priv.cabinet.claims[0]?.filedBy).toBeUndefined();
    expect(group.cabinet.claims.some((c) => c.text.startsWith("My own note"))).toBe(false);

    const theirs = await client.callTool({ name: "unfile", arguments: { claimId: "bond-rule-2" } });
    expect(theirs.isError).toBe(true);
    expect(textOf(theirs)).toContain("filed by Provider desk");

    const gone = await client.callTool({ name: "unfile", arguments: { thread: { platform: "Gemini", title: "June call" } } });
    expect(gone.isError).toBeFalsy();
    expect(textOf(gone)).toContain("your private cabinet included");
    expect(priv.cabinet.claims).toHaveLength(1);
    await close();
  });
});

describe("two members, one file", () => {
  it("each desk sees the other's filing on the next read, and neither loses a write", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "tw-group-"));
    const file = path.join(dir, "group.json");
    await writeFile(file, await readFile(GROUP_SEED, "utf8"));
    const a = await Store.open(file, { writable: true });
    const b = await Store.open(file, { writable: true });

    await a.mutate((d) => fileClaim(d, { label: "residual-basis", text: "A says monthly pool.", rail: "current", cite: cite("Gemini", "2026-06-10", "A thread") }, { member: "provider-desk" }));
    await b.refresh();
    expect(b.shelves.locate("residual-basis").current.map((c) => c.text)).toEqual(["A says monthly pool."]);

    await b.mutate((d) => fileClaim(d, { label: "residual-basis", text: "B says per load.", rail: "current", cite: cite("Gemini", "2026-06-11", "B thread") }, { member: "renter-desk" }));
    await a.refresh();
    expect(a.shelves.locate("residual-basis").current.map((c) => c.text)).toEqual(["A says monthly pool.", "B says per load."]);

    // A stale store still picks up the newest file before applying its own change.
    const c = await Store.open(file, { writable: true });
    await a.mutate((d) => fileClaim(d, { label: "bond-rule", text: "Provider note.", rail: "open", cite: cite("Gemini", "2026-06-12", "A thread") }, { member: "provider-desk" }));
    await c.mutate((d) => fileClaim(d, { label: "bond-rule", text: "Third desk note.", rail: "open", cite: cite("Gemini", "2026-06-12", "C thread") }, { member: "renter-desk" }));
    const onDisk = parseCabinet(JSON.parse(await readFile(file, "utf8")));
    expect(onDisk.claims.filter((x) => x.label === "bond-rule" && x.rail === "open")).toHaveLength(2);
    expect(onDisk.claims.filter((x) => x.label === "residual-basis" && x.rail === "current")).toHaveLength(2);
  });
});
