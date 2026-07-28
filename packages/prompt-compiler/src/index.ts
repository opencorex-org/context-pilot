import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import type { RankedFile, UsageEstimate } from "../../core/src/types.js";
import { estimateTokens, truncateToTokens } from "../../token-estimator/src/index.js";

export interface CompileInput {
  root: string;
  task: string;
  budget: number;
  ranked: RankedFile[];
  changedFiles: string[];
  instructions: Array<{ path: string; content: string }>;
  repositoryEstimatedTokens: number;
  diff?: string;
}

export interface CompileResult {
  markdown: string;
  included: RankedFile[];
  usage: UsageEstimate;
}

function fenceFor(path: string): string {
  const extension = extname(path).slice(1);
  const aliases: Record<string, string> = {
    js: "javascript",
    jsx: "jsx",
    md: "markdown",
    py: "python",
    rb: "ruby",
    rs: "rust",
    sh: "bash",
    ts: "typescript",
    tsx: "tsx",
    yml: "yaml",
  };
  return aliases[extension] ?? extension;
}

function usageReport(usage: UsageEstimate): string {
  return [
    "## Estimated usage",
    "",
    "> Estimates only. ContextPilot cannot see the coding agent's internal prompt, cache, or billing.",
    "",
    `- Without ContextPilot (indexable repository baseline): ${usage.estimatedWithoutContextPilotTokens.toLocaleString()} tokens`,
    `- With ContextPilot (compiled task bundle): ${usage.estimatedWithContextPilotTokens.toLocaleString()} tokens`,
    `- Estimated tokens saved: ${usage.estimatedTokensSaved.toLocaleString()} tokens`,
    `- Estimated reduction: ${usage.estimatedContextReductionPercent.toFixed(1)}%`,
    "",
    `- Raw selected context: ${usage.rawSelectedTokens.toLocaleString()} tokens`,
    `- After symbol extraction: ${usage.afterSymbolExtractionTokens.toLocaleString()} tokens`,
    `- After summary compression: ${usage.afterSummaryCompressionTokens.toLocaleString()} tokens`,
    `- Instructions: ${usage.instructionTokens.toLocaleString()} tokens`,
    `- Budget usage: ${usage.estimatedTotalInputTokens.toLocaleString()} / ${usage.budget.toLocaleString()} tokens`,
  ].join("\n");
}

export async function compilePrompt(input: CompileInput): Promise<CompileResult> {
  const rawContents = await Promise.all(
    input.ranked.map(async ({ file }) => {
      try {
        return await readFile(join(input.root, file.path), "utf8");
      } catch {
        return "";
      }
    }),
  );
  const rawSelectedTokens = rawContents.reduce(
    (total, content) => total + estimateTokens(content, "code"),
    0,
  );
  const afterSymbolExtractionTokens = input.ranked.reduce(
    (total, item) => total + estimateTokens(item.excerpt ?? item.file.summary, "code"),
    0,
  );
  const instructionTokens = input.instructions.reduce(
    (total, instruction) => total + estimateTokens(instruction.content),
    0,
  );

  const headerParts = [
    "# ContextPilot task bundle",
    "",
    "## Task",
    "",
    input.task,
    "",
    "## Agent guidance",
    "",
    "- Implement the task using the focused context below.",
    "- Inspect additional repository files only when the bundle is insufficient.",
    "- Treat excerpts as partial files; preserve surrounding behavior when editing.",
    "- Run the repository's relevant validation commands after changes.",
  ];

  if (input.instructions.length) {
    headerParts.push("", "## Repository instructions", "");
    const instructionBudget = Math.max(200, Math.floor(input.budget * 0.2));
    const perFileBudget = Math.max(100, Math.floor(instructionBudget / input.instructions.length));
    for (const instruction of input.instructions) {
      headerParts.push(
        `### ${instruction.path}`,
        "",
        truncateToTokens(instruction.content.trim(), perFileBudget),
        "",
      );
    }
  }

  if (input.changedFiles.length) {
    headerParts.push(
      "",
      "## Git changes",
      "",
      ...input.changedFiles.map((path) => `- ${path}`),
    );
  }

  const rankedSummary = input.ranked.map(
    ({ file, score, reasons }, index) =>
      `${index + 1}. \`${file.path}\` — score ${score}; ${reasons.join("; ")}`,
  );
  headerParts.push("", "## Relevant files", "", ...rankedSummary);

  const sections = [headerParts.join("\n")];
  let consumed = estimateTokens(sections[0] ?? "");
  const reserveForReport = 250;
  const included: RankedFile[] = [];
  let summaryTokens = 0;

  if (input.diff) {
    const available = input.budget - consumed - reserveForReport;
    if (available > 300) {
      const diff = truncateToTokens(input.diff, Math.min(available, Math.floor(input.budget * 0.25)));
      const section = `## Current diff\n\n\`\`\`diff\n${diff}\n\`\`\``;
      sections.push(section);
      consumed += estimateTokens(section, "code");
    }
  }

  sections.push("## Focused context");
  consumed += estimateTokens("## Focused context");

  for (const rankedFile of input.ranked) {
    const summary = [
      `### ${rankedFile.file.path}`,
      "",
      `Language: ${rankedFile.file.language} · Lines: ${rankedFile.file.lines} · Relevance: ${rankedFile.score}`,
      "",
      rankedFile.file.summary,
    ].join("\n");
    const excerpt = rankedFile.excerpt
      ? `\n\n\`\`\`${fenceFor(rankedFile.file.path)}\n${rankedFile.excerpt}\n\`\`\``
      : "";
    let section = `${summary}${excerpt}`;
    const available = input.budget - consumed - reserveForReport;
    if (available < estimateTokens(summary) + 20) break;
    if (estimateTokens(section, "code") > available) section = summary;
    sections.push(section);
    const sectionTokens = estimateTokens(section, "code");
    consumed += sectionTokens;
    summaryTokens += estimateTokens(summary);
    included.push(rankedFile);
  }

  const omitted = input.ranked.length - included.length;
  if (omitted > 0) {
    const note = `> ${omitted} lower-priority file${omitted === 1 ? " was" : "s were"} omitted to stay within budget.`;
    sections.push(note);
    consumed += estimateTokens(note);
  }

  const estimatedWithoutContextPilotTokens =
    input.repositoryEstimatedTokens + estimateTokens(input.task);
  const provisionalUsage: UsageEstimate = {
    estimatedWithoutContextPilotTokens,
    estimatedWithContextPilotTokens: consumed,
    estimatedTokensSaved: Math.max(0, estimatedWithoutContextPilotTokens - consumed),
    rawSelectedTokens,
    afterSymbolExtractionTokens,
    afterSummaryCompressionTokens: summaryTokens,
    instructionTokens,
    estimatedTotalInputTokens: consumed,
    estimatedContextReductionPercent:
      estimatedWithoutContextPilotTokens > 0
        ? Math.max(0, (1 - consumed / estimatedWithoutContextPilotTokens) * 100)
        : 0,
    budget: input.budget,
  };
  sections.push(usageReport(provisionalUsage));
  const markdown = `${sections.join("\n\n").trim()}\n`;
  const estimatedTotalInputTokens = estimateTokens(markdown, "code");
  const usage = {
    ...provisionalUsage,
    estimatedWithContextPilotTokens: estimatedTotalInputTokens,
    estimatedTokensSaved: Math.max(
      0,
      estimatedWithoutContextPilotTokens - estimatedTotalInputTokens,
    ),
    estimatedTotalInputTokens,
    estimatedContextReductionPercent:
      estimatedWithoutContextPilotTokens > 0
        ? Math.max(0, (1 - estimatedTotalInputTokens / estimatedWithoutContextPilotTokens) * 100)
        : 0,
  };
  sections[sections.length - 1] = usageReport(usage);

  return { markdown: `${sections.join("\n\n").trim()}\n`, included, usage };
}
