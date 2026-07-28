import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { SummaryCache } from "../../cache/src/index.js";
import { getChangedFiles, getDiff } from "../../git-analyzer/src/index.js";
import { indexRepository } from "../../indexer/src/index.js";
import { compilePrompt } from "../../prompt-compiler/src/index.js";
import { retrieveFiles } from "../../retriever/src/index.js";
import { estimateRepositoryTokens } from "../../token-estimator/src/index.js";
import type {
  CacheStats,
  PrepareOptions,
  PrepareResult,
  TaskRunRecord,
} from "./types.js";

export * from "./types.js";

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 70) || "task"
  );
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await readFile(path);
    return true;
  } catch {
    return false;
  }
}

async function discoverInstructions(
  root: string,
  selectedPaths: string[],
): Promise<Array<{ path: string; content: string }>> {
  const candidates = new Set<string>(["AGENTS.md"]);
  for (const selectedPath of selectedPaths) {
    let directory = dirname(selectedPath);
    while (directory !== ".") {
      candidates.add(join(directory, "AGENTS.md"));
      const parent = dirname(directory);
      if (parent === directory) break;
      directory = parent;
    }
  }
  const instructions: Array<{ path: string; content: string }> = [];
  for (const path of candidates) {
    const absolute = join(root, path);
    if (await fileExists(absolute)) {
      instructions.push({ path, content: await readFile(absolute, "utf8") });
    }
  }
  return instructions;
}

export async function prepareContext(options: PrepareOptions): Promise<PrepareResult> {
  const root = resolve(options.root);
  const budget = Math.max(1_000, options.budget);
  const index = await indexRepository(root);
  const changedFiles = await getChangedFiles(root, options.diffRange);
  const ranked = await retrieveFiles(
    root,
    options.task,
    index.files,
    changedFiles,
    options.maxFiles ?? 24,
  );

  if (!ranked.length && index.files.length) {
    const fallback = index.files
      .filter((file) => /README|AGENTS|package\.json|pyproject\.toml|Cargo\.toml|go\.mod/i.test(file.path))
      .slice(0, 8)
      .map((file) => ({
        file,
        score: 1,
        reasons: ["repository overview fallback"],
        matchedTerms: [],
      }));
    ranked.push(...fallback);
  }

  const instructions = await discoverInstructions(
    root,
    ranked.map(({ file }) => file.path),
  );
  const diff = changedFiles.length ? await getDiff(root, options.diffRange) : undefined;
  const compiled = await compilePrompt({
    root,
    task: options.task,
    budget,
    ranked,
    changedFiles,
    instructions,
    repositoryEstimatedTokens: estimateRepositoryTokens(index.files),
    ...(diff ? { diff } : {}),
  });
  const defaultOutput = join(root, ".context-pilot", "tasks", `${slugify(options.task)}.md`);
  const outputPath = options.output
    ? isAbsolute(options.output)
      ? options.output
      : resolve(root, options.output)
    : defaultOutput;
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, compiled.markdown, "utf8");
  const historyCache = new SummaryCache(root);
  try {
    historyCache.recordTaskRun({
      task: options.task,
      createdAt: new Date().toISOString(),
      outputPath,
      estimatedWithoutContextPilotTokens:
        compiled.usage.estimatedWithoutContextPilotTokens,
      estimatedWithContextPilotTokens: compiled.usage.estimatedWithContextPilotTokens,
      estimatedTokensSaved: compiled.usage.estimatedTokensSaved,
      estimatedContextReductionPercent:
        compiled.usage.estimatedContextReductionPercent,
      budget,
      selectedFiles: compiled.included.map(({ file }) => file.path),
    });
  } finally {
    historyCache.close();
  }
  return {
    outputPath,
    markdown: compiled.markdown,
    selected: compiled.included,
    changedFiles,
    usage: compiled.usage,
    index,
  };
}

export async function repositoryStats(root: string): Promise<CacheStats> {
  const cache = new SummaryCache(resolve(root));
  try {
    return cache.stats();
  } finally {
    cache.close();
  }
}

export async function taskHistory(root: string, limit = 20): Promise<TaskRunRecord[]> {
  const cache = new SummaryCache(resolve(root));
  try {
    return cache.taskRuns(limit);
  } finally {
    cache.close();
  }
}

export function displayPath(path: string): string {
  return basename(path) === path ? path : resolve(path);
}
