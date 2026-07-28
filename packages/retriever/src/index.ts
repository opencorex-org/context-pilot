import { readFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import type { FileRecord, RankedFile } from "../../core/src/types.js";

const STOP_WORDS = new Set([
  "a",
  "add",
  "an",
  "and",
  "at",
  "be",
  "by",
  "change",
  "create",
  "do",
  "fix",
  "for",
  "from",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "please",
  "the",
  "this",
  "to",
  "under",
  "update",
  "with",
]);

function stem(term: string): string {
  return term.replace(/(?:ing|ments?|ions?|ers?|ed|es|s)$/i, "");
}

export function taskTerms(task: string): string[] {
  return [
    ...new Set(
      task
        .toLowerCase()
        .split(/[^a-z0-9_$.-]+/)
        .map((term) => term.replace(/^[._-]+|[._-]+$/g, ""))
        .filter((term) => term.length >= 3 && !STOP_WORDS.has(term))
        .flatMap((term) => [term, stem(term)])
        .filter((term) => term.length >= 3),
    ),
  ];
}

function pathMatchesImport(file: FileRecord, candidate: FileRecord): boolean {
  const withoutExtension = candidate.path.slice(0, -extname(candidate.path).length);
  const candidateName = basename(withoutExtension);
  return file.imports.some(
    (dependency) =>
      dependency.endsWith(candidateName) ||
      withoutExtension.endsWith(dependency.replace(/^\.\//, "")),
  );
}

function relatedTest(path: string, terms: string[]): boolean {
  if (!/(?:^|\/)(?:tests?|__tests__)(?:\/|$)|\.(?:test|spec)\./i.test(path)) return false;
  const lower = path.toLowerCase();
  return terms.some((term) => lower.includes(term));
}

function buildExcerpt(content: string, file: FileRecord, terms: string[]): string | undefined {
  const lines = content.split(/\r?\n/);
  const matchingSymbols = file.symbols.filter((symbol) => {
    const searchable = `${symbol.name} ${symbol.signature}`.toLowerCase();
    return terms.some((term) => searchable.includes(term));
  });
  if (matchingSymbols.length) {
    return matchingSymbols
      .slice(0, 3)
      .map((symbol) => {
        const start = Math.max(0, symbol.startLine - 3);
        const end = Math.min(lines.length, symbol.endLine + 2);
        const numbered = lines
          .slice(start, end)
          .map((line, offset) => `${start + offset + 1}: ${line}`)
          .join("\n");
        return `// ${symbol.kind} ${symbol.name}, lines ${symbol.startLine}-${symbol.endLine}\n${numbered}`;
      })
      .join("\n\n");
  }

  const matchLine = lines.findIndex((line) =>
    terms.some((term) => line.toLowerCase().includes(term)),
  );
  if (matchLine >= 0) {
    const start = Math.max(0, matchLine - 12);
    const end = Math.min(lines.length, matchLine + 28);
    return lines
      .slice(start, end)
      .map((line, offset) => `${start + offset + 1}: ${line}`)
      .join("\n");
  }
  if (lines.length <= 120) return content;
  return undefined;
}

export async function retrieveFiles(
  root: string,
  task: string,
  files: FileRecord[],
  changedFiles: string[],
  maxFiles = 24,
): Promise<RankedFile[]> {
  const terms = taskTerms(task);
  const changed = new Set(changedFiles);
  const changedRecords = files.filter((file) => changed.has(file.path));
  const ranked: RankedFile[] = [];

  for (const file of files) {
    let score = 0;
    const reasons: string[] = [];
    const matchedTerms = new Set<string>();
    const lowerPath = file.path.toLowerCase();
    const lowerSummary = file.summary.toLowerCase();
    const symbolNames = file.symbols.map((symbol) => symbol.name.toLowerCase());

    for (const term of terms) {
      if (lowerPath.includes(term)) {
        score += basename(lowerPath).includes(term) ? 14 : 9;
        matchedTerms.add(term);
      }
      if (symbolNames.some((name) => name.includes(term))) {
        score += 12;
        matchedTerms.add(term);
      }
      if (lowerSummary.includes(term)) {
        score += 3;
        matchedTerms.add(term);
      }
    }

    if (changed.has(file.path)) {
      score += 30;
      reasons.push("changed in Git");
    }
    if (relatedTest(file.path, terms)) {
      score += 8;
      reasons.push("related test");
    }
    if (changedRecords.some((changedFile) => pathMatchesImport(changedFile, file))) {
      score += 10;
      reasons.push("dependency of a changed file");
    }
    if (changedRecords.some((changedFile) => pathMatchesImport(file, changedFile))) {
      score += 7;
      reasons.push("depends on a changed file");
    }
    if (matchedTerms.size) reasons.push(`matched: ${[...matchedTerms].join(", ")}`);
    if (score > 0) {
      ranked.push({ file, score, reasons, matchedTerms: [...matchedTerms] });
    }
  }

  ranked.sort((left, right) => right.score - left.score || left.file.path.localeCompare(right.file.path));
  const selected = ranked.slice(0, maxFiles);
  await Promise.all(
    selected.map(async (rankedFile) => {
      try {
        const content = await readFile(join(root, rankedFile.file.path), "utf8");
        const excerpt = buildExcerpt(content, rankedFile.file, terms);
        if (excerpt !== undefined) rankedFile.excerpt = excerpt;
      } catch {
        // A file can disappear between indexing and retrieval; its summary is still useful.
      }
    }),
  );
  return selected;
}

export function findRelatedFiles(files: FileRecord[], selected: RankedFile[]): FileRecord[] {
  const selectedPaths = new Set(selected.map(({ file }) => file.path));
  return files.filter(
    (candidate) =>
      !selectedPaths.has(candidate.path) &&
      selected.some(({ file }) => pathMatchesImport(file, candidate) || pathMatchesImport(candidate, file)),
  );
}
