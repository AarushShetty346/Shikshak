# Switch to openai:gpt-6-luna (31 Oct 2026)

A team decision, not a benchmark result. No model comparison was run: `npm run bench:models` needs an
`OPENAI_API_KEY`, and the team had none on submission day.

- What we know: Bolna's dashboard shows the same cost per minute for `gpt-6-luna` as for `gpt-5.4-mini`
  ($0.060 per minute for the whole call).
- What we don't know yet: whether luna picks the right tools, avoids giving answers away, or answers as fast.
  Check this in a short test class before the demo.
- Reasoning effort and verbosity are set to low, as the dashboard shows for this model, so replies stay quick
  and fit the 400-token limit.
- Roll back with `npm run bolna:model -- --rollback`, then `npm run bolna:setup`.
