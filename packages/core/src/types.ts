export interface SymbolRecord {
  name: string;
  kind: string;
  startLine: number;
  endLine: number;
  signature: string;
}

export interface FileRecord {
  path: string;
  language: string;
  hash: string;
  size: number;
  lines: number;
  summary: string;
  symbols: SymbolRecord[];
  imports: string[];
  indexedAt: string;
}

export interface RankedFile {
  file: FileRecord;
  score: number;
  reasons: string[];
  matchedTerms: string[];
  excerpt?: string;
}

export interface IndexResult {
  files: FileRecord[];
  scanned: number;
  reused: number;
  updated: number;
  skipped: number;
  durationMs: number;
}

export interface UsageEstimate {
  estimatedWithoutContextPilotTokens: number;
  estimatedWithContextPilotTokens: number;
  estimatedTokensSaved: number;
  rawSelectedTokens: number;
  afterSymbolExtractionTokens: number;
  afterSummaryCompressionTokens: number;
  instructionTokens: number;
  estimatedTotalInputTokens: number;
  estimatedContextReductionPercent: number;
  budget: number;
}

export interface TaskRunRecord {
  id?: number;
  task: string;
  createdAt: string;
  outputPath: string;
  estimatedWithoutContextPilotTokens: number;
  estimatedWithContextPilotTokens: number;
  estimatedTokensSaved: number;
  estimatedContextReductionPercent: number;
  budget: number;
  selectedFiles: string[];
}

export interface PrepareOptions {
  root: string;
  task: string;
  budget: number;
  output?: string;
  diffRange?: string;
  maxFiles?: number;
}

export interface PrepareResult {
  outputPath: string;
  markdown: string;
  selected: RankedFile[];
  changedFiles: string[];
  usage: UsageEstimate;
  index: IndexResult;
}

export interface CacheStats {
  entries: number;
  totalBytes: number;
  databasePath: string;
}
