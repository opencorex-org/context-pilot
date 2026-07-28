const CODE_TOKEN_RATIO = 3.5;
const TEXT_TOKEN_RATIO = 4;

export function estimateTokens(value: string, kind: "code" | "text" = "text"): number {
  if (!value) return 0;
  const ratio = kind === "code" ? CODE_TOKEN_RATIO : TEXT_TOKEN_RATIO;
  const characters = value.length;
  const structuralTokens = (value.match(/[{}()[\].,;:+\-*/=<>!?|&]/g) ?? []).length * 0.12;
  return Math.max(1, Math.ceil(characters / ratio + structuralTokens));
}

export function truncateToTokens(value: string, budget: number): string {
  if (estimateTokens(value) <= budget) return value;
  const maxCharacters = Math.max(0, Math.floor(budget * TEXT_TOKEN_RATIO));
  return `${value.slice(0, maxCharacters).trimEnd()}\n…`;
}

export function estimateRepositoryTokens(files: Array<{ size: number }>): number {
  return files.reduce(
    (total, file) => total + Math.max(1, Math.ceil(file.size / CODE_TOKEN_RATIO)),
    0,
  );
}
