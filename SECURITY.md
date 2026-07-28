# Security policy

## Supported versions

ContextPilot is currently in its initial release series. Security fixes are
provided for the latest published version only.

| Version | Supported |
| --- | --- |
| Latest published release | Yes |
| Older releases | No |
| Unreleased source builds | Best effort |

## Reporting a vulnerability

Do not report suspected vulnerabilities in a public issue, discussion, pull
request, or task bundle.

Use GitHub's private vulnerability reporting or security-advisory feature for
the repository:

`https://github.com/opencorex-org/context-pilot/security/advisories/new`

Include:

- affected version and operating system;
- vulnerability class and expected impact;
- minimal reproduction using synthetic repository content;
- required permissions or configuration;
- whether the issue affects CLI, library, MCP, cache, or packaging;
- suggested mitigation, if known.

Do not include real credentials, proprietary source code, or personal data.

Maintainers should acknowledge a complete report within seven days. Resolution
timing depends on severity and complexity. Reporters will be updated when the
issue is confirmed, when a fix is ready for validation, and when disclosure is
planned.

## Disclosure process

Maintainers will:

1. reproduce and assess scope;
2. develop the fix privately;
3. add regression coverage;
4. prepare an advisory and release notes;
5. publish a patched release;
6. disclose enough information for users to assess and remediate risk.

Please allow a reasonable remediation period before public disclosure.

## Security model

ContextPilot is local-first, but it processes untrusted repository content.
Important boundaries are:

- indexing reads files but must not execute them;
- Git is invoked with explicit arguments rather than interpolated shell input;
- MCP runs locally over stdio with the current user's filesystem permissions;
- generated summaries, excerpts, and task history are stored below
  `.context-pilot/`;
- no source upload, telemetry, or remote retrieval exists in the default path;
- ContextPilot is not a sandbox, authorization layer, or secret scanner.

Generated context bundles may contain sensitive source excerpts. Protect them
as repository source and do not attach them to public reports without review.

For the full threat and trust-boundary description, see
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md#privacy-and-security-model).
