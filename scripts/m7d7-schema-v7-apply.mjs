import { readFile, writeFile } from 'node:fs/promises';

async function patch(path, replacements) {
  let text = await readFile(path, 'utf8');
  for (const [before, after] of replacements) {
    if (!text.includes(before)) throw new Error(`m7d7_patch_missing:${path}:${before.slice(0,80)}`);
    text = text.replace(before, after);
  }
  await writeFile(path, text, 'utf8');
}

await patch('worker/data-plane-migration-runner.js', [
  ["from './tenant-data-plane-schema-v6.js';", "from './tenant-data-plane-schema-v7.js';"]
]);

await patch('scripts/cloudflare-tenant-data-plane-fleet-prepare.mjs', [
  ["from '../worker/tenant-data-plane-schema-v6.js';", "from '../worker/tenant-data-plane-schema-v7.js';"]
]);

for (const path of [
  'scripts/emit-tenant-data-plane-schema.mjs',
  'scripts/cloudflare-auto-tenant-import-canary.mjs',
  'scripts/cloudflare-incremental-scan-stage-canary.mjs'
]) {
  await patch(path, [["tenant-data-plane-schema-v6.js", "tenant-data-plane-schema-v7.js"]]);
}

await patch('worker/tenant-data-plane-command.js', [
  [
`import {
  TENANT_DATA_PLANE_SCHEMA_VERSION as CURRENT_TENANT_DATA_PLANE_SCHEMA_VERSION,
  TENANT_DATA_PLANE_V6_STATEMENTS
} from './tenant-data-plane-schema-v6.js';`,
`import { TENANT_DATA_PLANE_V6_STATEMENTS } from './tenant-data-plane-schema-v6.js';
import {
  TENANT_DATA_PLANE_SCHEMA_VERSION as CURRENT_TENANT_DATA_PLANE_SCHEMA_VERSION,
  TENANT_DATA_PLANE_V7_STATEMENTS
} from './tenant-data-plane-schema-v7.js';`
  ],
  ['export const TENANT_DATA_PLANE_MIGRATION_COMMAND_VERSION = 2;', 'export const TENANT_DATA_PLANE_MIGRATION_COMMAND_VERSION = 3;'],
  ['  6: TENANT_DATA_PLANE_V6_STATEMENTS\n});', '  6: TENANT_DATA_PLANE_V6_STATEMENTS,\n  7: TENANT_DATA_PLANE_V7_STATEMENTS\n});']
]);

await patch('worker/ingestion/incremental-scan-consumer.js', [
  ['const MIN_INCREMENTAL_STAGE_SCHEMA_VERSION = 5;', 'const MIN_INCREMENTAL_STAGE_SCHEMA_VERSION = 7;'],
  ['const MIN_INCREMENTAL_DETAIL_SCHEMA_VERSION = 6;', 'const MIN_INCREMENTAL_DETAIL_SCHEMA_VERSION = 7;']
]);

await patch('worker/ingestion/incremental-stage.js', [
  [
`function clearStageQuery(table, context) {`,
`function beginStageAuthorityQuery(context) {
  return {
    sql: \`INSERT OR IGNORE INTO supplier_sync_stage_authority
      (run_id, tenant_id, source_key, contract_version, base_authority_revision,
       created_at, updated_at)
      SELECT ?1, ?2, ?3, 1, a.revision, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        FROM supplier_sync_stage_runs s
        JOIN catalog_serving_authority a ON a.tenant_id=?2
       WHERE s.run_id=?1 AND s.tenant_id=?2 AND s.source_key=?3 AND s.state='staging'\`,
    params: [context.importId, context.tenantId, context.sourceKey]
  };
}

function clearStageQuery(table, context) {`
  ],
  [
`      beginStageQuery(context, scan, plan),
      clearStageQuery('supplier_sync_stage_observations', context),`,
`      beginStageQuery(context, scan, plan),
      beginStageAuthorityQuery(context),
      clearStageQuery('supplier_sync_stage_observations', context),`
  ]
]);

console.log(JSON.stringify({ ok: true, boundary: 'm7d7-schema-v7-foundation' }));
