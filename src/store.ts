import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { Shelves } from "./cabinet.js";
import { parseCabinet, type Cabinet } from "./schema.js";

/**
 * Holds one cabinet and writes it back after every accepted change.
 * Every mutation is re-checked against the rails before it touches disk.
 */
export class Store {
  private shelvesCache: Shelves | null = null;
  /** Mutations run one at a time, in arrival order, so no change is built on a stale draft. */
  private queue: Promise<unknown> = Promise.resolve();

  private constructor(
    readonly path: string | null,
    private current: Cabinet,
    readonly writable: boolean,
  ) {}

  /** Open a cabinet file. A missing file becomes an empty private cabinet named after it. */
  static async open(file: string, options: { writable: boolean }): Promise<Store> {
    let cabinet: Cabinet;
    try {
      cabinet = parseCabinet(JSON.parse(await readFile(file, "utf8")));
    } catch (err) {
      if (!isMissing(err) || !options.writable) throw err;
      cabinet = emptyCabinet(path.basename(file, path.extname(file)));
      await writeAtomic(file, cabinet);
    }
    return new Store(file, cabinet, options.writable);
  }

  static inMemory(cabinet: Cabinet, writable = true): Store {
    return new Store(null, parseCabinet(cabinet), writable);
  }

  get cabinet(): Cabinet {
    return this.current;
  }

  get shelves(): Shelves {
    this.shelvesCache ??= new Shelves(this.current);
    return this.shelvesCache;
  }

  /**
   * Apply a change to a draft copy. If the result passes the rail checks it is written
   * and becomes current; otherwise nothing changes and the error is thrown.
   */
  mutate<T>(change: (draft: Cabinet) => T): Promise<T> {
    if (!this.writable) return Promise.reject(new ReadOnlyCabinet());
    const run = this.queue.then(() => this.apply(change));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async apply<T>(change: (draft: Cabinet) => T): Promise<T> {
    const draft = structuredClone(this.current);
    const result = change(draft);
    const next = parseCabinet(draft);
    if (this.path) await writeAtomic(this.path, next);
    this.current = next;
    this.shelvesCache = null;
    return result;
  }
}

export class ReadOnlyCabinet extends Error {
  constructor() {
    super("This cabinet is read-only. Set THREADWEAVER_CABINET to a file of your own and restart.");
  }
}

export function emptyCabinet(name: string): Cabinet {
  return { name, kind: "private", labels: [], claims: [], sources: [] };
}

let writeSeq = 0;

async function writeAtomic(file: string, cabinet: Cabinet): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${++writeSeq}.tmp`;
  await writeFile(tmp, `${JSON.stringify(cabinet, null, 2)}\n`, "utf8");
  await rename(tmp, file);
}

function isMissing(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "ENOENT";
}
