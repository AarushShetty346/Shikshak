# Notes for AI coding agents

Start with [docs/HANDOFF.md](docs/HANDOFF.md). It has the current state, the architecture map,
what's live, what's left before the 31 Oct 2026 deadline, and the traps we already hit.

The essentials:

- **Checks:** run `npm run check` (type-check, oxlint, tests, build) before saying anything works.
  Run `npm run test:e2e` for UI changes.
- **`main` deploys to production** (Render), and every deploy wipes learner data.
  - Work on a branch and merge with `--no-ff`. Never force-push `main`.
  - Docs-only commits: add `[skip render]` to the message.
- **Don't run `npm run bolna:setup` unless the person you're working for asks.** It changes the
  live voice agents. `TOOLS_TOKEN` in `.env` must match Render's.
- **Never commit `.env` or print keys.** Never commit `docs/research/` or `docs/submission/`.
- **Don't spend money or place calls** (voice minutes, phone calls, paid model runs) without the
  person's explicit go-ahead. The Bolna wallet is small ($5.48 on 31 Oct).
- **No fabricated results, and label anything unverified.** Practice marks are always "not official".
- **Commit as the person you're working for**, never as someone else on the team.
