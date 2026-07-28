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
Add an npm automation or granular access token as the repository secret
`NPM_TOKEN`, then:

```bash
git tag v0.1.0
git push origin v0.1.0
```

Do not create or push the tag until the package name, npm ownership, changelog,
and release checks have been confirmed.
