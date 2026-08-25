import { readFile, writeFile } from 'node:fs/promises';

async function patch(path, replacements) {
  let text = await readFile(path, 'utf8');
  for (const [before, after] of replacements) {
    if (!text.includes(before)) throw new Error(`m7d7_fleet_patch_missing:${path}:${before.slice(0, 100)}`);
    text = text.replace(before, after);
  }
  await writeFile(path, text, 'utf8');
}

await patch('scripts/cloudflare-tenant-data-plane-fleet-canary.mjs', [
  [
`import {
  TENANT_DATA_PLANE_SCHEMA_VERSION as PREVIOUS_SCHEMA_VERSION,
  tenantDataPlaneCurrentBatch as tenantDataPlaneV5Batch
} from '../worker/tenant-data-plane-schema-v5.js';
import {
  TENANT_DATA_PLANE_SCHEMA_VERSION as CURRENT_SCHEMA_VERSION,
  TENANT_SYNC_CANDIDATE_TABLES
} from '../worker/tenant-data-plane-schema-v6.js';`,
`import {
  TENANT_DATA_PLANE_SCHEMA_VERSION as PREVIOUS_SCHEMA_VERSION,
  TENANT_SYNC_CANDIDATE_TABLES,
  tenantDataPlaneCurrentBatch as tenantDataPlaneV6Batch
} from '../worker/tenant-data-plane-schema-v6.js';
import {
  TENANT_DATA_PLANE_SCHEMA_VERSION as CURRENT_SCHEMA_VERSION
} from '../worker/tenant-data-plane-schema-v7.js';`
  ],
  [
    `const HISTORICAL_MIGRATION_METADATA = '{"schemaVersion":5,"sentinel":"unchanged"}';`,
    `const HISTORICAL_MIGRATION_METADATA = '{"schemaVersion":6,"sentinel":"unchanged"}';`
  ],
  [
`  if (PREVIOUS_SCHEMA_VERSION !== 5 || CURRENT_SCHEMA_VERSION !== 6) {
    throw new Error('fleet_canary_schema_contract_mismatch');
  }`,
`  if (PREVIOUS_SCHEMA_VERSION !== 6 || CURRENT_SCHEMA_VERSION !== 7) {
    throw new Error('fleet_canary_schema_contract_mismatch');
  }`
  ],
  [
`    {
      sql: \`INSERT INTO supplier_sync_stage_categories
              (run_id, category_source_id, name, depth, sort_order)
            VALUES (?1, ?2, 'Historical private category', 0, 0)\`,
      params: [fixture.stageRunId, fixture.stageCategoryId]
    }
  ];`,
`    {
      sql: \`INSERT INTO supplier_sync_stage_categories
              (run_id, category_source_id, name, depth, sort_order)
            VALUES (?1, ?2, 'Historical private category', 0, 0)\`,
      params: [fixture.stageRunId, fixture.stageCategoryId]
    },
    {
      sql: \`INSERT INTO supplier_sync_stage_catalog_categories
              (run_id, category_id, name, parent_id, depth, sort_order, product_count)
            VALUES (?1, ?2, 'Historical v6 candidate category', NULL, 0, 0, 0)\`,
      params: [fixture.stageRunId, fixture.stageCategoryId]
    }
  ];`
  ],
  [
`    {
      sql: \`SELECT p.name, p.description, p.classification_status,
                   a.listing_fingerprint, a.detail_fingerprint, a.status, a.miss_count,
                   o.override_json, o.override_version
              FROM catalog_products p
              JOIN supplier_album_index a
                ON a.public_product_id=p.product_id
               AND a.tenant_id=?1 AND a.source_key=?2 AND a.album_source_id=?3
              JOIN catalog_product_classification_overrides o ON o.product_id=p.product_id
             WHERE p.product_id=?4
             LIMIT 1\`,
      params: [fixture.tenantId, fixture.sourceKey, fixture.albumSourceId, fixture.productId]
    },
    { sql: 'PRAGMA foreign_key_check', params: [] }
  ]);`,
`    {
      sql: \`SELECT p.name, p.description, p.classification_status,
                   a.listing_fingerprint, a.detail_fingerprint, a.status, a.miss_count,
                   o.override_json, o.override_version
              FROM catalog_products p
              JOIN supplier_album_index a
                ON a.public_product_id=p.product_id
               AND a.tenant_id=?1 AND a.source_key=?2 AND a.album_source_id=?3
              JOIN catalog_product_classification_overrides o ON o.product_id=p.product_id
             WHERE p.product_id=?4
             LIMIT 1\`,
      params: [fixture.tenantId, fixture.sourceKey, fixture.albumSourceId, fixture.productId]
    },
    {
      sql: \`SELECT COUNT(*) AS total
              FROM sqlite_master
             WHERE type='table'
               AND name IN ('catalog_serving_authority','supplier_sync_stage_authority')\`,
      params: []
    },
    { sql: 'PRAGMA foreign_key_check', params: [] }
  ]);`
  ],
  [
`  return {
    identity: result[0]?.results?.[0] || null,
    ledger: String(result[1]?.results?.[0]?.versions || ''),
    listingStageTableCount: Number(result[2]?.results?.[0]?.total || 0),
    candidateStageTableCount,
    candidateRowCount,
    historicalStage: result[4]?.results?.[0] || null,
    lkg: result[5]?.results?.[0] || null,
    foreignKeyFindings: (result[6]?.results || []).length
  };`,
`  const authorityTableCount = Number(result[6]?.results?.[0]?.total || 0);
  let servingAuthority = null;
  let stageAuthorityRows = 0;
  if (authorityTableCount === 2) {
    const authority = await tenantBatch(fixture, [
      {
        sql: \`SELECT tenant_id, contract_version, revision
                FROM catalog_serving_authority
               WHERE tenant_id=?1
               LIMIT 1\`,
        params: [fixture.tenantId]
      },
      {
        sql: 'SELECT COUNT(*) AS total FROM supplier_sync_stage_authority WHERE run_id=?1',
        params: [fixture.stageRunId]
      }
    ]);
    servingAuthority = authority[0]?.results?.[0] || null;
    stageAuthorityRows = Number(authority[1]?.results?.[0]?.total || 0);
  }
  return {
    identity: result[0]?.results?.[0] || null,
    ledger: String(result[1]?.results?.[0]?.versions || ''),
    listingStageTableCount: Number(result[2]?.results?.[0]?.total || 0),
    candidateStageTableCount,
    candidateRowCount,
    historicalStage: result[4]?.results?.[0] || null,
    lkg: result[5]?.results?.[0] || null,
    authorityTableCount,
    servingAuthority,
    stageAuthorityRows,
    foreignKeyFindings: (result[7]?.results || []).length
  };`
  ],
  [
`  const expectedLedger =
    expectedSchemaVersion === CURRENT_SCHEMA_VERSION ? '1,2,3,4,5,6' : '1,2,3,4,5';
  const expectedCandidateStageTables =
    expectedSchemaVersion === CURRENT_SCHEMA_VERSION ? TENANT_SYNC_CANDIDATE_TABLES.length : 0;`,
`  const expectedLedger =
    expectedSchemaVersion === CURRENT_SCHEMA_VERSION ? '1,2,3,4,5,6,7' : '1,2,3,4,5,6';
  const expectedCandidateStageTables = TENANT_SYNC_CANDIDATE_TABLES.length;
  const expectedAuthorityTableCount = expectedSchemaVersion === CURRENT_SCHEMA_VERSION ? 2 : 0;`
  ],
  [
`    state.candidateStageTableCount !== expectedCandidateStageTables ||
    state.candidateRowCount !== 0 ||
    state.foreignKeyFindings !== 0`,
`    state.candidateStageTableCount !== expectedCandidateStageTables ||
    state.candidateRowCount !== 1 ||
    state.authorityTableCount !== expectedAuthorityTableCount ||
    state.foreignKeyFindings !== 0`
  ],
  [
`  if (
    state.historicalStage?.state !== 'preserved' ||`,
`  if (expectedSchemaVersion === CURRENT_SCHEMA_VERSION) {
    if (
      state.servingAuthority?.tenant_id !== fixture.tenantId ||
      Number(state.servingAuthority?.contract_version) !== 1 ||
      Number(state.servingAuthority?.revision) !== 0 ||
      state.stageAuthorityRows !== 0
    ) {
      throw new Error('fleet_canary_authority_model_invalid');
    }
  } else if (state.servingAuthority !== null || state.stageAuthorityRows !== 0) {
    throw new Error('fleet_canary_authority_model_leaked_backward');
  }
  if (
    state.historicalStage?.state !== 'preserved' ||`
  ],
  [
`    candidateRowsCreated: dataPlane.candidateRowCount,
    foreignKeyFindings: dataPlane.foreignKeyFindings`,
`    candidateRowsPreserved: dataPlane.candidateRowCount,
    authorityTableCount: dataPlane.authorityTableCount,
    authorityRevision: dataPlane.servingAuthority?.revision ?? null,
    historicalRunAuthorityBackfilled: dataPlane.stageAuthorityRows > 0,
    foreignKeyFindings: dataPlane.foreignKeyFindings`
  ],
  [
`        tenantDataPlaneV5Batch({`,
`        tenantDataPlaneV6Batch({`
  ]
]);

await patch('tests/tenant-data-plane-fleet-canary.test.mjs', [
  [
`import { tenantDataPlaneCurrentBatch as tenantDataPlaneV5Batch } from '../worker/tenant-data-plane-schema-v5.js';`,
`import { tenantDataPlaneCurrentBatch as tenantDataPlaneV6Batch } from '../worker/tenant-data-plane-schema-v6.js';`
  ],
  [
    "it('builds a valid v5 fixture with LKG, staged listing evidence and merchant override before polling'",
    "it('builds a valid v6 fixture with LKG, staged candidate evidence and merchant override before polling'"
  ],
  [
`      ...tenantDataPlaneV5Batch({ tenantId: fixture.tenantId, source }),`,
`      ...tenantDataPlaneV6Batch({ tenantId: fixture.tenantId, source }),`
  ],
  [
`    ).toEqual({ tenant_id: fixture.tenantId, schema_version: 5 });`,
`    ).toEqual({ tenant_id: fixture.tenantId, schema_version: 6 });`
  ],
  [
`    ).toBe('1,2,3,4,5');`,
`    ).toBe('1,2,3,4,5,6');`
  ],
  [
`            WHERE status='ready' AND schema_version=5`,
`            WHERE status='ready' AND schema_version=6`
  ],
  [
`  it('starts from a real v5 data plane and verifies the v6 candidate model remains private and inert', () => {
    expect(script).toContain("from '../worker/tenant-data-plane-schema-v5.js'");
    expect(script).toContain("from '../worker/tenant-data-plane-schema-v6.js'");
    expect(script).toContain("'1,2,3,4,5,6'");
    expect(script).toContain("'1,2,3,4,5'");`,
`  it('starts from a real v6 data plane and verifies the v7 authority model is additive and inert', () => {
    expect(script).toContain("from '../worker/tenant-data-plane-schema-v6.js'");
    expect(script).toContain("from '../worker/tenant-data-plane-schema-v7.js'");
    expect(script).toContain("'1,2,3,4,5,6,7'");
    expect(script).toContain("'1,2,3,4,5,6'");`
  ],
  [
`    expect(script).toContain('candidateRowsCreated: dataPlane.candidateRowCount');`,
`    expect(script).toContain('candidateRowsPreserved: dataPlane.candidateRowCount');
    expect(script).toContain('fleet_canary_authority_model_invalid');
    expect(script).toContain('authorityRevision: dataPlane.servingAuthority?.revision ?? null');
    expect(script).toContain('historicalRunAuthorityBackfilled: dataPlane.stageAuthorityRows > 0');`
  ]
]);

console.log(JSON.stringify({ ok: true, boundary: 'm7d7-fleet-canary-v6-to-v7' }));
