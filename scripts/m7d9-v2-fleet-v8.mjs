import { readFile, writeFile } from 'node:fs/promises';

async function read(path) {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}
async function write(path, value) {
  await writeFile(new URL(`../${path}`, import.meta.url), value, 'utf8');
}
function replaceOnce(source, from, to, label) {
  const first = source.indexOf(from);
  if (first < 0) throw new Error(`m7d9_fleet_v8_missing:${label}`);
  if (source.indexOf(from, first + from.length) >= 0) {
    throw new Error(`m7d9_fleet_v8_ambiguous:${label}`);
  }
  return source.slice(0, first) + to + source.slice(first + from.length);
}
function replaceAllRequired(source, from, to, label, minimum = 1) {
  const count = source.split(from).length - 1;
  if (count < minimum) throw new Error(`m7d9_fleet_v8_missing:${label}:${count}`);
  return source.split(from).join(to);
}

{
  const path = 'scripts/cloudflare-tenant-data-plane-fleet-canary.mjs';
  let source = await read(path);
  source = replaceOnce(
    source,
    `import {\n  TENANT_DATA_PLANE_SCHEMA_VERSION as PREVIOUS_SCHEMA_VERSION,\n  TENANT_SYNC_CANDIDATE_TABLES,\n  tenantDataPlaneCurrentBatch as tenantDataPlaneV6Batch\n} from '../worker/tenant-data-plane-schema-v6.js';\nimport {\n  TENANT_DATA_PLANE_SCHEMA_VERSION as CURRENT_SCHEMA_VERSION\n} from '../worker/tenant-data-plane-schema-v7.js';`,
    `import {\n  TENANT_DATA_PLANE_SCHEMA_VERSION as PREVIOUS_SCHEMA_VERSION,\n  TENANT_SYNC_CANDIDATE_TABLES,\n  tenantDataPlaneCurrentBatch as tenantDataPlaneV7Batch\n} from '../worker/tenant-data-plane-schema-v7.js';\nimport {\n  TENANT_DATA_PLANE_SCHEMA_VERSION as CURRENT_SCHEMA_VERSION\n} from '../worker/tenant-data-plane-schema-v8.js';`,
    'canary-schema-imports'
  );
  source = replaceAllRequired(
    source,
    'tenantDataPlaneV6Batch',
    'tenantDataPlaneV7Batch',
    'canary-previous-batch'
  );
  source = replaceOnce(
    source,
    `const HISTORICAL_MIGRATION_METADATA = '{"schemaVersion":6,"sentinel":"unchanged"}';`,
    `const HISTORICAL_MIGRATION_METADATA = '{"schemaVersion":7,"sentinel":"unchanged"}';`,
    'canary-historical-metadata'
  );
  source = replaceOnce(
    source,
    `  if (PREVIOUS_SCHEMA_VERSION !== 6 || CURRENT_SCHEMA_VERSION !== 7) {`,
    `  if (PREVIOUS_SCHEMA_VERSION !== 7 || CURRENT_SCHEMA_VERSION !== 8) {`,
    'canary-schema-contract'
  );
  source = replaceAllRequired(
    source,
    'Historical v6 candidate category',
    'Historical v7 candidate category',
    'canary-historical-label'
  );
  source = replaceOnce(
    source,
    `  const expectedLedger =\n    expectedSchemaVersion === CURRENT_SCHEMA_VERSION ? '1,2,3,4,5,6,7' : '1,2,3,4,5,6';\n  const expectedCandidateStageTables = TENANT_SYNC_CANDIDATE_TABLES.length;\n  const expectedAuthorityTableCount = expectedSchemaVersion === CURRENT_SCHEMA_VERSION ? 2 : 0;`,
    `  const expectedLedger =\n    expectedSchemaVersion === CURRENT_SCHEMA_VERSION ? '1,2,3,4,5,6,7,8' : '1,2,3,4,5,6,7';\n  const expectedCandidateStageTables = TENANT_SYNC_CANDIDATE_TABLES.length;\n  const expectedAuthorityTableCount = 2;`,
    'canary-ledger-authority-contract'
  );
  source = replaceOnce(
    source,
    `  if (expectedSchemaVersion === CURRENT_SCHEMA_VERSION) {\n    if (\n      state.servingAuthority?.tenant_id !== fixture.tenantId ||\n      Number(state.servingAuthority?.contract_version) !== 1 ||\n      Number(state.servingAuthority?.revision) !== 0 ||\n      state.stageAuthorityRows !== 0\n    ) {\n      throw new Error('fleet_canary_authority_model_invalid');\n    }\n  } else if (state.servingAuthority !== null || state.stageAuthorityRows !== 0) {\n    throw new Error('fleet_canary_authority_model_leaked_backward');\n  }`,
    `  if (\n    state.servingAuthority?.tenant_id !== fixture.tenantId ||\n    Number(state.servingAuthority?.contract_version) !== 1 ||\n    Number(state.servingAuthority?.revision) !== 0 ||\n    state.stageAuthorityRows !== 0\n  ) {\n    throw new Error('fleet_canary_authority_model_invalid');\n  }`,
    'canary-v7-authority-baseline'
  );
  await write(path, source);
}

{
  const path = 'tests/tenant-data-plane-fleet-canary.test.mjs';
  let source = await read(path);
  source = replaceOnce(
    source,
    `import { tenantDataPlaneCurrentBatch as tenantDataPlaneV6Batch } from '../worker/tenant-data-plane-schema-v6.js';`,
    `import { tenantDataPlaneCurrentBatch as tenantDataPlaneV7Batch } from '../worker/tenant-data-plane-schema-v7.js';`,
    'test-previous-schema-import'
  );
  source = replaceAllRequired(source, 'tenantDataPlaneV6Batch', 'tenantDataPlaneV7Batch', 'test-previous-batch');
  source = replaceOnce(
    source,
    `it('builds a valid v6 fixture with LKG, staged candidate evidence and merchant override before polling'`,
    `it('builds a valid v7 fixture with LKG, staged candidate evidence and merchant override before polling'`,
    'test-v7-fixture-title'
  );
  source = replaceOnce(
    source,
    `    ).toEqual({ tenant_id: fixture.tenantId, schema_version: 6 });`,
    `    ).toEqual({ tenant_id: fixture.tenantId, schema_version: 7 });`,
    'test-previous-schema-version'
  );
  source = replaceOnce(source, `    ).toBe('1,2,3,4,5,6');`, `    ).toBe('1,2,3,4,5,6,7');`, 'test-previous-ledger');
  source = replaceOnce(
    source,
    `            WHERE status='ready' AND schema_version=6`,
    `            WHERE status='ready' AND schema_version=7`,
    'test-control-previous-schema'
  );
  source = replaceOnce(
    source,
    `SELECT CASE WHEN migration_command_version=3 THEN 'prepared' ELSE 'pending' END AS kind`,
    `SELECT CASE WHEN migration_command_version=4 THEN 'prepared' ELSE 'pending' END AS kind`,
    'test-command-marker'
  );
  source = replaceOnce(
    source,
    `it('starts from a real v6 data plane and verifies the v7 authority model is additive and inert'`,
    `it('starts from a real v7 data plane and verifies the v8 removal schema is additive and inert'`,
    'test-v8-fleet-title'
  );
  source = replaceOnce(
    source,
    `    expect(script).toContain("from '../worker/tenant-data-plane-schema-v6.js'");\n    expect(script).toContain("from '../worker/tenant-data-plane-schema-v7.js'");\n    expect(script).toContain("'1,2,3,4,5,6,7'");\n    expect(script).toContain("'1,2,3,4,5,6'");`,
    `    expect(script).toContain("from '../worker/tenant-data-plane-schema-v7.js'");\n    expect(script).toContain("from '../worker/tenant-data-plane-schema-v8.js'");\n    expect(script).toContain("'1,2,3,4,5,6,7,8'");\n    expect(script).toContain("'1,2,3,4,5,6,7'");\n    expect(script).toContain('supplier_scope_memberships');\n    expect(script).toContain('supplier_sync_stage_removal_policy');`,
    'test-v8-script-contract'
  );
  await write(path, source);
}

{
  const path = 'tests/tenant-data-plane-fleet-preparation.test.mjs';
  let source = await read(path);
  source = replaceAllRequired(
    source,
    'migrationCommandVersion: 3',
    'migrationCommandVersion: 4',
    'preparation-command-version'
  );
  await write(path, source);
}

console.log(JSON.stringify({ m7d9FleetV8Aligned: true }));
