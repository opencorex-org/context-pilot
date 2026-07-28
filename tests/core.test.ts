import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { prepareContext, taskHistory } from "../packages/core/src/index.js";
import { estimateTokens } from "../packages/token-estimator/src/index.js";

test("prepares a bounded task bundle with instructions", async () => {
  const root = await mkdtemp(join(tmpdir(), "context-pilot-core-"));
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "AGENTS.md"), "# Rules\n\n- Preserve the public API.\n");
  await writeFile(
    join(root, "src", "refund-service.ts"),
    `export class RefundService {
  approveRefund(id: string) {
    return { id, approved: true };
  }
}
`,
  );
  await writeFile(
    join(root, "src", "unrelated.ts"),
    `export const values = [${Array.from({ length: 2_000 }, (_, index) => index).join(",")}];`,
  );
  const result = await prepareContext({
    root,
    task: "Add refund approval validation",
    budget: 2_000,
  });
  const persisted = await readFile(result.outputPath, "utf8");
  assert.match(persisted, /RefundService/);
  assert.match(persisted, /Preserve the public API/);
  assert.match(persisted, /Estimates only/);
  assert.ok(estimateTokens(persisted, "code") <= 2_200);
  assert.equal(result.selected[0]?.file.path, "src/refund-service.ts");
  assert.ok(
    result.usage.estimatedWithoutContextPilotTokens >=
      result.usage.estimatedWithContextPilotTokens,
  );
  assert.equal(
    result.usage.estimatedTokensSaved,
    result.usage.estimatedWithoutContextPilotTokens -
      result.usage.estimatedWithContextPilotTokens,
  );
  assert.match(persisted, /Without ContextPilot/);
  assert.match(persisted, /With ContextPilot/);
  const history = await taskHistory(root);
  assert.equal(history.length, 1);
  assert.equal(history[0]?.task, "Add refund approval validation");
});
