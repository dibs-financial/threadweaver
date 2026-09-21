import { readFile } from "node:fs/promises";
import { formatCite, formatCopy } from "./cite.js";
import { parseCabinet, type Cabinet, type Claim, type Label, type Rail } from "./schema.js";

export async function loadCabinet(path: string): Promise<Cabinet> {
  const raw = await readFile(path, "utf8");
  return parseCabinet(JSON.parse(raw));
}

export interface LabelSummary {
  name: string;
  title: string;
  summary?: string;
  current: number;
  open: number;
  superseded: number;
}

export interface RenderedClaim {
  /** For the filer to reference in file_claim. Never rendered in prose. */
  id: string;
  rail: Rail;
  text: string;
  cite: string;
  note?: string;
  replaced?: string;
  copies: string[];
}

export interface Shelf {
  label: Label;
  current: RenderedClaim[];
  open: RenderedClaim[];
  /** Only filled when history was asked for. */
  superseded?: RenderedClaim[];
  /** Set when history exists but was not opened. */
  historyNote?: string;
}

export interface SearchHit {
  label: string;
  claim: RenderedClaim;
}

export class Shelves {
  private readonly byLabel = new Map<string, Label>();
  private readonly claimsByLabel = new Map<string, Claim[]>();
  private readonly byId = new Map<string, Claim>();

  constructor(readonly cabinet: Cabinet) {
    for (const label of cabinet.labels) {
      this.byLabel.set(label.name, label);
      this.claimsByLabel.set(label.name, []);
    }
    for (const claim of cabinet.claims) {
      this.byId.set(claim.id, claim);
      this.claimsByLabel.get(claim.label)?.push(claim);
    }
  }

  /** "I can talk about…" */
  listLabels(): LabelSummary[] {
    return this.cabinet.labels.map((label) => {
      const claims = this.claimsByLabel.get(label.name) ?? [];
      const count = (rail: Rail) => claims.filter((c) => c.rail === rail).length;
      return {
        name: label.name,
        title: label.title,
        ...(label.summary !== undefined ? { summary: label.summary } : {}),
        current: count("current"),
        open: count("open"),
        superseded: count("superseded"),
      };
    });
  }

  hasLabel(name: string): boolean {
    return this.byLabel.has(name);
  }

  /** Pull one shelf. History stays closed unless asked for. */
  locate(name: string, includeHistory = false): Shelf {
    const label = this.byLabel.get(name);
    if (!label) throw new UnknownLabel(name);
    const claims = this.claimsByLabel.get(name) ?? [];
    const on = (rail: Rail) => claims.filter((c) => c.rail === rail).map((c) => this.render(c));
    const superseded = on("superseded");
    const shelf: Shelf = { label, current: on("current"), open: on("open") };
    if (includeHistory) {
      shelf.superseded = superseded;
    } else if (superseded.length > 0) {
      shelf.historyNote =
        superseded.length === 1
          ? "There is a superseded version. Ask if you want it."
          : `There are ${superseded.length} superseded versions. Ask if you want them.`;
    }
    return shelf;
  }

  /** Search across current + open only. Superseded never matches. */
  searchCurrent(query: string): SearchHit[] {
    const terms = tokenize(query);
    if (terms.length === 0) return [];
    const hits: SearchHit[] = [];
    for (const claim of this.cabinet.claims) {
      if (claim.rail === "superseded") continue;
      const hay = `${claim.text} ${claim.note ?? ""} ${claim.label} ${claim.cite.thread}`.toLowerCase();
      if (terms.every((t) => hay.includes(t))) {
        hits.push({ label: claim.label, claim: this.render(claim) });
      }
    }
    return hits;
  }

  private render(claim: Claim): RenderedClaim {
    const out: RenderedClaim = {
      id: claim.id,
      rail: claim.rail,
      text: claim.text,
      cite: formatCite(claim.cite),
      copies: claim.copies.map(formatCopy),
    };
    if (claim.note !== undefined) out.note = claim.note;
    if (claim.rail === "superseded" && claim.supersededBy) {
      const by = this.byId.get(claim.supersededBy);
      const when = claim.supersededOn ?? by?.cite.date;
      out.replaced = by ? `replaced${when ? ` on ${when}` : ""} by ${formatCite(by.cite)}` : "replaced";
    }
    return out;
  }
}

export class UnknownLabel extends Error {
  constructor(readonly label: string) {
    super(`No shelf named "${label}". Ask list_labels for what is on file.`);
  }
}

function tokenize(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9$%.]+/)
    .filter((t) => t.length > 1);
}
