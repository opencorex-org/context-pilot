import { spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { createInterface } from "node:readline";
import { promisify } from "node:util";
import { execFile } from "node:child_process";

const execFileAsync = promisify(execFile);
const cli = process.argv[2];
if (!cli) throw new Error("Usage: node scripts/smoke-installed.mjs /path/to/context-pilot");

const temporaryRoot = await mkdtemp(join(tmpdir(), "context-pilot-installed-smoke-"));
const fixture = join(temporaryRoot, "repository");

async function run(args, options = {}) {
  const { stdout, stderr } = await execFileAsync(cli, args, {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
    ...options,
  });
  return { stdout, stderr };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function verifyMcp() {
  const child = spawn(cli, ["mcp"], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  const lines = createInterface({ input: child.stdout });
  const pending = new Map();
  let nextId = 1;
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  lines.on("line", (line) => {
    if (!line.trim()) return;
    const message = JSON.parse(line);
    if (message.id !== undefined && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(JSON.stringify(message.error)));
      else resolve(message.result);
    }
  });

  const request = (method, params) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
      setTimeout(() => {
        if (pending.delete(id)) reject(new Error(`MCP request timed out: ${method}\n${stderr}`));
      }, 10_000).unref();
    });

  try {
    const initialized = await request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "context-pilot-release-smoke", version: "1.0.0" },
    });
    assert(initialized.serverInfo?.name === "context-pilot", "Unexpected MCP server identity");
    child.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`,
    );
    const tools = await request("tools/list", {});
    const names = new Set(tools.tools.map((tool) => tool.name));
    for (const expected of [
      "prepare_context",
      "index_repository",
      "diff_context",
      "context_stats",
      "context_history",
    ]) {
      assert(names.has(expected), `Missing MCP tool: ${expected}`);
    }
    const result = await request("tools/call", {
      name: "prepare_context",
      arguments: {
        root: fixture,
        task: "Add invoice concurrency protection",
        budget: 2_000,
      },
    });
    const text = result.content?.find((item) => item.type === "text")?.text;
    const payload = JSON.parse(text);
    assert(payload.usage.estimatedTokensSaved >= 0, "MCP usage estimate missing");
  } finally {
    lines.close();
    child.kill("SIGTERM");
  }
}

try {
  await mkdir(join(fixture, "src"), { recursive: true });
  await mkdir(join(fixture, "tests"), { recursive: true });
  await writeFile(
    join(fixture, "AGENTS.md"),
    "# Repository instructions\n\n- Preserve the invoice API.\n",
  );
  await writeFile(
    join(fixture, "src", "invoice-service.ts"),
    "export function generateInvoiceNumber() { return `INV-${Date.now()}`; }\n",
  );
  await writeFile(
    join(fixture, "tests", "invoice-concurrency.test.ts"),
    "test('invoice number concurrency', () => {});\n",
  );

  const help = await run(["--help"]);
  assert(help.stdout.includes("ContextPilot"), "Global CLI help failed");
  const version = await run(["--version"]);
  assert(version.stdout.trim() === "0.1.0", "Global CLI version failed");

  const firstIndex = JSON.parse((await run(["index", "--root", fixture, "--json"])).stdout);
  const secondIndex = JSON.parse((await run(["index", "--root", fixture, "--json"])).stdout);
  assert(firstIndex.updated >= 3, "Initial global index did not update fixture files");
  assert(secondIndex.reused >= 3, "Second global index did not reuse the cache");

  const prepared = JSON.parse(
    (
      await run([
        "prepare",
        "--root",
        fixture,
        "--task",
        "Fix concurrent invoice number generation",
        "--budget",
        "2000",
        "--json",
      ])
    ).stdout,
  );
  assert(prepared.usage.estimatedWithoutContextPilotTokens > 0, "Missing baseline estimate");
  assert(prepared.usage.estimatedWithContextPilotTokens > 0, "Missing optimized estimate");
  assert(prepared.usage.estimatedTokensSaved >= 0, "Missing token savings estimate");
  const bundle = await readFile(prepared.outputPath, "utf8");
  assert(bundle.includes("Without ContextPilot"), "Generated usage report is incomplete");

  const history = JSON.parse(
    (await run(["history", "--root", fixture, "--limit", "20", "--json"])).stdout,
  );
  assert(history.length === 1, "Task history was not persisted");
  const stats = JSON.parse((await run(["stats", "--root", fixture, "--json"])).stdout);
  assert(stats.entries >= 3, "Cache statistics are incomplete");

  const config = await run(["codex", "config"]);
  assert(config.stdout.includes("[mcp_servers.context-pilot]"), "Codex config output failed");

  const fakeBin = join(temporaryRoot, "fake-bin");
  const fakeCodex = join(fakeBin, "codex");
  await mkdir(fakeBin);
  await writeFile(fakeCodex, "#!/bin/sh\nprintf '%s\\n' \"$*\"\n");
  await chmod(fakeCodex, 0o755);
  const installed = await run(["codex", "install"], {
    env: { ...process.env, PATH: `${fakeBin}${delimiter}${process.env.PATH ?? ""}` },
  });
  assert(
    installed.stdout.includes("mcp add context-pilot -- context-pilot mcp"),
    "Codex automatic configuration invoked unexpected arguments",
  );

  await verifyMcp();
  console.log("Installed-package smoke test passed: CLI, cache, prepare, history, Codex, and MCP.");
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
