# ContextPilot

ContextPilot is a local-first context optimizer for coding agents. It indexes a
repository, ranks files and symbols for a task, reuses cached summaries, and
compiles a compact Markdown context bundle that fits a configurable token
budget.

> ContextPilot reports estimates. It cannot see or change a coding agent's
> internal prompt, cache, or billing data.

## What works today

- Local repository indexing with sensible ignore rules
- Content-addressed SQLite summary cache
- Language-aware symbol extraction for TypeScript, JavaScript, Python, Go,
  Rust, Java, C#, Ruby, and PHP
- Task-aware lexical ranking with Git-change and dependency signals
- Symbol-level excerpts instead of whole large files
- Hierarchical `AGENTS.md` discovery
- Budgeted Markdown context bundles and usage reports
- Per-task and cumulative estimated token-reduction history
- Git diff context for pull-request review
- Optional MCP server exposing `prepare_context`, `index_repository`, and
  `diff_context`

The VS Code extension is the next delivery milestone; the reusable core and
machine-readable `--json` output are intentionally in place for that client.

The first release deliberately avoids embeddings. The ranking is explainable,
fast, private, and useful without downloading a model or running a database
service.

## Documentation

- [Project guide](docs/PROJECT_GUIDE.md) — overview, architecture, installation,
  important modules, development, and testing
- [Architecture](docs/ARCHITECTURE.md) — boundaries, data flow, design
  decisions, privacy, reliability, and extension points
- [Contributing](CONTRIBUTING.md) — development workflow, standards, tests, and
  pull-request expectations
- [Security policy](SECURITY.md) — supported versions and private reporting
- [Release guide](RELEASE.md) — local rehearsal and npm publishing
- [Changelog](CHANGELOG.md) — release history

## Requirements

- Node.js 22.5 or newer (`node:sqlite` is used for the local cache)
- Git (optional, but recommended)

## Install

Install the published CLI globally:

```bash
npm install --global codex-context-pilot
```

The npm package is named `codex-context-pilot`; the installed command is
`context-pilot`.

To develop from source:

```bash
pnpm install
pnpm build
pnpm link --global
```

For development, run the CLI directly:

```bash
pnpm context-pilot --help
```

## Quick start

```bash
# Build or refresh the local index.
pnpm context-pilot index

# Prepare a context bundle for a coding task.
pnpm context-pilot prepare \
  --task "Fix duplicate invoice numbers under concurrent requests" \
  --budget 12000

# Produce review context for a branch.
pnpm context-pilot diff-context main...HEAD --budget 16000

# Inspect cache and repository statistics.
pnpm context-pilot stats

# Compare estimated usage across recent tasks.
pnpm context-pilot history --limit 20
```

`prepare` writes a file under `.context-pilot/tasks/` and prints a usage
estimate. The generated prompt tells the coding agent which files and symbols
matter, preserves applicable repository instructions, and identifies content
that was omitted to stay within budget.

## Connect to the Codex app

After installing globally, let ContextPilot add its local stdio MCP server to
Codex:

```bash
context-pilot codex install
```

Restart the Codex app, then type `/mcp` in the composer and confirm that
`context-pilot` is connected. The Codex app, CLI, and IDE extension share MCP
configuration on the same host.

You can inspect the connection or print the manual configuration:

```bash
context-pilot codex status
context-pilot codex config
```

The equivalent `~/.codex/config.toml` entry is:

```toml
[mcp_servers.context-pilot]
command = "context-pilot"
args = ["mcp"]
startup_timeout_sec = 20
tool_timeout_sec = 120
enabled = true
```

In Codex, ask:

```text
Use ContextPilot to prepare focused context for this task before exploring the
repository: fix duplicate invoice-number generation under concurrency.
```

ContextPilot exposes `prepare_context`, `index_repository`, `diff_context`, and
`context_stats`, plus `context_history`. Its MCP instructions encourage Codex to
prepare focused context before broad repository exploration.

## Commands

### `context-pilot index`

Scans the repository and stores deterministic file summaries in
`.context-pilot/cache.db`. Unchanged files reuse their cached record.

```bash
context-pilot index [--root PATH] [--json]
```

### `context-pilot prepare`

```bash
context-pilot prepare \
  --task "Add refund approval workflow" \
  [--budget 12000] \
  [--root PATH] \
  [--output PATH] \
  [--json]
```

Context priority is:

1. Task
2. Applicable `AGENTS.md` instructions
3. Current Git changes
4. Matching symbols and source excerpts
5. Tests
6. Compact file summaries

### `context-pilot diff-context`

```bash
context-pilot diff-context [BASE...HEAD] [--budget 16000] [--output PATH]
```

Changed files receive the strongest ranking boost. Imported dependencies and
related tests are then included when budget permits.

### `context-pilot mcp`

Starts the MCP server over stdio:

```bash
context-pilot mcp
```

Example Codex MCP configuration:

```toml
[mcp_servers.context-pilot]
command = "context-pilot"
args = ["mcp"]
```

### `context-pilot codex`

```bash
context-pilot codex install  # Register the MCP server with Codex
context-pilot codex status   # Show configured MCP servers
context-pilot codex config   # Print the config.toml snippet
```

### `context-pilot history`

Every successful `prepare` or `diff-context` run stores an estimated comparison:

```text
Task: Add refund approval workflow
Without ContextPilot: ~31,420 tokens
With ContextPilot:    ~11,960 tokens
Estimated saved:      ~19,460 tokens
Estimated reduction:  61.9%
```

Review individual tasks and a cumulative summary:

```bash
context-pilot history --limit 20
context-pilot history --limit 100 --json
```

“Without ContextPilot” is a full indexable-repository baseline, not a
measurement of what Codex would actually have loaded. “With ContextPilot” is
the estimated size of the generated task bundle. ContextPilot cannot observe
Codex’s hidden context, prompt cache, output tokens, or billing.

## Generated data

ContextPilot writes only to `.context-pilot/` in the target repository:

```text
.context-pilot/
├── cache.db
└── tasks/
    └── fix-duplicate-invoice-numbers.md
```

Delete this directory at any time to rebuild all local metadata.

## Architecture

```text
apps/
└── cli/                  Command-line interface
packages/
├── cache/                SQLite cache
├── core/                 Orchestration and shared types
├── git-analyzer/         Git diff/change detection
├── indexer/              File walking and symbol extraction
├── prompt-compiler/      Budget-aware Markdown bundles
├── retriever/            Explainable relevance ranking
└── token-estimator/      Conservative token estimates
servers/
└── mcp-server/           MCP tools over the same core
```

## Development

```bash
pnpm typecheck
pnpm test
pnpm quality
pnpm build
pnpm release:check
npm run release:rehearse
```

## Releasing

The npm package name is `codex-context-pilot`, while its global executable
remains `context-pilot`.

```bash
npm login
pnpm release:check
npm publish
```

Pushing a `v*` tag also triggers the npm release workflow. Configure the
repository's `NPM_TOKEN` secret before using that workflow.

## Roadmap

- Tree-sitter parsers for more precise symbol boundaries and references
- VS Code extension with preview, pin, and exclude controls
- Optional local embeddings for semantic retrieval
- Incremental file watching
- LSP reference enrichment
- Reusable project knowledge graph
- Measured retrieval benchmarks across real repositories

## License

MIT
