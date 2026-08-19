import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ATOMIC_PUBLIC_CATALOG_SQL_FILE,
  D1_MAX_SQL_STATEMENT_BYTES,
  validateAtomicCatalogStatements,
  writeAtomicCatalogImport
} from '../scripts/public-catalog-import-core.mjs';

const temporaryDirectories = [];

async function temporaryDirectory() {
  const directory = await mkdtemp(join(tmpdir(), 'catalog-engine-atomic-publication-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('atomic public catalog D1 import', () => {
  it('writes exactly one SQL file so Wrangler imports the catalog as one recoverable unit', async () => {
    const sqlDir = await temporaryDirectory();
    const statements = [
      'DELETE FROM catalog_products;',
      "INSERT INTO catalog_products (product_id, name, search_text, category_id, category_name) VALUES ('p_aaaaaaaaaaaaaaaaaaaa', 'Produto', 'produto', 'c_aaaaaaaaaaaaaaaaaaaa', 'Categoria');"
    ];

    const result = await writeAtomicCatalogImport(statements, { sqlDir });
    const files = await readdir(sqlDir);
    const content = await readFile(result.path, 'utf8');

    expect(files).toEqual([ATOMIC_PUBLIC_CATALOG_SQL_FILE]);
    expect(result.statementCount).toBe(statements.length);
    expect(result.bytes).toBeGreaterThan(0);
    expect(content.startsWith('PRAGMA foreign_keys = ON;\n')).toBe(true);
    expect(content).toContain(statements[0]);
    expect(content).toContain(statements[1]);
    expect(content).not.toMatch(/^BEGIN\b/im);
    expect(content).not.toMatch(/^COMMIT\b/im);
  });

  it('rejects explicit transaction control because D1 import owns the transaction boundary', () => {
    expect(() => validateAtomicCatalogStatements(['BEGIN TRANSACTION;', 'DELETE FROM catalog_products;']))
      .toThrow('atomic_catalog_import_transaction_control_rejected:0');
    expect(() => validateAtomicCatalogStatements(['DELETE FROM catalog_products;', 'COMMIT;']))
      .toThrow('atomic_catalog_import_transaction_control_rejected:1');
  });

  it('rejects a statement beyond the current D1 statement-size limit', () => {
    const oversized = `SELECT '${'x'.repeat(D1_MAX_SQL_STATEMENT_BYTES)}';`;
    expect(() => validateAtomicCatalogStatements([oversized]))
      .toThrow('atomic_catalog_import_statement_too_large:0');
  });
});
