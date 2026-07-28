# ContextPilot project guide

This guide is the practical entry point for users and new maintainers. For
deeper design rationale and contribution policy, see:

- [Architecture](ARCHITECTURE.md)
- [Contributing](../CONTRIBUTING.md)
- [Security policy](../SECURITY.md)
- [Architecture decisions](decisions/README.md)

## Project overview

ContextPilot is a local-first repository context optimizer for coding agents.
Given a developer task and a token budget, it indexes the repository, ranks the
most relevant files and symbols, and writes a compact Markdown task bundle to
`.context-pilot/tasks/`.

The default pipeline is deterministic and explainable:

- Repository content remains on the local machine.
- Every selected file includes human-readable ranking reasons.
- Unchanged file summaries are reused from a local SQLite cache.
- Large files are represented by relevant symbol or line excerpts when
  possible.
- Token counts and reduction percentages are estimates, not Codex billing or
  internal-context measurements.

ContextPilot can be used as a global CLI, as a library, or as a local stdio MCP
server for the Codex app, CLI, and IDE extension.

## Architecture

The `core` package coordinates the application:

```text
Developer task
      |
      v
Repository indexer ---> .context-pilot/cache.db
      |                        |
      |                        +-- cached deterministic file records
      v
Git analyzer + hierarchical AGENTS.md discovery
      |
      v
Explainable retriever
      |  ranks paths, symbols, summaries, changes, dependencies, and tests
      v
Prompt compiler
      |  applies the requested estimated-token budget
      v
.context-pilot/tasks/<task-slug>.md
```

### Indexing and caching

The indexer walks supported text and source files, skips generated and vendor
directories, extracts language, imports, symbols, and a deterministic summary,
then hashes the result. The cache stores each file record in
`.context-pilot/cache.db`; a matching path and hash reuses the existing record.
Records for deleted files are removed on a later index.

The same database stores task-run history, including the selected files,
budget, and estimated before/after context sizes. SQLite write-ahead logging is
enabled. ContextPilot currently uses Node's built-in `node:sqlite`, so supported
Node versions may print an experimental-feature warning.

### Retrieval

The retriever converts the task into normalized lexical terms and scores each
indexed file. Signals include:

- term matches in file names and paths;
- exported or declared symbol-name matches;
- summary matches;
- files changed in the selected Git range;
- dependencies of changed files and their dependents;
- related tests.

The returned records contain both a numeric score and readable reasons such as
`changed in Git`, `related test`, or `matched: invoice`. For selected files, the
retriever prefers matching symbol excerpts, then a window around a matching
line, then the whole file only when it is small.

### Budgeted prompt compilation

The prompt compiler prioritizes:

1. the developer task;
2. applicable root and directory-level `AGENTS.md` instructions;
3. current Git changes;
4. matching symbols and source excerpts;
5. related tests;
6. compact file summaries.

Lower-priority content is summarized or omitted as the budget is reached. The
result includes an estimated usage report. “Without ContextPilot” means the
estimated size of the indexable repository, while “With ContextPilot” means
the estimated size of the generated task bundle. Neither value reflects hidden
agent context, prompt caching, output tokens, billing, or exact tokenizer
behavior.

### Interfaces

The CLI and MCP server use the same core functions, so retrieval behavior is
consistent between terminal and Codex workflows.

The MCP server exposes:

- `prepare_context` — create task-aware context within a budget;
- `index_repository` — create or refresh the local index;
- `diff_context` — prepare context focused on a Git revision range;
- `context_stats` — inspect the local cache;
- `context_history` — inspect estimated usage across previous tasks.

## Important modules

| Module | Responsibility |
| --- | --- |
| `apps/cli` | Parses CLI commands, starts MCP mode, and manages Codex MCP registration. |
| `packages/core` | Orchestrates indexing, Git analysis, retrieval, instructions, prompt compilation, output, and history. |
| `packages/indexer` | Walks the repository and produces deterministic file, import, summary, and symbol records. |
| `packages/cache` | Persists file summaries and task history in local SQLite. |
| `packages/retriever` | Ranks relevant files with explainable lexical, symbol, Git, dependency, and test signals. |
| `packages/prompt-compiler` | Fits instructions, diff, excerpts, and summaries into an estimated-token budget. |
| `packages/token-estimator` | Provides approximate token counts and budget-aware truncation. |
| `packages/git-analyzer` | Reads the current commit, changed files, and diffs through Git. |
| `servers/mcp-server` | Publishes ContextPilot capabilities as local stdio MCP tools. |
| `tests` | Exercises core task preparation, indexing/cache reuse, and retrieval ranking. |
| `scripts` | Builds, verifies, rehearses, and smoke-tests the npm package. |

## Installation

### Install the published CLI

Requirements:

- Node.js 22.5 or newer;
- Git, recommended for change-aware retrieval;
- Codex, optional, when using MCP integration.

Install the npm package globally:

```bash
npm install --global codex-context-pilot
context-pilot --help
```

The npm package is named `codex-context-pilot`; its executable is
`context-pilot`.

To connect it to Codex:

```bash
context-pilot codex install
context-pilot codex status
```

Restart the Codex app after installation and confirm that `context-pilot` is
enabled in its MCP list. If automatic registration is unavailable, print the
configuration to add to `~/.codex/config.toml`:

```bash
context-pilot codex config
```

### Install from a source checkout

```bash
git clone https://github.com/opencorex-org/context-pilot.git
cd context-pilot
pnpm install
pnpm build
pnpm link --global
context-pilot --help
```

For a package-like local install without publishing to npm:

```bash
pnpm release:rehearse
npm install --global ./artifacts/codex-context-pilot-0.1.0.tgz
context-pilot --help
```

Use the tarball filename generated for the current package version.

## Basic usage

```bash
context-pilot index

context-pilot prepare \
  --task "Document the repository architecture" \
  --budget 8000

context-pilot diff-context main...HEAD --budget 16000
context-pilot stats
context-pilot history --limit 20
```

Generated repository data is confined to:

```text
.context-pilot/
├── cache.db
└── tasks/
    └── <task-slug>.md
```

The directory can be deleted safely when a clean re-index is needed.

## Development commands

Run commands from the repository root:

| Command | Purpose |
| --- | --- |
| `pnpm context-pilot --help` | Run the TypeScript CLI directly with `tsx`. |
| `pnpm mcp` | Start the TypeScript MCP server over stdio. |
| `pnpm typecheck` | Type-check without emitting JavaScript. |
| `pnpm test` | Run all Node test-runner suites through `tsx`. |
| `pnpm quality` | Run type-checking followed by tests. |
| `pnpm check` | Alias for the complete quality check. |
| `pnpm build` | Clean and compile production JavaScript and declarations into `dist/`. |
| `pnpm release:check` | Run tests and validate the source package configuration. |
| `pnpm release:rehearse` | Build a local npm tarball and run installed-package smoke checks without publishing. |

After TypeScript changes, run:

```bash
pnpm check
pnpm build
```

## Testing

The test suite uses Node's built-in test runner with TypeScript loaded through
`tsx`. Test files are under `tests/*.test.ts`.

Run the complete suite:

```bash
pnpm test
```

Run one suite while developing:

```bash
node --import tsx --test tests/indexer.test.ts
node --import tsx --test tests/retriever.test.ts
node --import tsx --test tests/core.test.ts
```

The main coverage areas are:

- indexing supported files and reusing unchanged cache records;
- deterministic summaries and symbol extraction;
- explainable task-aware ranking;
- context bundle generation within the requested estimated-token budget;
- `.context-pilot/` output and task-history persistence.

Before a release, perform the full validation:

```bash
pnpm check
pnpm build
pnpm release:check
pnpm release:rehearse
```

The rehearsal is the preferred end-to-end local package check because it
installs the packed artifact in an isolated location and exercises the same
files users receive from npm.
