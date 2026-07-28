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
NPM_CONFIG_PROVENANCE=false npm publish --access public
```

Local terminals do not provide a supported CI identity for npm provenance.
Disable provenance only for the interactive bootstrap publication. GitHub
Actions enables provenance explicitly in its `npm publish` command.

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

For the first publication, create a granular npm access token with:

- read and write package permission;
- permission to publish `codex-context-pilot`;
- **Bypass two-factor authentication** enabled.

Add that token as the upstream repository Actions secret `NPM_TOKEN`, then:

```bash
git fetch upstream main
git tag --annotate v0.1.0 upstream/main --message "Release v0.1.0"
git push upstream refs/tags/v0.1.0
```

Use the package version from `package.json` as the tag version. The explicit
`refs/tags/` push prevents a same-named branch from being pushed accidentally.
Do not create or push the tag until `NPM_TOKEN`, npm package ownership,
changelog, and release checks have been confirmed.

### `EOTP` in GitHub Actions

An `EOTP` error means npm accepted the credential but requires an interactive
one-time password. GitHub Actions cannot complete that prompt. Recreate the
granular token with **Bypass two-factor authentication** enabled, replace the
`NPM_TOKEN` secret, and rerun the failed publish job.

Do not store a one-time password as a GitHub secret. OTP values expire and are
not a CI authentication mechanism.

## Trusted publishing after the first release

After `codex-context-pilot` exists on npm, migrate the workflow to npm Trusted
Publishing so releases use short-lived GitHub OIDC credentials instead of a
long-lived write token.

In the npm package's **Settings → Trusted Publisher**, configure:

- provider: GitHub Actions;
- organization: `opencorex-org`;
- repository: `context-pilot`;
- workflow filename: `release.yml`;
- allowed action: `npm publish`.

The workflow already grants `id-token: write` and uses a GitHub-hosted runner.
After one successful trusted-publishing release:

1. remove `NODE_AUTH_TOKEN` from the publish step;
2. delete the upstream `NPM_TOKEN` Actions secret;
3. revoke the npm write token;
4. configure the npm package to disallow traditional token publishing.
