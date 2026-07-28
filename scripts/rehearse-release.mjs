import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const temporaryRoot = await mkdtemp(join(tmpdir(), "context-pilot-release-"));
const source = join(temporaryRoot, "source");
const prefix = join(temporaryRoot, "global");
const excluded = new Set([
  ".context-pilot",
  ".git",
  ".pnpm-store",
  "node_modules",
]);

async function run(command, args, cwd = source) {
  process.stdout.write(`\n$ ${command} ${args.join(" ")}\n`);
  const { stdout, stderr } = await execFileAsync(command, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
    env: {
      ...process.env,
      npm_config_cache: join(tmpdir(), "context-pilot-release-npm-cache"),
    },
  });
  if (stdout) process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);
  return stdout;
}

try {
  await cp(process.cwd(), source, {
    recursive: true,
    filter: (path) => !excluded.has(basename(path)),
  });
  console.log(`Release rehearsal: ${temporaryRoot}`);

  await run("npm", ["install", "--ignore-scripts"]);
  await run("npm", ["run", "quality"]);
  await run("npm", ["run", "release:check"]);

  const packOutput = await run("npm", [
    "pack",
    "--json",
    "--pack-destination",
    temporaryRoot,
  ]);
  const jsonStart = packOutput.indexOf("[");
  if (jsonStart < 0) throw new Error("npm pack did not return JSON output");
  const packed = JSON.parse(packOutput.slice(jsonStart));
  const filename = packed[0]?.filename;
  if (!filename) throw new Error("npm pack did not return a tarball filename");
  const tarball = join(temporaryRoot, filename);

  await run("npm", [
    "install",
    "--global",
    tarball,
    "--prefix",
    prefix,
    "--ignore-scripts",
  ]);
  const binary = join(prefix, "bin", "context-pilot");
  await run("node", [join(source, "scripts", "smoke-installed.mjs"), binary]);

  const manifest = JSON.parse(await readFile(join(source, "package.json"), "utf8"));
  console.log(`\nRelease rehearsal passed for ${manifest.name}@${manifest.version}.`);
} finally {
  if (process.env.KEEP_CONTEXT_PILOT_RELEASE_REHEARSAL) {
    console.log(`Kept release rehearsal at ${temporaryRoot}`);
  } else {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}
