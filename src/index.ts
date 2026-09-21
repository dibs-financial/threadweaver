#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createServer } from "./server.js";
import { Store } from "./store.js";

const here = path.dirname(fileURLToPath(import.meta.url));
export const SEED_CABINET = path.resolve(here, "..", "seed", "bond-factory.json");

async function main(): Promise<void> {
  const own = process.env["THREADWEAVER_CABINET"];
  const cabinetPath = own ?? SEED_CABINET;
  // The seed ships with the package and stays as shipped. Filing needs a cabinet of your own.
  const store = await Store.open(cabinetPath, { writable: own !== undefined });
  const server = createServer(store);
  await server.connect(new StdioServerTransport());
  // stdout is the protocol channel; anything for a human goes to stderr.
  const { name, kind } = store.cabinet;
  console.error(`threadweaver: serving ${kind} cabinet "${name}" from ${cabinetPath}${store.writable ? "" : " (read-only)"}`);
}

main().catch((err: unknown) => {
  console.error("threadweaver: the card is unreachable.", err instanceof Error ? err.message : err);
  process.exit(1);
});
