# ContextPilot repository instructions

- Keep ContextPilot local-first: repository content must not leave the machine
  unless a future feature is explicitly opt-in.
- Keep retrieval decisions explainable. Every selected file should have
  human-readable ranking reasons.
- Label token counts as estimates; never imply access to an agent's internal
  context or billing.
- Prefer deterministic summaries and symbol extraction in the default path.
- Run `pnpm check` and `pnpm build` after TypeScript changes.
- Keep generated repository data inside `.context-pilot/`.
