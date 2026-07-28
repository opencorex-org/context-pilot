import { chmod } from "node:fs/promises";

await chmod(new URL("../dist/apps/cli/src/index.js", import.meta.url), 0o755);
