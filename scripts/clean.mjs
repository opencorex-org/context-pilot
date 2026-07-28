import { rm } from "node:fs/promises";
import { basename, resolve } from "node:path";

const output = resolve("dist");
if (basename(output) !== "dist") {
  throw new Error(`Refusing to clean unexpected build path: ${output}`);
}

await rm(output, { recursive: true, force: true });
