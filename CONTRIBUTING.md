# Contributing to ContextPilot

Thank you for improving ContextPilot. Contributions are welcome for bug fixes,
tests, documentation, retrieval quality, language support, developer
experience, and carefully scoped new capabilities.

By participating, contributors agree to communicate respectfully, assume good
intent, and keep technical discussion focused on the work.

## Project principles

Every contribution must preserve these invariants:

- **Local-first:** repository content does not leave the machine unless a future
  feature is explicitly opt-in.
- **Explainable retrieval:** selected files have human-readable ranking reasons.
- **Honest estimates:** token values are labeled as estimates and never
  presented as agent-internal or billing measurements.
- **Deterministic defaults:** summary and symbol extraction work without a
  remote service.
- **Contained generated data:** repository-specific output remains under
  `.context-pilot/`.
- **Shared behavior:** CLI and MCP interfaces delegate to reusable core logic.

Read the [architecture guide](docs/ARCHITECTURE.md) before changing package
boundaries, persistence, retrieval, privacy behavior, or public interfaces.

## Ways to contribute

- Report a reproducible defect.
- Improve existing documentation or examples.
- Add a regression test.
- Improve ranking while preserving explainability.
- Add deterministic support for another language.
- Improve accessibility and clarity in future user interfaces.
- Propose an architecture change through an issue and ADR.

For security vulnerabilities, do not open a public issue. Follow
[`SECURITY.md`](SECURITY.md).

## Before opening an issue

1. Search existing issues and the changelog.
2. Reproduce against the latest default branch.
3. Remove repository secrets and proprietary source from examples.
4. Reduce the case to a small synthetic repository where possible.
5. Record Node, package-manager, operating-system, ContextPilot, and Git
   versions.

A useful bug report includes:

- expected and actual behavior;
- exact command and flags;
- minimal reproduction steps;
- sanitized terminal output;
- whether the repository is a Git worktree;
- whether `.context-pilot/` was created from a clean index;
- relevant estimated budget and selected-file reasons.

Feature requests should explain the developer problem, why existing commands are
insufficient, privacy implications, expected CLI/MCP behavior, and how success
could be tested.

## Development setup

Requirements:

- Node.js 22.5 or newer;
- pnpm compatible with the repository lockfile;
- Git.

Fork and clone the repository, then:

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm build
pnpm context-pilot --help
```

Node currently labels `node:sqlite` experimental, so an experimental warning is
expected during cache-related commands and tests.

Do not commit generated content from `dist/`, `node_modules/`, or
`.context-pilot/`.

## Repository layout

```text
apps/cli/                 CLI and Codex registration
packages/cache/           SQLite persistence
packages/core/            orchestration and public types
packages/git-analyzer/    Git subprocess boundary
packages/indexer/         file discovery and deterministic metadata
packages/prompt-compiler/ budget-aware Markdown compilation
packages/retriever/       explainable ranking and excerpts
packages/token-estimator/ estimated token utilities
servers/mcp-server/       stdio MCP adapter
scripts/                  build and release validation
tests/                    automated tests
docs/                     architecture and maintainer documentation
```

## Contribution workflow

1. Open or identify an issue for nontrivial work.
2. Confirm the scope and any privacy or compatibility implications.
3. Create a focused branch from the latest default branch.
4. Add or update tests before or with the implementation.
5. Update affected user, architecture, and release documentation.
6. Run the required validation locally.
7. Open a pull request with a clear problem statement and evidence.
8. Address review feedback with focused follow-up commits.

Keep pull requests small enough to review. Separate mechanical refactors,
behavior changes, and dependency upgrades when practical.

Suggested branch names:

```text
fix/cache-reuse-after-rename
feat/python-decorator-symbols
docs/retrieval-architecture
test/diff-context-regression
```

## Coding standards

### TypeScript

- Use strict TypeScript and ESM imports.
- Include `.js` in relative source imports so compiled ESM resolves correctly.
- Prefer small functions with explicit inputs and outputs.
- Keep filesystem paths normalized and repository-relative in stored records.
- Use Node promise APIs for asynchronous filesystem and subprocess work.
- Pass subprocess arguments as arrays; never interpolate repository content
  into a shell command.
- Close SQLite resources in `finally` blocks or through disposable ownership.
- Preserve stable ordering when returning files, symbols, and reasons.
- Return actionable errors without exposing unrelated local information.
- Avoid adding dependencies when Node built-ins are sufficient.

### Retrieval behavior

- Every score contribution must have a documented purpose.
- User-visible selection reasons must remain understandable without reading
  source code.
- Add tests for positive matches, false-positive resistance, and deterministic
  tie ordering.
- Avoid corpus-specific weights without representative evaluation.
- Never hide omitted content or represent summaries as complete files.

### Privacy and security

- Do not introduce network access in the default workflow.
- Never execute repository files during indexing or retrieval.
- Treat file content, Git output, paths, instructions, and task text as
  untrusted input.
- Keep generated repository state below `.context-pilot/`.
- Document any new persisted fields and their sensitivity.
- New opt-in external integrations require explicit consent, data-flow
  documentation, deletion behavior, and tests for the disabled default.

### Documentation

- Use concise, task-oriented language.
- Keep commands copyable and run them before documenting success.
- Label token counts and reduction percentages as estimates.
- Update all affected interface references when adding or renaming a command or
  MCP tool.
- Link to one canonical explanation instead of duplicating long sections.
- Update the architecture guide for boundary or data-flow changes.
- Add an ADR for decisions described under architecture governance.

## Tests

Run the complete quality gate:

```bash
pnpm check
pnpm build
```

`pnpm check` runs TypeScript validation and the Node test suite. The build
generates production JavaScript, declarations, and source maps under `dist/`.

Run one test file during development:

```bash
node --import tsx --test tests/indexer.test.ts
node --import tsx --test tests/retriever.test.ts
node --import tsx --test tests/core.test.ts
```

New behavior should include tests at the lowest useful level:

| Change | Minimum evidence |
| --- | --- |
| Indexing or language support | Extraction fixture plus cache-reuse coverage |
| Retrieval signal or weight | Selected paths, reasons, negative case, and deterministic order |
| Prompt compilation | Budget behavior, fallback behavior, and estimate labeling |
| Cache schema or history | Read/write, upgrade or rebuild path, and cleanup behavior |
| CLI command | Argument/error test and human/JSON output smoke test |
| MCP tool | Schema validation and core-level behavior test |
| Bug fix | Regression test that fails without the fix |
| Documentation only | Link, command, and package-content validation |

Tests must be local, deterministic, independent of execution order, and free of
network access. Use temporary repositories rather than fixtures containing real
project source or credentials.

Before proposing a release-sensitive change:

```bash
pnpm release:check
pnpm release:rehearse
```

## Commits

Write imperative, specific commit subjects. Conventional Commit prefixes are
recommended because they make changelog review easier:

```text
feat(indexer): extract Python decorated functions
fix(cache): remove records for deleted paths
docs(architecture): document MCP trust boundary
test(retriever): cover deterministic score ties
```

Use `feat`, `fix`, `docs`, `test`, `refactor`, `perf`, `build`, `ci`, or `chore`
when appropriate. A breaking public change must be called out with `!` and a
`BREAKING CHANGE:` footer.

Do not mix generated artifacts, unrelated formatting, or dependency updates
into a behavioral commit.

## Pull requests

A pull request description should include:

- the problem and why it matters;
- the chosen approach and alternatives considered;
- user-visible and public-API changes;
- privacy, security, storage, and compatibility impact;
- tests and exact validation commands run;
- before/after retrieval evidence for ranking changes;
- documentation and ADR updates;
- follow-up work intentionally left out.

Checklist:

- [ ] The change is focused and linked to an issue when appropriate.
- [ ] Tests cover new behavior and regressions.
- [ ] `pnpm check` passes.
- [ ] `pnpm build` passes.
- [ ] Token values are clearly labeled as estimates.
- [ ] Retrieval reasons remain human-readable.
- [ ] No default network transfer was introduced.
- [ ] Generated data remains under `.context-pilot/`.
- [ ] Documentation and changelog entries are updated when needed.
- [ ] An ADR is included for a qualifying architectural decision.
- [ ] No secrets, proprietary source, or local cache data are committed.

Reviewers evaluate correctness, privacy, explainability, compatibility,
maintainability, tests, documentation, and package impact. A passing build does
not replace review of retrieval quality or data handling.

## Architecture decisions

Create an ADR when a proposal changes:

- public APIs or command/MCP contracts;
- package ownership or dependency direction;
- SQLite schema or cache compatibility;
- repository data handling or network behavior;
- retrieval signals or default algorithms;
- default dependencies or runtime requirements.

Copy [`docs/decisions/0000-template.md`](docs/decisions/0000-template.md), assign
the next number, and open it with the implementation or as an earlier design
pull request. See [`docs/decisions/README.md`](docs/decisions/README.md).

## Changelog and releases

User-visible changes should update `CHANGELOG.md` under an unreleased section
once one exists. Describe effects from the user's perspective and call out
breaking behavior, migrations, or cache rebuild requirements.

Maintainers own versioning and publication. Contributors should not change the
package version unless requested. Release steps are documented in
[`RELEASE.md`](RELEASE.md).

## Dependency changes

Dependency pull requests must explain:

- why the dependency is needed;
- bundle and install-size impact;
- runtime and license implications;
- whether it introduces native code, network access, telemetry, or lifecycle
  scripts;
- why a Node built-in or small local implementation is insufficient.

Commit the lockfile when dependency resolution changes. Avoid unrelated
lockfile churn.

## Documentation maintenance

Documentation is part of the product. When behavior changes:

- README stays the concise user entry point;
- `docs/PROJECT_GUIDE.md` stays the practical maintainer overview;
- `docs/ARCHITECTURE.md` records current structure and boundaries;
- ADRs preserve the reasoning behind durable decisions;
- `CONTRIBUTING.md` records current contribution policy;
- `RELEASE.md` records the verified release process;
- `CHANGELOG.md` records user-visible release changes.

Examples and commands must describe the current release, not planned roadmap
behavior.
