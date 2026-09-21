import { describe, expect, it } from "vitest";
import { Shelves, loadCabinet } from "../src/cabinet.js";
import { parseCabinet } from "../src/schema.js";
import { renderPack } from "../src/pack.js";
import { renderVoice } from "../src/voice.js";

const SEED = new URL("../seed/bond-factory.json", import.meta.url).pathname;

/** Raw ids must never reach a person. The seed deliberately carries some. */
const RAW_ID = /\b(m\d+|thr_[a-z0-9_]+|bond-rule-\d|residual-basis-\d)\b/;

describe("seed cabinet", () => {
  it("parses and cross-checks", async () => {
    const cabinet = await loadCabinet(SEED);
    expect(cabinet.kind).toBe("sample");
    expect(cabinet.labels.map((l) => l.name)).toEqual(["bond-rule", "residual-basis"]);
  });

  it("rejects a supersedes pointer at a claim that is still current", () => {
    const bad = {
      name: "x", kind: "private",
      labels: [{ name: "a", title: "A" }],
      claims: [
        { id: "1", label: "a", rail: "current", text: "old", cite: { platform: "Grok", date: "2026-01-01", thread: "t" } },
        { id: "2", label: "a", rail: "current", text: "new", cite: { platform: "Grok", date: "2026-02-01", thread: "t" }, supersedes: ["1"] },
      ],
    };
    expect(() => parseCabinet(bad)).toThrow(/sits on the current rail/);
  });

  it("rejects a superseded claim with no replacement named", () => {
    const bad = {
      name: "x", kind: "private",
      labels: [{ name: "a", title: "A" }],
      claims: [{ id: "1", label: "a", rail: "superseded", text: "old", cite: { platform: "Grok", date: "2026-01-01", thread: "t" } }],
    };
    expect(() => parseCabinet(bad)).toThrow(/must name what replaced it/);
  });
});

describe("shelves", () => {
  it("lists labels with counts per rail", async () => {
    const shelves = new Shelves(await loadCabinet(SEED));
    expect(shelves.listLabels()).toEqual([
      expect.objectContaining({ name: "bond-rule", current: 1, open: 0, superseded: 1 }),
      expect.objectContaining({ name: "residual-basis", current: 0, open: 1, superseded: 0 }),
    ]);
  });

  it("keeps history closed by default and offers it in one sentence", async () => {
    const shelves = new Shelves(await loadCabinet(SEED));
    const shelf = shelves.locate("bond-rule");
    expect(shelf.superseded).toBeUndefined();
    expect(shelf.historyNote).toBe("There is a superseded version. Ask if you want it.");
    expect(shelf.current[0]?.cite).toBe('Claude, 2026-05-14, "Bond Factory waterfall v2"');
    expect(shelf.current[0]?.copies).toEqual(['ChatGPT, 2026-05-16, "May waterfall"']);
  });

  it("opens history on request and labels the replacement", async () => {
    const shelves = new Shelves(await loadCabinet(SEED));
    const shelf = shelves.locate("bond-rule", true);
    expect(shelf.superseded).toHaveLength(1);
    expect(shelf.superseded?.[0]?.replaced).toBe('replaced on 2026-05-14 by Claude, 2026-05-14, "Bond Factory waterfall v2"');
  });

  it("never matches a superseded claim in search", async () => {
    const shelves = new Shelves(await loadCabinet(SEED));
    expect(shelves.searchCurrent("renter")).toEqual([]);
    const hits = shelves.searchCurrent("bond 80/20");
    expect(hits).toHaveLength(1);
    expect(hits[0]?.claim.rail).toBe("current");
    expect(shelves.searchCurrent("residual").map((h) => h.label)).toEqual(["residual-basis"]);
  });

  it("throws a named error for an unknown label", async () => {
    const shelves = new Shelves(await loadCabinet(SEED));
    expect(() => shelves.locate("nope")).toThrow(/No shelf named "nope"/);
  });
});

describe("continue pack", () => {
  it("answers the bond deal from current only, with a cite and a pointer to the copy", async () => {
    const shelves = new Shelves(await loadCabinet(SEED));
    const pack = renderPack(shelves.locate("bond-rule"));
    expect(pack).toContain("The provider supplies the $75k bond.");
    expect(pack).toContain('Cite: Claude, 2026-05-14, "Bond Factory waterfall v2"');
    expect(pack).toContain('Also filed in: ChatGPT, 2026-05-16, "May waterfall"');
    expect(pack).toContain("There is a superseded version. Ask if you want it.");
    expect(pack).not.toContain("renter");
    expect(pack).not.toMatch(RAW_ID);
  });

  it("labels history dead when opened", async () => {
    const shelves = new Shelves(await loadCabinet(SEED));
    const pack = renderPack(shelves.locate("bond-rule", true));
    expect(pack).toContain("[dead] The renter funds the $75k bond");
    expect(pack).toContain("Replaced on 2026-05-14 by Claude");
    expect(pack).not.toMatch(RAW_ID);
  });

  it("carries the open item's note about what it does not reopen", async () => {
    const shelves = new Shelves(await loadCabinet(SEED));
    const pack = renderPack(shelves.locate("residual-basis"));
    expect(pack).toContain("Note: This does not reopen who funds the bond.");
  });
});

describe("voice", () => {
  const words = (s: string) => s.trim().split(/\s+/).length;

  it("current: live rule first, spoken cite, one-line history offer", async () => {
    const shelves = new Shelves(await loadCabinet(SEED));
    const text = renderVoice(shelves.locate("bond-rule", true), "current");
    expect(text.startsWith("Current rule: The provider supplies the $75k bond.")).toBe(true);
    expect(text).toContain("That is from Claude, 14 May 2026, Bond Factory waterfall v2.");
    expect(text).toContain("There is a superseded version. Ask if you want it.");
    expect(text).not.toMatch(RAW_ID);
    expect(words(text)).toBeLessThanOrEqual(150);
  });

  it("chatty: one clause of history, then the live rule", async () => {
    const shelves = new Shelves(await loadCabinet(SEED));
    const text = renderVoice(shelves.locate("bond-rule", true), "chatty");
    expect(text.startsWith("It used to be that the renter funds the $75k bond")).toBe(true);
    expect(text).toContain("that changed on 14 May 2026. Current rule: The provider supplies");
    expect(words(text)).toBeLessThanOrEqual(150);
  });

  it("loud: the warning and the question, and nothing from the dead rail", async () => {
    const shelves = new Shelves(await loadCabinet(SEED));
    const text = renderVoice(shelves.locate("bond-rule", true), "loud");
    expect(text).toBe(
      "I have an older rule on file that was replaced on 14 May 2026. I will not treat it as current. Do you want the history or the live rule?",
    );
  });

  it("loud with no history falls through to the current rule", async () => {
    const shelves = new Shelves(await loadCabinet(SEED));
    const text = renderVoice(shelves.locate("residual-basis", true), "loud");
    expect(text).toContain("Nothing is current on How residual profit is measured.");
    expect(text).toContain("Still open: Residual basis: per-load or monthly pool. This does not reopen who funds the bond.");
  });
});
