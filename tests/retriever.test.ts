import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { indexRepository } from "../packages/indexer/src/index.js";
import { retrieveFiles, taskTerms } from "../packages/retriever/src/index.js";

test("normalizes useful task terms", () => {
  const terms = taskTerms("Fix duplicate invoice numbers under concurrent requests");
  assert.ok(terms.includes("duplicate"));
  assert.ok(terms.includes("invoice"));
  assert.ok(terms.includes("concurrent"));
  assert.ok(!terms.includes("fix"));
});

test("ranks matching symbols and related tests", async () => {
  const root = await mkdtemp(join(tmpdir(), "context-pilot-retrieve-"));
  await mkdir(join(root, "src"), { recursive: true });
  await mkdir(join(root, "tests"), { recursive: true });
  await writeFile(
    join(root, "src", "invoice-service.ts"),
    "export function generateInvoiceNumber() { return 'INV-1'; }\n",
  );
  await writeFile(
    join(root, "src", "user-service.ts"),
    "export function updateUser() { return true; }\n",
  );
  await writeFile(
    join(root, "tests", "invoice-concurrency.test.ts"),
    "test('invoice number concurrency', () => {});\n",
  );
  const index = await indexRepository(root);
  const ranked = await retrieveFiles(
    root,
    "Fix concurrent invoice number generation",
    index.files,
    [],
  );
  assert.equal(ranked[0]?.file.path, "src/invoice-service.ts");
  assert.ok(ranked.some(({ file }) => file.path === "tests/invoice-concurrency.test.ts"));
  assert.match(ranked[0]?.excerpt ?? "", /generateInvoiceNumber/);
});
