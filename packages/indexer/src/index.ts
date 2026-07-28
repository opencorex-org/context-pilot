import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { extname, join, relative, sep } from "node:path";
import { SummaryCache } from "../../cache/src/index.js";
import type { FileRecord, IndexResult, SymbolRecord } from "../../core/src/types.js";

const SUMMARY_VERSION = "deterministic-v1";
const MAX_FILE_BYTES = 1_000_000;
const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".context-pilot",
  ".next",
  ".turbo",
  ".venv",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "target",
  "vendor",
]);

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ".c": "C",
  ".cc": "C++",
  ".cpp": "C++",
  ".cs": "C#",
  ".css": "CSS",
  ".go": "Go",
  ".h": "C/C++ Header",
  ".hpp": "C++ Header",
  ".html": "HTML",
  ".java": "Java",
  ".js": "JavaScript",
  ".jsx": "JavaScript React",
  ".json": "JSON",
  ".kt": "Kotlin",
  ".kts": "Kotlin",
  ".md": "Markdown",
  ".php": "PHP",
  ".py": "Python",
  ".rb": "Ruby",
  ".rs": "Rust",
  ".scss": "SCSS",
  ".sh": "Shell",
  ".sql": "SQL",
  ".swift": "Swift",
  ".toml": "TOML",
  ".ts": "TypeScript",
  ".tsx": "TypeScript React",
  ".vue": "Vue",
  ".xml": "XML",
  ".yaml": "YAML",
  ".yml": "YAML",
};

const SPECIAL_FILES = new Set([
  "Dockerfile",
  "Makefile",
  "Procfile",
  "AGENTS.md",
  "README",
  "LICENSE",
]);

interface SymbolPattern {
  kind: string;
  pattern: RegExp;
}

const SYMBOL_PATTERNS: SymbolPattern[] = [
  { kind: "class", pattern: /^\s*(?:export\s+)?(?:default\s+)?class\s+([A-Za-z_$][\w$]*)/ },
  { kind: "interface", pattern: /^\s*(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/ },
  { kind: "type", pattern: /^\s*(?:export\s+)?type\s+([A-Za-z_$][\w$]*)/ },
  { kind: "enum", pattern: /^\s*(?:export\s+)?enum\s+([A-Za-z_$][\w$]*)/ },
  {
    kind: "function",
    pattern: /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/,
  },
  {
    kind: "function",
    pattern:
      /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s*)?\(/,
  },
  { kind: "class", pattern: /^\s*class\s+([A-Za-z_]\w*)\s*(?:\([^)]*\))?\s*:/ },
  { kind: "function", pattern: /^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/ },
  { kind: "type", pattern: /^\s*type\s+([A-Za-z_]\w*)\s+(?:struct|interface)\b/ },
  { kind: "function", pattern: /^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)\s*\(/ },
  { kind: "function", pattern: /^\s*(?:pub\s+)?(?:async\s+)?fn\s+([A-Za-z_]\w*)\s*[<(]/ },
  {
    kind: "class",
    pattern:
      /^\s*(?:public\s+|private\s+|protected\s+|abstract\s+|final\s+)*(?:class|interface|record|enum)\s+([A-Za-z_]\w*)/,
  },
];

function normalizePath(value: string): string {
  return value.split(sep).join("/");
}

function isIndexable(name: string): boolean {
  return Boolean(LANGUAGE_BY_EXTENSION[extname(name).toLowerCase()]) || SPECIAL_FILES.has(name);
}

function languageFor(name: string): string {
  return LANGUAGE_BY_EXTENSION[extname(name).toLowerCase()] ?? "Text";
}

function looksBinary(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, Math.min(buffer.length, 8_000));
  return sample.includes(0);
}

async function collectFiles(root: string, directory = root): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const output: string[] = [];
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!IGNORED_DIRECTORIES.has(entry.name)) output.push(...(await collectFiles(root, absolute)));
      continue;
    }
    if (entry.isFile() && isIndexable(entry.name)) output.push(absolute);
  }
  return output;
}

function findBlockEnd(lines: string[], start: number): number {
  const first = lines[start] ?? "";
  if (first.trimEnd().endsWith(":")) {
    const indentation = first.match(/^\s*/)?.[0].length ?? 0;
    for (let index = start + 1; index < lines.length; index += 1) {
      const line = lines[index] ?? "";
      if (!line.trim()) continue;
      const nextIndentation = line.match(/^\s*/)?.[0].length ?? 0;
      if (nextIndentation <= indentation) return index;
    }
    return lines.length;
  }

  let depth = 0;
  let opened = false;
  for (let index = start; index < Math.min(lines.length, start + 300); index += 1) {
    const line = (lines[index] ?? "").replace(/(["'`]).*?\1/g, "");
    for (const character of line) {
      if (character === "{") {
        depth += 1;
        opened = true;
      } else if (character === "}") {
        depth -= 1;
        if (opened && depth <= 0) return index + 1;
      }
    }
  }
  return Math.min(lines.length, start + 80);
}

export function extractSymbols(content: string): SymbolRecord[] {
  const lines = content.split(/\r?\n/);
  const symbols: SymbolRecord[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    for (const { kind, pattern } of SYMBOL_PATTERNS) {
      const match = pattern.exec(line);
      const name = match?.[1];
      if (!name) continue;
      const key = `${kind}:${name}:${index}`;
      if (!seen.has(key)) {
        symbols.push({
          name,
          kind,
          startLine: index + 1,
          endLine: findBlockEnd(lines, index),
          signature: line.trim().slice(0, 240),
        });
        seen.add(key);
      }
      break;
    }
  }
  return symbols;
}

export function extractImports(content: string): string[] {
  const imports = new Set<string>();
  const patterns = [
    /\bfrom\s+["']([^"']+)["']/g,
    /\brequire\(\s*["']([^"']+)["']\s*\)/g,
    /^\s*import\s+([A-Za-z_][\w.]*)/gm,
    /^\s*from\s+([A-Za-z_][\w.]*)\s+import/gm,
    /^\s*use\s+([A-Za-z_][\w:]*)/gm,
  ];
  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern)) {
      if (match[1]) imports.add(match[1]);
    }
  }
  return [...imports].slice(0, 100);
}

function purposeFromContent(path: string, content: string): string {
  const lines = content.split(/\r?\n/);
  const prose = lines
    .slice(0, 60)
    .map((line) =>
      line
        .trim()
        .replace(/^\/[/*]\s?/, "")
        .replace(/^\*\s?/, "")
        .replace(/^#\s?/, "")
        .replace(/-->$/, "")
        .trim(),
    )
    .find((line) => line.length >= 12 && !/^(import|export|from|use|package)\b/.test(line));
  return prose?.slice(0, 220) ?? `Source file ${path}.`;
}

function summarize(path: string, content: string, symbols: SymbolRecord[], imports: string[]): string {
  const purpose = purposeFromContent(path, content);
  const symbolText = symbols.length
    ? symbols
        .slice(0, 12)
        .map((symbol) => `${symbol.kind} ${symbol.name}`)
        .join(", ")
    : "none detected";
  const importText = imports.length ? imports.slice(0, 8).join(", ") : "none detected";
  return `Purpose: ${purpose}\nSymbols: ${symbolText}\nDepends on: ${importText}`;
}

export async function indexRepository(root: string): Promise<IndexResult> {
  const started = performance.now();
  const absoluteFiles = await collectFiles(root);
  const files: FileRecord[] = [];
  const cache = new SummaryCache(root);
  let reused = 0;
  let updated = 0;
  let skipped = 0;

  try {
    for (const absolute of absoluteFiles) {
      const metadata = await stat(absolute);
      if (metadata.size > MAX_FILE_BYTES) {
        skipped += 1;
        continue;
      }
      const buffer = await readFile(absolute);
      if (looksBinary(buffer)) {
        skipped += 1;
        continue;
      }
      const path = normalizePath(relative(root, absolute));
      const content = buffer.toString("utf8");
      const hash = createHash("sha256")
        .update(content)
        .update(SUMMARY_VERSION)
        .update(languageFor(path))
        .digest("hex");
      const cached = cache.get(path, hash);
      if (cached) {
        files.push(cached);
        reused += 1;
        continue;
      }
      const symbols = extractSymbols(content);
      const imports = extractImports(content);
      const record: FileRecord = {
        path,
        language: languageFor(path),
        hash,
        size: metadata.size,
        lines: content.split(/\r?\n/).length,
        summary: summarize(path, content, symbols, imports),
        symbols,
        imports,
        indexedAt: new Date().toISOString(),
      };
      cache.put(record);
      files.push(record);
      updated += 1;
    }
    cache.removeMissing(new Set(files.map((file) => file.path)));
  } finally {
    cache.close();
  }

  return {
    files,
    scanned: absoluteFiles.length,
    reused,
    updated,
    skipped,
    durationMs: Math.round(performance.now() - started),
  };
}
