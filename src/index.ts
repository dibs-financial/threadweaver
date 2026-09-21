#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { Desk } from "./desk.js";
import { createServer } from "./server.js";
import { Store } from "./store.js";

const here = path.dirname(fileURLToPath(import.meta.url));
export const SEED_CABINET = path.resolve(here, "..", "seed", "bond-factory.json");

/**
 * THREADWEAVER_CABINET  your private cabinet (created empty if missing)
 * THREADWEAVER_GROUP    a group card you are a member of
 * THREADWEAVER_MEMBER   your member id on that card
 * Nothing set: the read-only sample cabinet.
 */
export async function openDesk(env: NodeJS.ProcessEnv): Promise<Desk> {
  const own = env["THREADWEAVER_CABINET"];
  const group = env["THREADWEAVER_GROUP"];
  const member = env["THREADWEAVER_MEMBER"];

  const privateCabinet = own !== undefined ? await Store.open(own, { writable: true }) : undefined;

  if (group !== undefined) {
    if (!member) throw new Error("THREADWEAVER_GROUP needs THREADWEAVER_MEMBER: say who sits at this desk.");
    const card = await Store.open(group, { writable: true });
    const c = card.cabinet;
    if (c.kind !== "group") throw new Error(`${group} is a ${c.kind} cabinet, not a group card.`);
    if (!c.members.some((m) => m.id === member)) {
      throw new Error(`"${member}" is not a member of ${c.name}. Joining is done by its members; nothing was read.`);
    }
    return { card, privateCabinet, member };
  }
  if (privateCabinet) return { card: privateCabinet };
  // The seed ships with the package and stays as shipped. Filing needs a cabinet of your own.
  return { card: await Store.open(SEED_CABINET, { writable: false }) };
}

async function main(): Promise<void> {
  const desk = await openDesk(process.env);
  const server = createServer(desk);
  await server.connect(new StdioServerTransport());
  // stdout is the protocol channel; anything for a human goes to stderr.
  const { name, kind } = desk.card.cabinet;
  const extra = [
    desk.member ? `as ${desk.member}` : "",
    desk.privateCabinet ? `with private cabinet "${desk.privateCabinet.cabinet.name}"` : "",
    desk.card.writable ? "" : "(read-only)",
  ]
    .filter(Boolean)
    .join(" ");
  console.error(`threadweaver: serving ${kind} cabinet "${name}" from ${desk.card.path ?? "memory"} ${extra}`.trim());
}

main().catch((err: unknown) => {
  console.error("threadweaver: the card is unreachable.", err instanceof Error ? err.message : err);
  process.exit(1);
});
