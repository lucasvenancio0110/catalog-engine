import { readFile, writeFile } from 'node:fs/promises';

async function patch(path, replacements) {
  let text = await readFile(path, 'utf8');
  for (const [before, after] of replacements) {
    if (!text.includes(before)) {
      throw new Error(`m7d7_patch_missing:${path}:${before.slice(0, 80)}`);
    }
    text = text.replace(before, after);
  }
  await writeFile(path, text, 'utf8');
}

async function patchAll(path, replacements) {
  let text = await readFile(path, 'utf8');
  for (const [before, after] of replacements) {
    const count = text.split(before).length - 1;
    if (count < 1) {
      throw new Error(`m7d7_patch_all_missing:${path}:${before.slice(0, 80)}`);
    }
    text = text.split(before).join(after);
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
  [
    'export const TENANT_DATA_PLANE_MIGRATION_COMMAND_VERSION = 2;',
    'export const TENANT_DATA_PLANE_MIGRATION_COMMAND_VERSION = 3;'
  ],
  [
    '  6: TENANT_DATA_PLANE_V6_STATEMENTS\n});',
    '  6: TENANT_DATA_PLANE_V6_STATEMENTS,\n  7: TENANT_DATA_PLANE_V7_STATEMENTS\n});'
  ]
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

for (const path of [
  'tests/tenant-incremental-dispatch-routing.test.mjs',
  'tests/tenant-incremental-scan-consumer.test.mjs',
  'tests/tenant-incremental-scan-safety.test.mjs'
]) {
  await patchAll(path, [['schemaVersion: 6,', 'schemaVersion: 7,']]);
}

for (const path of [
  'tests/tenant-incremental-stage.test.mjs',
  'tests/tenant-incremental-stage-ledger.test.mjs'
]) {
  await patch(path, [[
    "from '../worker/tenant-data-plane-schema-v5.js';",
    "from '../worker/tenant-data-plane-schema-v7.js';"
  ]]);
}

await patchAll('tests/tenant-data-plane-command.test.mjs', [
  ['version: 2, tenantId, targetSchemaVersion: 6', 'version: 3, tenantId, targetSchemaVersion: 7'],
  ['version: 2,\n        schemaVersion: 6,', 'version: 3,\n        schemaVersion: 7,'],
  [".toBe('1,2,3,4,5,6');", ".toBe('1,2,3,4,5,6,7');"],
  ['.get().total\n      ).toBe(16);', '.get().total\n      ).toBe(17);'],
  ['toMatchObject({ schemaVersion: 6, applied: false })', 'toMatchObject({ schemaVersion: 7, applied: false })'],
  ['toMatchObject({ schemaVersion: 6, applied: true })', 'toMatchObject({ schemaVersion: 7, applied: true })']
]);

await patchAll('tests/tenant-data-plane-fleet-preparation.test.mjs', [
  ['migrationCommandVersion: 2', 'migrationCommandVersion: 3'],
  ['migration_command_version: 2', 'migration_command_version: 3'],
  ['migration_command_version=2', 'migration_command_version=3'],
  ["      '6',\n      '2',\n      '1'", "      '7',\n      '3',\n      '1'"]
]);

await patch('tests/tenant-import-auto-canary.test.mjs', [[
  "tenant-data-plane-schema-v6.js",
  "tenant-data-plane-schema-v7.js"
]]);

for (const path of [
  '.github/workflows/validate-saas-control-plane.yml',
  '.github/workflows/validate-tenant-ingestion.yml'
]) {
  await patchAll(path, [
    ["schema_version FROM data_plane_identity", "schema_version FROM data_plane_identity"],
    ["= '6'", "= '7'"],
    ["= '1,2,3,4,5,6'", "= '1,2,3,4,5,6,7'"]
  ]);
}

await patch('.github/workflows/validate-saas-control-plane.yml', [[
  `          test "$(sqlite3 "$TENANT_DB" "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('supplier_sync_stage_catalog_categories','supplier_sync_stage_leagues','supplier_sync_stage_teams','supplier_sync_stage_facets','supplier_sync_stage_media_sources','supplier_sync_stage_product_details','supplier_sync_stage_product_media','supplier_sync_stage_product_categories','supplier_sync_stage_product_facets','supplier_sync_stage_classification_state','supplier_sync_stage_intelligence_state','supplier_sync_stage_catalog_meta');")" = '12'`,
  `          test "$(sqlite3 "$TENANT_DB" "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('supplier_sync_stage_catalog_categories','supplier_sync_stage_leagues','supplier_sync_stage_teams','supplier_sync_stage_facets','supplier_sync_stage_media_sources','supplier_sync_stage_product_details','supplier_sync_stage_product_media','supplier_sync_stage_product_categories','supplier_sync_stage_product_facets','supplier_sync_stage_classification_state','supplier_sync_stage_intelligence_state','supplier_sync_stage_catalog_meta');")" = '12'\n          test "$(sqlite3 "$TENANT_DB" "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('catalog_serving_authority','supplier_sync_stage_authority');")" = '2'`
]]);

await patch('.github/workflows/validate-tenant-ingestion.yml', [[
  `          test "$(sqlite3 "$TENANT_DB" "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('supplier_sync_stage_catalog_categories','supplier_sync_stage_leagues','supplier_sync_stage_teams','supplier_sync_stage_facets','supplier_sync_stage_media_sources','supplier_sync_stage_product_details','supplier_sync_stage_product_media','supplier_sync_stage_product_categories','supplier_sync_stage_product_facets','supplier_sync_stage_classification_state','supplier_sync_stage_intelligence_state','supplier_sync_stage_catalog_meta');")" = '12'`,
  `          test "$(sqlite3 "$TENANT_DB" "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('supplier_sync_stage_catalog_categories','supplier_sync_stage_leagues','supplier_sync_stage_teams','supplier_sync_stage_facets','supplier_sync_stage_media_sources','supplier_sync_stage_product_details','supplier_sync_stage_product_media','supplier_sync_stage_product_categories','supplier_sync_stage_product_facets','supplier_sync_stage_classification_state','supplier_sync_stage_intelligence_state','supplier_sync_stage_catalog_meta');")" = '12'\n          test "$(sqlite3 "$TENANT_DB" "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('catalog_serving_authority','supplier_sync_stage_authority');")" = '2'`
]]);

console.log(JSON.stringify({ ok: true, boundary: 'm7d7-schema-v7-foundation' }));
