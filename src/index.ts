#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { loadCabinet } from "./cabinet.js";
import { createServer } from "./server.js";

const here = path.dirname(fileURLToPath(import.meta.url));
export const SEED_CABINET = path.resolve(here, "..", "seed", "bond-factory.json");

async function main(): Promise<void> {
  const cabinetPath = process.env["THREADWEAVER_CABINET"] ?? SEED_CABINET;
  const cabinet = await loadCabinet(cabinetPath);
  const server = createServer(cabinet);
  await server.connect(new StdioServerTransport());
  // stdout is the protocol channel; anything for a human goes to stderr.
  console.error(`threadweaver: serving ${cabinet.kind} cabinet "${cabinet.name}" from ${cabinetPath}`);
}

main().catch((err: unknown) => {
  console.error("threadweaver: the card is unreachable.", err instanceof Error ? err.message : err);
  process.exit(1);
});
