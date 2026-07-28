import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  prepareContext,
  repositoryStats,
  taskHistory,
} from "../../../packages/core/src/index.js";
import { indexRepository } from "../../../packages/indexer/src/index.js";

function asText(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
  };
}

export async function startMcpServer(): Promise<void> {
  const server = new McpServer(
    {
      name: "context-pilot",
      version: "0.1.0",
    },
    {
      instructions:
        "Use prepare_context before broad repository exploration when the user asks for coding, debugging, review, or architecture work. Pass the active repository's absolute root and the user's task. Prefer the returned focused context; inspect additional files only when necessary. Use diff_context for Git review tasks. Token counts are estimates.",
    },
  );

  server.registerTool(
    "prepare_context",
    {
      description:
        "Index a repository and generate a compact, task-aware Markdown context bundle.",
      inputSchema: {
        root: z.string().describe("Absolute repository root"),
        task: z.string().min(1).describe("Developer task"),
        budget: z.number().int().positive().default(12_000),
        output: z.string().optional().describe("Optional output path"),
        maxFiles: z.number().int().positive().default(24),
      },
    },
    async ({ root, task, budget, output, maxFiles }) => {
      const result = await prepareContext({
        root: resolve(root),
        task,
        budget,
        maxFiles,
        ...(output ? { output } : {}),
      });
      return asText({
        outputPath: result.outputPath,
        selectedFiles: result.selected.map(({ file, score, reasons }) => ({
          path: file.path,
          score,
          reasons,
        })),
        changedFiles: result.changedFiles,
        usage: result.usage,
        markdown: result.markdown,
      });
    },
  );

  server.registerTool(
    "index_repository",
    {
      description: "Build or refresh ContextPilot's local repository summary index.",
      inputSchema: {
        root: z.string().describe("Absolute repository root"),
      },
    },
    async ({ root }) => {
      const result = await indexRepository(resolve(root));
      return asText({
        scanned: result.scanned,
        updated: result.updated,
        reused: result.reused,
        skipped: result.skipped,
        durationMs: result.durationMs,
        files: result.files.map(({ path, language, lines, summary, symbols }) => ({
          path,
          language,
          lines,
          summary,
          symbols,
        })),
      });
    },
  );

  server.registerTool(
    "diff_context",
    {
      description: "Generate focused review context for a Git revision range.",
      inputSchema: {
        root: z.string().describe("Absolute repository root"),
        range: z.string().default("HEAD").describe("Git revision or BASE...HEAD range"),
        task: z.string().default("Review the selected Git changes"),
        budget: z.number().int().positive().default(16_000),
      },
    },
    async ({ root, range, task, budget }) => {
      const result = await prepareContext({
        root: resolve(root),
        task,
        budget,
        diffRange: range,
        maxFiles: 36,
      });
      return asText({
        outputPath: result.outputPath,
        changedFiles: result.changedFiles,
        selectedFiles: result.selected.map(({ file }) => file.path),
        usage: result.usage,
        markdown: result.markdown,
      });
    },
  );

  server.registerTool(
    "context_stats",
    {
      description: "Return local ContextPilot cache statistics for a repository.",
      inputSchema: {
        root: z.string().describe("Absolute repository root"),
      },
    },
    async ({ root }) => asText(await repositoryStats(resolve(root))),
  );

  server.registerTool(
    "context_history",
    {
      description:
        "Summarize estimated context usage and reduction for previous ContextPilot tasks.",
      inputSchema: {
        root: z.string().describe("Absolute repository root"),
        limit: z.number().int().positive().default(20),
      },
    },
    async ({ root, limit }) => {
      const runs = await taskHistory(resolve(root), limit);
      const without = runs.reduce(
        (total, run) => total + run.estimatedWithoutContextPilotTokens,
        0,
      );
      const withPilot = runs.reduce(
        (total, run) => total + run.estimatedWithContextPilotTokens,
        0,
      );
      const saved = Math.max(0, without - withPilot);
      return asText({
        tasks: runs,
        summary: {
          taskCount: runs.length,
          estimatedWithoutContextPilotTokens: without,
          estimatedWithContextPilotTokens: withPilot,
          estimatedTokensSaved: saved,
          estimatedContextReductionPercent: without > 0 ? (saved / without) * 100 : 0,
        },
      });
    },
  );

  await server.connect(new StdioServerTransport());
}

const entry = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : undefined;
if (entry === import.meta.url) {
  startMcpServer().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
