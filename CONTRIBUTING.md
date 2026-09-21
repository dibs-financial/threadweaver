# Contributing

## Ground rules

- **Current wins.** A change that lets a superseded claim read as current is a
  regression, whatever else it improves.
- **Every live claim carries a cite.** Platform + date + thread title. Never a
  raw message id in anything a person reads or hears.
- **Vendor-blind.** Nothing in this repo may favour one model's threads over
  another's.
- **No vacuuming.** Nothing is ingested unless someone files it.

## Reporting a wrong answer

Open an issue with the **card said the wrong thing** template. Give the label,
what the card answered, what it should have answered, and the cite for the
claim that should have won. Screenshots of chat windows are not reproducible;
cites are.

## Pull requests

1. Branch from `main`.
2. Keep one change per pull request. A docs fix and a schema change are two
   PRs.
3. Run the docs check locally before pushing:

   ```sh
   npx markdownlint-cli2 "**/*.md"
   ```

4. Describe the change in terms of the rails: what becomes current, what
   becomes open, what is superseded, and by which cite.
5. Wait for the `docs` check to pass and for a code owner review.

## Commit messages

Short imperative subject line, under 72 characters. Body explains why, not
what. The diff already says what.

## License

By contributing you agree that your contribution is licensed under the MIT
License in `LICENSE`.
