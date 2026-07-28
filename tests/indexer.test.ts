import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { indexRepository, extractImports, extractSymbols } from "../packages/indexer/src/index.js";

test("extracts symbols and imports from TypeScript", () => {
  const source = `
import { Database } from "./database";
export class InvoiceService {
  createInvoice() {
    return true;
  }
}
export async function approveRefund(id: string) {
  return id;
}
`;
  const symbols = extractSymbols(source);
  assert.deepEqual(
    symbols.map(({ kind, name }) => ({ kind, name })),
    [
      { kind: "class", name: "InvoiceService" },
      { kind: "function", name: "approveRefund" },
    ],
  );
  assert.deepEqual(extractImports(source), ["./database"]);
});

test("reuses unchanged cache entries", async () => {
  const root = await mkdtemp(join(tmpdir(), "context-pilot-index-"));
  await mkdir(join(root, "src"));
  await writeFile(
    join(root, "src", "invoice-service.ts"),
    "export function createInvoice() { return 'INV-1'; }\n",
  );
  const first = await indexRepository(root);
  const second = await indexRepository(root);
  assert.equal(first.updated, 1);
  assert.equal(first.reused, 0);
  assert.equal(second.updated, 0);
  assert.equal(second.reused, 1);
  assert.equal(second.files[0]?.symbols[0]?.name, "createInvoice");
});
