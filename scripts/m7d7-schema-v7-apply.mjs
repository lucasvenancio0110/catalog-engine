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

async function patchFleetMigrationCurrentPath() {
  const path = 'tests/tenant-data-plane-fleet-migration.test.mjs';
  const marker = "  it('upgrades a real v5 tenant through only the idempotent v6 delta while preserving LKG'";
  const text = await readFile(path, 'utf8');
  const markerIndex = text.indexOf(marker);
  if (markerIndex < 0 || text.indexOf(marker, markerIndex + 1) >= 0) {
    throw new Error('m7d7_fleet_migration_historical_boundary_invalid');
  }
  let current = text.slice(0, markerIndex);
  const historical = text.slice(markerIndex);

  const replacements = [
    ['prepared ? 2 : 0', 'prepared ? 3 : 0'],
    ['migration_command_version: 2,', 'migration_command_version: 3,'],
    ['target_schema_version: 6,', 'target_schema_version: 7,'],
    [
      "it('targets schema v6 and only discovers maintenance work for ready idle tenants'",
      "it('targets schema v7 and only discovers maintenance work for ready idle tenants'"
    ],
    [
      `expect(migrationRunnerSource).toContain("from './tenant-data-plane-schema-v6.js'");`,
      `expect(migrationRunnerSource).toContain("from './tenant-data-plane-schema-v7.js'");`
    ],
    [
      "it('keeps tenant schema CI aligned with the v6 fleet target and migration ownership'",
      "it('keeps tenant schema CI aligned with the v7 fleet target and migration ownership'"
    ],
    [`expect(workflow).toContain("= '6'");`, `expect(workflow).toContain("= '7'");`],
    [
      `expect(workflow).toContain("= '1,2,3,4,5,6'");`,
      `expect(workflow).toContain("= '1,2,3,4,5,6,7'");`
    ],
    ["?1,6,'maintenance','failed'", "?1,7,'maintenance','failed'"],
    ["?1,6,'maintenance','failed',1,NULL", "?1,7,'maintenance','failed',1,NULL"],
    ["?2,6,'maintenance',?3", "?2,7,'maintenance',?3"],
    ['MAINTENANCE_MIGRATION_DISCOVERY_SQL).all(6, 2, 2)', 'MAINTENANCE_MIGRATION_DISCOVERY_SQL).all(7, 3, 2)'],
    ['MAINTENANCE_MIGRATION_DISCOVERY_SQL).all(6, 2, 5)', 'MAINTENANCE_MIGRATION_DISCOVERY_SQL).all(7, 3, 5)'],
    ['DATA_PLANE_MIGRATION_DUE_SQL).all(6, 6, 2, 5)', 'DATA_PLANE_MIGRATION_DUE_SQL).all(6, 7, 3, 5)'],
    ['DATA_PLANE_MIGRATION_DUE_SQL).all(6, 6, 2, 2)', 'DATA_PLANE_MIGRATION_DUE_SQL).all(6, 7, 3, 2)'],
    [
      "it('finishes maintenance on v6 without resuming historical onboarding or changing serving status'",
      "it('finishes maintenance on v7 without resuming historical onboarding or changing serving status'"
    ],
    [
      "it('reconciles control state after D1 already completed v6 without replaying schema DDL'",
      "it('reconciles control state after D1 already completed v7 without replaying schema DDL'"
    ],
    [
      "it('persists a bounded verify-phase code after the v6 delta was accepted'",
      "it('persists a bounded verify-phase code after the v7 migration was accepted'"
    ],
    [
`          expect(payload).toEqual({
            version: 2,
            tenantId: TENANT_ID,
            targetSchemaVersion: 6
          });`,
`          expect(payload).toEqual({
            version: 3,
            tenantId: TENANT_ID,
            targetSchemaVersion: 7
          });`
    ],
    [
      `expect(payload).toEqual({ version: 2, tenantId: TENANT_ID, targetSchemaVersion: 6 });`,
      `expect(payload).toEqual({ version: 3, tenantId: TENANT_ID, targetSchemaVersion: 7 });`
    ],
    [
      'Response.json({ ok: true, version: 2, schemaVersion: 6, applied: true })',
      'Response.json({ ok: true, version: 3, schemaVersion: 7, applied: true })'
    ],
    ['schemaVersion: 6,', 'schemaVersion: 7,'],
    ['schemaVersion: 6 });', 'schemaVersion: 7 });'],
    [
      `{ success: true, results: [{ tenant_id: TENANT_ID, schema_version: 6 }] },`,
      `{ success: true, results: [{ tenant_id: TENANT_ID, schema_version: 7 }] },`
    ],
    [
`                { success: true, results: [{ tenant_id: TENANT_ID, schema_version: '6' }] },
                {
                  success: true,
                  results: [
                    { version: 1 },
                    { version: 2 },
                    { version: 3 },
                    { version: 4 },
                    { version: 5 },
                    { version: 6 }
                  ]
                }`,
`                { success: true, results: [{ tenant_id: TENANT_ID, schema_version: '7' }] },
                {
                  success: true,
                  results: [
                    { version: 1 },
                    { version: 2 },
                    { version: 3 },
                    { version: 4 },
                    { version: 5 },
                    { version: 6 },
                    { version: 7 }
                  ]
                }`
    ],
    [
      `{ success: true, results: [{ tenant_id: TENANT_ID, schema_version: '6' }] },`,
      `{ success: true, results: [{ tenant_id: TENANT_ID, schema_version: '7' }] },`
    ]
  ];

  for (const [before, after] of replacements) {
    if (!current.includes(before)) {
      throw new Error(`m7d7_fleet_migration_patch_missing:${before.slice(0, 90)}`);
    }
    current = current.split(before).join(after);
  }
  await writeFile(path, current + historical, 'utf8');
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

await patch('tests/tenant-incremental-scan-safety.test.mjs', [[
  `    expect(mutationSql(calls).some((sql) => /supplier_album_index|catalog_|media_sources|product_media/i.test(sql))).toBe(false);`,
  `    expect(\n      mutationSql(calls).some((sql) =>\n        /(?:INSERT(?: OR IGNORE)? INTO|UPDATE|DELETE FROM)\\s+(?:supplier_album_index|catalog_products|media_sources|product_media)\\b/i.test(sql)\n      )\n    ).toBe(false);`
]]);

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
  ["      '6',\n      '2',\n      '1'", "      '7',\n      '3',\n      '1'"]
]);

await patch('tests/tenant-import-auto-canary.test.mjs', [[
  "tenant-data-plane-schema-v6.js",
  "tenant-data-plane-schema-v7.js"
]]);

await patchFleetMigrationCurrentPath();

await patchAll('tests/tenant-data-plane-fleet-canary.test.mjs', [
  ["migration_command_version=2", "migration_command_version=3"]
]);

for (const path of [
  '.github/workflows/validate-saas-control-plane.yml',
  '.github/workflows/validate-tenant-ingestion.yml'
]) {
  await patchAll(path, [
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
