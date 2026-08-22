import { writeFile } from 'node:fs/promises';
import {
  TENANT_DATA_PLANE_CURRENT_STATEMENTS,
  TENANT_DATA_PLANE_SCHEMA_VERSION
} from '../worker/tenant-data-plane-schema-v5.js';

const output = process.env.TENANT_DATA_PLANE_SQL_OUT || '/tmp/catalog-engine-tenant-data-plane.sql';
const tenantId = process.env.TENANT_ID || 't_0123456789abcdefabcd';
const sourceUrl = process.env.SOURCE_URL || 'https://supplier-test.x.yupoo.com/albums/';

if (!/^t_[a-f0-9]{20}$/.test(tenantId)) throw new Error('TENANT_ID invalid.');
const parsedSource = new URL(sourceUrl);
if (parsedSource.protocol !== 'https:' || !parsedSource.hostname.endsWith('.x.yupoo.com')) {
  throw new Error('SOURCE_URL invalid.');
}

function literal(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return String(value);
  return `'${String(value).replaceAll("'", "''")}'`;
}

const ledgerStatements = Array.from(
  { length: TENANT_DATA_PLANE_SCHEMA_VERSION },
  (_entry, index) => `INSERT OR IGNORE INTO data_plane_schema_migrations (version) VALUES (${index + 1});`
);
const sql = [
  'PRAGMA foreign_keys = ON;',
  ...TENANT_DATA_PLANE_CURRENT_STATEMENTS.map((statement) => `${statement};`),
  `INSERT INTO data_plane_identity (tenant_id, schema_version) VALUES (${literal(tenantId)}, ${TENANT_DATA_PLANE_SCHEMA_VERSION}) ON CONFLICT(tenant_id) DO UPDATE SET schema_version=excluded.schema_version, updated_at=CURRENT_TIMESTAMP;`,
  `INSERT INTO supplier_sources (tenant_id, source_key, provider, source_url, status, sync_strategy, removal_miss_threshold) VALUES (${literal(tenantId)}, 'primary', 'yupoo', ${literal(sourceUrl)}, 'active', 'incremental', 3) ON CONFLICT(tenant_id, source_key) DO UPDATE SET source_url=excluded.source_url, status='active', updated_at=CURRENT_TIMESTAMP;`,
  ...ledgerStatements
].join('\n');

await writeFile(output, `${sql}\n`, 'utf8');
console.log(JSON.stringify({ output, schemaVersion: TENANT_DATA_PLANE_SCHEMA_VERSION, tenantId }));
