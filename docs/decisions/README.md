# Architecture decision records

Architecture Decision Records (ADRs) capture durable decisions that are costly
or confusing to infer from code alone.

Create an ADR for changes to public interfaces, package boundaries, persistence
format, privacy or network behavior, retrieval semantics, runtime requirements,
or default dependencies.

## Workflow

1. Copy `0000-template.md`.
2. Assign the next four-digit sequence number and a short kebab-case title.
3. Set the status to `Proposed`.
4. Describe context, decision drivers, considered options, and consequences.
5. Review the ADR with or before the implementation.
6. Change the status to `Accepted` when the decision is approved.
7. Keep superseded ADRs and link both the old and replacement records.

Example filename:

```text
0001-adopt-tree-sitter-symbol-extraction.md
```

## Status values

- `Proposed`
- `Accepted`
- `Rejected`
- `Deprecated`
- `Superseded by ADR-NNNN`

ADRs describe decisions and rationale. The current implementation remains
documented in `docs/ARCHITECTURE.md`.
