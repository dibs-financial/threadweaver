# Revenue and pricing

Open server, paid cloud. Everything in this repository is MIT, group cards included. Revenue comes from running it for people and from the parts that only work hosted.

The numbers below are proposals to validate against real customers, not market facts. Nothing here carries a cite.

## Where the money comes from

ThreadWeaver never bills for inference. The person's own Grok, ChatGPT, Claude, or Gemini subscription does the reading and the filing. ThreadWeaver charges for the thing those subscriptions cannot give them: one card per decision that every model answers from. The meter is seats and cabinets, never tokens.

Five streams, in the order they turn on:

1. **Cloud, per person.** A hosted cabinet with sync across MCP clients and devices, the "file this thread" capture button in the browser, backups, and export. This is what the local server does not do.
2. **Team, per seat.** Hosted group cards. Members, unfile controls, copies across rooms, admin. The group logic is in the open server; the hosting and the multi-device sync are not.
3. **Business, per seat.** SSO, an audit log of every file and unfile, retention rules, and a self-hosted cloud for teams that will not put decisions in someone else's cloud.
4. **Enterprise, annual.** On-prem, dedicated support, and the filing service bundled in.
5. **Filing services, one-time.** Setup of a cabinet and filing of a backlog of old threads. Labor, priced as labor.

## Price points to test

| Tier | Price | What it unlocks |
|---|---|---|
| Local | $0 | The server, all eight tools, private and group cabinets as files, the seeds |
| Cloud | $10 per person per month | Hosted cabinet, sync across clients and devices, browser capture, backups, export |
| Team | $20 per seat per month, 3-seat minimum | Hosted group cards, member admin, unfile controls, copies across rooms |
| Business | $45 per seat per month | SSO, audit log, retention rules, self-hosted cloud, priority support |
| Enterprise | From $25k per year | On-prem, dedicated support, filing service included |
| Cabinet setup | $2,500 flat | Labels defined, first threads filed, rails checked |
| Backlog filing | $150 per hour | Old threads filed with cites, dead rules marked |

Three rules hold at every tier:

- **Export is free.** Nobody's decisions are held hostage. The format is open.
- **Unfile never deletes a personal thread.** At any price.
- **The local server does everything a single desk needs.** Cloud pays for hosting and capture, not for features held back.

## What is open and what is paid

The server, the cabinet format, the rails, the file verb, and group cards are MIT. A group card as a shared file works today for a team on one drive.

Paid is what needs a server on the internet: a hosted card with real concurrency instead of a shared file, capture from the chat interfaces, sync, audit, SSO, and support.

## Sequence

- **Now.** The repo ships Local. Cost is zero.
- **Phase 1, Cloud.** Hosted private cabinets with capture. Success looks like a person filing every week without being reminded.
- **Phase 2, Team.** Hosted group cards. This is where revenue starts to matter.
- **Phase 3, Business and Enterprise.** SSO, audit, self-host. Sell the filing service alongside every contract.

## The numbers to watch

**Activation** is one event: the first `file_claim` with `supersedes` set. That is when the card has held the line through a rule change. Before it, the product is a notebook. After it, it is a memory the person will not give up.

**Weekly `continue` calls per seat** says whether the card is being read. **Claims filed per week** says whether it is being fed. Both have to move, or churn follows.

**Group activation** is the first unfile refused because another member filed it. That is the moment a team learns the card is theirs, not one person's.
