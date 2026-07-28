import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function git(root: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", ["-C", root, ...args], {
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
    });
    return stdout.trim();
  } catch {
    return "";
  }
}

export async function getChangedFiles(root: string, range?: string): Promise<string[]> {
  const values = new Set<string>();
  if (range) {
    const output = await git(root, ["diff", "--name-only", "--diff-filter=ACMR", range]);
    for (const path of output.split("\n")) if (path) values.add(path);
  } else {
    const tracked = await git(root, ["diff", "--name-only", "--diff-filter=ACMR", "HEAD"]);
    const staged = await git(root, ["diff", "--cached", "--name-only", "--diff-filter=ACMR"]);
    const untracked = await git(root, ["ls-files", "--others", "--exclude-standard"]);
    for (const output of [tracked, staged, untracked]) {
      for (const path of output.split("\n")) if (path) values.add(path);
    }
  }
  return [...values].sort();
}

export async function getDiff(root: string, range?: string): Promise<string> {
  const args = range ? ["diff", "--no-ext-diff", "--unified=2", range] : ["diff", "--no-ext-diff", "HEAD"];
  return git(root, args);
}

export async function getHeadCommit(root: string): Promise<string | undefined> {
  return (await git(root, ["rev-parse", "--short", "HEAD"])) || undefined;
}
