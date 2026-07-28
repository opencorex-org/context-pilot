#!/usr/bin/env node
import { resolve } from "node:path";
import { execFile } from "node:child_process";
import { realpathSync } from "node:fs";
import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import {
  repositoryStats,
  prepareContext,
  taskHistory,
} from "../../../packages/core/src/index.js";
import { indexRepository } from "../../../packages/indexer/src/index.js";

const execFileAsync = promisify(execFile);

interface ParsedArguments {
  command?: string;
  positional: string[];
  flags: Map<string, string | boolean>;
}

function parseArguments(argv: string[]): ParsedArguments {
  const [command, ...rest] = argv;
  const positional: string[] = [];
  const flags = new Map<string, string | boolean>();
  for (let index = 0; index < rest.length; index += 1) {
    const value = rest[index];
    if (!value) continue;
    if (!value.startsWith("--")) {
      positional.push(value);
      continue;
    }
    const [rawKey, inlineValue] = value.slice(2).split("=", 2);
    if (!rawKey) continue;
    const next = rest[index + 1];
    if (inlineValue !== undefined) {
      flags.set(rawKey, inlineValue);
    } else if (next && !next.startsWith("--")) {
      flags.set(rawKey, next);
      index += 1;
    } else {
      flags.set(rawKey, true);
    }
  }
  return { ...(command ? { command } : {}), positional, flags };
}

function stringFlag(args: ParsedArguments, name: string): string | undefined {
  const value = args.flags.get(name);
  return typeof value === "string" ? value : undefined;
}

function numberFlag(args: ParsedArguments, name: string, fallback: number): number {
  const value = stringFlag(args, name);
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`--${name} must be a positive integer`);
  }
  return parsed;
}

function printHelp(): void {
  console.log(`ContextPilot — compact repository context for coding agents

Usage:
  context-pilot index [--root PATH] [--json]
  context-pilot prepare --task TEXT [--budget 12000] [--output PATH] [--json]
  context-pilot diff-context [BASE...HEAD] [--budget 16000] [--output PATH] [--json]
  context-pilot stats [--root PATH] [--json]
  context-pilot history [--root PATH] [--limit 20] [--json]
  context-pilot mcp
  context-pilot codex install
  context-pilot codex status
  context-pilot codex config

Options:
  --root PATH       Repository root (default: current directory)
  --task TEXT       Developer task to optimize context for
  --budget TOKENS   Maximum estimated bundle size
  --output PATH     Output Markdown path
  --max-files N     Maximum candidates before budget compilation
  --limit N         Number of task-history records to show
  --json            Emit machine-readable output
  --help            Show this help
  --version         Show the installed version`);
}

function printCodexConfig(): void {
  console.log(`[mcp_servers.context-pilot]
command = "context-pilot"
args = ["mcp"]
startup_timeout_sec = 20
tool_timeout_sec = 120
enabled = true`);
}

async function executeCodex(args: string[]) {
  try {
    return await execFileAsync("codex", args, { encoding: "utf8" });
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) {
      throw error;
    }
  }

  const candidates = [
    "/Applications/ChatGPT.app/Contents/Resources/codex",
    "/Applications/Codex.app/Contents/Resources/codex",
    resolve(homedir(), "Applications/ChatGPT.app/Contents/Resources/codex"),
    resolve(homedir(), "Applications/Codex.app/Contents/Resources/codex"),
  ];
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return await execFileAsync(candidate, args, { encoding: "utf8" });
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        continue;
      }
      throw error;
    }
  }
  throw new Error(
    "Codex CLI was not found on PATH or inside the ChatGPT/Codex application bundle.",
  );
}

async function runCodexCommand(action: string | undefined): Promise<void> {
  switch (action) {
    case "install": {
      try {
        const { stdout, stderr } = await executeCodex([
          "mcp",
          "add",
          "context-pilot",
          "--",
          "context-pilot",
          "mcp",
        ]);
        if (stdout.trim()) console.log(stdout.trim());
        if (stderr.trim()) console.error(stderr.trim());
        console.log("ContextPilot was added to Codex. Restart the Codex app, then use /mcp to verify it.");
      } catch (error) {
        const detail =
          error && typeof error === "object" && "stderr" in error
            ? String(error.stderr).trim()
            : error instanceof Error
              ? error.message
              : String(error);
        throw new Error(
          `Could not configure Codex automatically. ${detail}\n\nAdd this to ~/.codex/config.toml instead:\n\n${captureCodexConfig()}`,
        );
      }
      return;
    }
    case "status": {
      const { stdout, stderr } = await executeCodex(["mcp", "list"]);
      if (stdout.trim()) console.log(stdout.trim());
      if (stderr.trim()) console.error(stderr.trim());
      return;
    }
    case "config":
      printCodexConfig();
      return;
    default:
      throw new Error("codex requires one of: install, status, config");
  }
}

function captureCodexConfig(): string {
  return `[mcp_servers.context-pilot]
command = "context-pilot"
args = ["mcp"]
startup_timeout_sec = 20
tool_timeout_sec = 120
enabled = true`;
}

function reportPrepare(result: Awaited<ReturnType<typeof prepareContext>>): void {
  console.log(`Context bundle: ${result.outputPath}`);
  console.log(`Selected files: ${result.selected.length}`);
  console.log(`Changed files: ${result.changedFiles.length}`);
  console.log(
    `Without ContextPilot: ~${result.usage.estimatedWithoutContextPilotTokens.toLocaleString()} tokens`,
  );
  console.log(
    `With ContextPilot: ~${result.usage.estimatedWithContextPilotTokens.toLocaleString()} tokens`,
  );
  console.log(
    `Estimated saved: ~${result.usage.estimatedTokensSaved.toLocaleString()} tokens`,
  );
  console.log(
    `Estimated reduction: ${result.usage.estimatedContextReductionPercent.toFixed(1)}%`,
  );
  console.log(
    `Index: ${result.index.updated} updated, ${result.index.reused} reused, ${result.index.skipped} skipped`,
  );
}

async function run(argv = process.argv.slice(2)): Promise<void> {
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    printHelp();
    return;
  }
  if (argv[0] === "--version" || argv[0] === "-v") {
    console.log("0.1.0");
    return;
  }
  const args = parseArguments(argv);
  if (!args.command || args.command === "help" || args.flags.has("help")) {
    printHelp();
    return;
  }
  const root = resolve(stringFlag(args, "root") ?? process.cwd());
  const json = args.flags.has("json");

  switch (args.command) {
    case "index": {
      const result = await indexRepository(root);
      if (json) console.log(JSON.stringify(result, null, 2));
      else
        console.log(
          `Indexed ${result.files.length} files in ${result.durationMs}ms (${result.updated} updated, ${result.reused} reused, ${result.skipped} skipped).`,
        );
      return;
    }
    case "prepare": {
      const task = stringFlag(args, "task") ?? args.positional.join(" ");
      if (!task) throw new Error("prepare requires --task \"...\"");
      const output = stringFlag(args, "output");
      const result = await prepareContext({
        root,
        task,
        budget: numberFlag(args, "budget", 12_000),
        maxFiles: numberFlag(args, "max-files", 24),
        ...(output ? { output } : {}),
      });
      if (json) {
        console.log(
          JSON.stringify(
            {
              outputPath: result.outputPath,
              selectedFiles: result.selected.map(({ file, score, reasons }) => ({
                path: file.path,
                score,
                reasons,
              })),
              changedFiles: result.changedFiles,
              usage: result.usage,
              index: {
                scanned: result.index.scanned,
                reused: result.index.reused,
                updated: result.index.updated,
                skipped: result.index.skipped,
                durationMs: result.index.durationMs,
              },
            },
            null,
            2,
          ),
        );
      } else reportPrepare(result);
      return;
    }
    case "diff-context": {
      const range = args.positional[0] ?? "HEAD";
      const task = stringFlag(args, "task") ?? `Review changes in ${range}`;
      const output = stringFlag(args, "output");
      const result = await prepareContext({
        root,
        task,
        budget: numberFlag(args, "budget", 16_000),
        maxFiles: numberFlag(args, "max-files", 36),
        diffRange: range,
        ...(output ? { output } : {}),
      });
      if (json) {
        console.log(
          JSON.stringify(
            {
              outputPath: result.outputPath,
              changedFiles: result.changedFiles,
              selectedFiles: result.selected.map(({ file }) => file.path),
              usage: result.usage,
            },
            null,
            2,
          ),
        );
      } else reportPrepare(result);
      return;
    }
    case "stats": {
      const stats = await repositoryStats(root);
      if (json) console.log(JSON.stringify(stats, null, 2));
      else {
        console.log(`Cache: ${stats.databasePath}`);
        console.log(`Entries: ${stats.entries}`);
        console.log(`Indexed bytes: ${stats.totalBytes.toLocaleString()}`);
      }
      return;
    }
    case "history": {
      const runs = await taskHistory(root, numberFlag(args, "limit", 20));
      if (json) {
        console.log(JSON.stringify(runs, null, 2));
      } else if (!runs.length) {
        console.log("No ContextPilot task runs have been recorded.");
      } else {
        for (const run of runs) {
          console.log(`${run.createdAt}  ${run.task}`);
          console.log(
            `  without ~${run.estimatedWithoutContextPilotTokens.toLocaleString()} · with ~${run.estimatedWithContextPilotTokens.toLocaleString()} · saved ~${run.estimatedTokensSaved.toLocaleString()} · reduction ${run.estimatedContextReductionPercent.toFixed(1)}%`,
          );
        }
        const without = runs.reduce(
          (total, run) => total + run.estimatedWithoutContextPilotTokens,
          0,
        );
        const withPilot = runs.reduce(
          (total, run) => total + run.estimatedWithContextPilotTokens,
          0,
        );
        const saved = Math.max(0, without - withPilot);
        const reduction = without > 0 ? (saved / without) * 100 : 0;
        console.log(
          `\nSummary (${runs.length} tasks): without ~${without.toLocaleString()} · with ~${withPilot.toLocaleString()} · saved ~${saved.toLocaleString()} · reduction ${reduction.toFixed(1)}%`,
        );
      }
      return;
    }
    case "mcp": {
      const { startMcpServer } = await import("../../../servers/mcp-server/src/index.js");
      await startMcpServer();
      return;
    }
    case "codex":
      await runCodexCommand(args.positional[0]);
      return;
    default:
      throw new Error(`Unknown command: ${args.command}`);
  }
}

const entry = process.argv[1]
  ? pathToFileURL(realpathSync(resolve(process.argv[1]))).href
  : undefined;
if (entry === import.meta.url) {
  run().catch((error: unknown) => {
    console.error(`context-pilot: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}

export { parseArguments, run };
