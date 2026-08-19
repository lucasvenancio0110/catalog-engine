import { mkdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export const D1_MAX_SQL_STATEMENT_BYTES = 100_000;
export const ATOMIC_PUBLIC_CATALOG_SQL_FILE = 'catalog-publication.sql';

function statementBytes(statement) {
  return Buffer.byteLength(String(statement), 'utf8');
}

function isTransactionControlStatement(statement) {
  const normalized = String(statement).trim().replace(/;$/, '').trim();
  return /^(?:BEGIN|COMMIT|ROLLBACK|END)(?:\s|$)/i.test(normalized);
}

export function validateAtomicCatalogStatements(statements) {
  if (!Array.isArray(statements) || statements.length === 0) {
    throw new Error('atomic_catalog_import_requires_statements');
  }

  for (const [index, statement] of statements.entries()) {
    const value = String(statement).trim();
    if (!value) throw new Error(`atomic_catalog_import_empty_statement:${index}`);
    if (isTransactionControlStatement(value)) {
      throw new Error(`atomic_catalog_import_transaction_control_rejected:${index}`);
    }
    const bytes = statementBytes(value);
    if (bytes > D1_MAX_SQL_STATEMENT_BYTES) {
      throw new Error(`atomic_catalog_import_statement_too_large:${index}:${bytes}`);
    }
  }
}

export async function writeAtomicCatalogImport(
  statements,
  { sqlDir, filename = ATOMIC_PUBLIC_CATALOG_SQL_FILE } = {}
) {
  if (!sqlDir) throw new Error('atomic_catalog_import_sql_dir_required');
  validateAtomicCatalogStatements(statements);

  await rm(sqlDir, { recursive: true, force: true });
  await mkdir(sqlDir, { recursive: true });

  const path = resolve(sqlDir, filename);
  const content = `PRAGMA foreign_keys = ON;\n${statements.join('\n')}\n`;
  await writeFile(path, content, 'utf8');

  return {
    path,
    filename,
    statementCount: statements.length,
    bytes: Buffer.byteLength(content, 'utf8')
  };
}
