import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";

const sourceOnly = process.argv.includes("--source");
const requiredFiles = [
  ...(sourceOnly
    ? [
        "apps/cli/src/index.ts",
        "packages/core/src/index.ts",
        "servers/mcp-server/src/index.ts",
      ]
    : [
        "dist/apps/cli/src/index.js",
        "dist/apps/cli/src/index.d.ts",
        "dist/packages/core/src/index.js",
        "dist/packages/core/src/index.d.ts",
        "dist/servers/mcp-server/src/index.js",
      ]),
  "README.md",
  "LICENSE",
];

for (const path of requiredFiles) {
  await access(path, constants.R_OK);
}

const manifest = JSON.parse(await readFile("package.json", "utf8"));
if (manifest.private) throw new Error("package.json must not be private");
if (manifest.name !== "codex-context-pilot") {
  throw new Error("Unexpected npm package name");
}
if (manifest.bin?.["context-pilot"] !== "dist/apps/cli/src/index.js") {
  throw new Error("The context-pilot global binary is not configured correctly");
}

const cli = await readFile(
  sourceOnly ? "apps/cli/src/index.ts" : "dist/apps/cli/src/index.js",
  "utf8",
);
if (!cli.startsWith("#!/usr/bin/env node")) {
  throw new Error("The published CLI is missing its Node.js shebang");
}

console.log(
  sourceOnly
    ? `Source ${manifest.name}@${manifest.version} is ready for release rehearsal.`
    : `Package ${manifest.name}@${manifest.version} is ready to pack.`,
);
