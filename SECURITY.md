# Security

ThreadWeaver holds filed decisions and the cites behind them. Treat a cabinet as
confidential by default.

## Reporting a vulnerability

Do not open a public issue for a security problem.

Use **Security → Report a vulnerability** on this repository (GitHub private
vulnerability reporting). If that is not enabled, email the maintainer listed
in `CODEOWNERS` through their GitHub profile.

Include:

- what you found and where (file, tool, or endpoint)
- how to reproduce it
- what a filed cabinet could leak or how a card could be altered

You will get an acknowledgement within five business days.

## Scope

In scope:

- anything that lets one member read another member's private cabinet
- anything that lets a group member alter, unfile, or delete a thread they did
  not file
- anything that promotes a superseded claim to current without a filing
- secrets committed to this repository

Out of scope:

- the models themselves (Grok, ChatGPT, Claude, Gemini, Perplexity, RubyVox).
  Report those to their vendors.
- a model answering wrongly from a card that was itself filed wrongly. That is
  a bug, not a vulnerability. Open an issue with the cite.

## Secrets

Never commit `.env`, API keys, or exported cabinets. `.gitignore` covers the
usual paths. If a secret lands in history, rotate it first, then open a
private report so the history can be cleaned.
