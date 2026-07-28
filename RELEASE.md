# Releasing ContextPilot

## Package identity

- npm package: `codex-context-pilot`
- global executable: `context-pilot`
- initial version: `0.1.0`
- registry access: public

The shorter npm name `context-pilot` is already owned by another publisher and
must not be used for this project.

## Local release

```bash
npm login
pnpm install --frozen-lockfile
pnpm release:check
npm publish
```

`release:check` runs the dependency-free Node.js tests and verifies the files
required by the published package. `pnpm quality` additionally runs the
TypeScript compiler when development dependencies are installed.

For an A-to-Z rehearsal in a disposable directory:

```bash
npm run release:rehearse
```

This copies the source, installs development dependencies in the temporary
copy, runs type checking and tests, creates the npm tarball, installs that
tarball under a temporary global prefix, and tests the installed CLI and MCP
server. It never installs ContextPilot globally or publishes the package.

After publishing:

```bash
npm install --global codex-context-pilot
context-pilot --help
context-pilot codex install
context-pilot codex status
```

Restart the Codex app and enter `/mcp` to verify the server.

## GitHub release

The workflow in `.github/workflows/release.yml` publishes tags matching `v*`.
The publish job runs only in the canonical `opencorex-org/context-pilot`
repository; matching tags in forks are skipped.

Add an npm automation or granular access token as the repository secret
`NPM_TOKEN`, then:

```bash
git fetch upstream main
git tag --annotate v0.1.0 upstream/main --message "Release v0.1.0"
git push upstream refs/tags/v0.1.0
```

Use the package version from `package.json` as the tag version. The explicit
`refs/tags/` push prevents a same-named branch from being pushed accidentally.
Do not create or push the tag until `NPM_TOKEN`, npm package ownership,
changelog, and release checks have been confirmed.
