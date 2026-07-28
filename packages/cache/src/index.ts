import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { CacheStats, FileRecord, TaskRunRecord } from "../../core/src/types.js";

export class SummaryCache implements Disposable {
  readonly databasePath: string;
  readonly #database: DatabaseSync;

  constructor(root: string) {
    this.databasePath = join(root, ".context-pilot", "cache.db");
    mkdirSync(dirname(this.databasePath), { recursive: true });
    this.#database = new DatabaseSync(this.databasePath);
    this.#database.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS file_summaries (
        path TEXT PRIMARY KEY,
        hash TEXT NOT NULL,
        record TEXT NOT NULL,
        size INTEGER NOT NULL,
        indexed_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_file_summaries_hash
      ON file_summaries(hash);
      CREATE TABLE IF NOT EXISTS task_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task TEXT NOT NULL,
        created_at TEXT NOT NULL,
        output_path TEXT NOT NULL,
        without_tokens INTEGER NOT NULL,
        with_tokens INTEGER NOT NULL,
        saved_tokens INTEGER NOT NULL,
        reduction_percent REAL NOT NULL,
        budget INTEGER NOT NULL,
        selected_files TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_task_runs_created_at
      ON task_runs(created_at DESC);
    `);
  }

  get(path: string, hash: string): FileRecord | undefined {
    const row = this.#database
      .prepare("SELECT record FROM file_summaries WHERE path = ? AND hash = ?")
      .get(path, hash) as { record: string } | undefined;
    return row ? (JSON.parse(row.record) as FileRecord) : undefined;
  }

  put(record: FileRecord): void {
    this.#database
      .prepare(`
        INSERT INTO file_summaries(path, hash, record, size, indexed_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(path) DO UPDATE SET
          hash = excluded.hash,
          record = excluded.record,
          size = excluded.size,
          indexed_at = excluded.indexed_at
      `)
      .run(record.path, record.hash, JSON.stringify(record), record.size, record.indexedAt);
  }

  removeMissing(paths: Set<string>): number {
    const existing = this.#database
      .prepare("SELECT path FROM file_summaries")
      .all() as Array<{ path: string }>;
    const remove = this.#database.prepare("DELETE FROM file_summaries WHERE path = ?");
    let count = 0;
    this.#database.exec("BEGIN");
    try {
      for (const row of existing) {
        if (!paths.has(row.path)) {
          remove.run(row.path);
          count += 1;
        }
      }
      this.#database.exec("COMMIT");
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
    return count;
  }

  all(): FileRecord[] {
    return (
      this.#database.prepare("SELECT record FROM file_summaries ORDER BY path").all() as Array<{
        record: string;
      }>
    ).map((row) => JSON.parse(row.record) as FileRecord);
  }

  stats(): CacheStats {
    const row = this.#database
      .prepare("SELECT COUNT(*) AS entries, COALESCE(SUM(size), 0) AS totalBytes FROM file_summaries")
      .get() as { entries: number; totalBytes: number };
    return { ...row, databasePath: this.databasePath };
  }

  recordTaskRun(run: TaskRunRecord): void {
    this.#database
      .prepare(`
        INSERT INTO task_runs(
          task, created_at, output_path, without_tokens, with_tokens,
          saved_tokens, reduction_percent, budget, selected_files
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        run.task,
        run.createdAt,
        run.outputPath,
        run.estimatedWithoutContextPilotTokens,
        run.estimatedWithContextPilotTokens,
        run.estimatedTokensSaved,
        run.estimatedContextReductionPercent,
        run.budget,
        JSON.stringify(run.selectedFiles),
      );
  }

  taskRuns(limit = 20): TaskRunRecord[] {
    const rows = this.#database
      .prepare(`
        SELECT id, task, created_at, output_path, without_tokens, with_tokens,
               saved_tokens, reduction_percent, budget, selected_files
        FROM task_runs
        ORDER BY id DESC
        LIMIT ?
      `)
      .all(Math.max(1, Math.min(limit, 1_000))) as Array<{
      id: number;
      task: string;
      created_at: string;
      output_path: string;
      without_tokens: number;
      with_tokens: number;
      saved_tokens: number;
      reduction_percent: number;
      budget: number;
      selected_files: string;
    }>;
    return rows.map((row) => ({
      id: row.id,
      task: row.task,
      createdAt: row.created_at,
      outputPath: row.output_path,
      estimatedWithoutContextPilotTokens: row.without_tokens,
      estimatedWithContextPilotTokens: row.with_tokens,
      estimatedTokensSaved: row.saved_tokens,
      estimatedContextReductionPercent: row.reduction_percent,
      budget: row.budget,
      selectedFiles: JSON.parse(row.selected_files) as string[],
    }));
  }

  close(): void {
    this.#database.close();
  }

  [Symbol.dispose](): void {
    this.close();
  }
}
