import { readFile, writeFile } from 'node:fs/promises';

async function read(path) {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}
async function write(path, value) {
  await writeFile(new URL(`../${path}`, import.meta.url), value, 'utf8');
}
function replaceOnce(source, from, to, label) {
  const first = source.indexOf(from);
  if (first < 0) throw new Error(`m7d9_fleet_v8_fix_missing:${label}`);
  if (source.indexOf(from, first + from.length) >= 0) {
    throw new Error(`m7d9_fleet_v8_fix_ambiguous:${label}`);
  }
  return source.slice(0, first) + to + source.slice(first + from.length);
}

{
  const path = 'tests/tenant-data-plane-fleet-canary.test.mjs';
  let source = await read(path);
  source = replaceOnce(
    source,
    `          \`SELECT COUNT(*) AS total\n             FROM tenant_catalog_instances\n            WHERE status='ready' AND schema_version=7\``,
    `          \`SELECT COUNT(*) AS total\n             FROM tenant_catalog_instances i\n             JOIN supplier_sources s ON s.tenant_id=i.tenant_id\n            WHERE i.status='ready' AND i.schema_version=7\n              AND s.source_key='fleet-canary'\``,
    'fixture-count-scope'
  );
  await write(path, source);
}

{
  const path = 'scripts/cloudflare-tenant-data-plane-fleet-canary.mjs';
  let source = await read(path);
  source = replaceOnce(
    source,
    `  if (authorityTableCount === 2) {\n    const authority = await tenantBatch(fixture, [\n      {\n        sql: \`SELECT tenant_id, contract_version, revision\n                FROM catalog_serving_authority\n               WHERE tenant_id=?1\n               LIMIT 1\`,\n        params: [fixture.tenantId]\n      },\n      {\n        sql: 'SELECT COUNT(*) AS total FROM supplier_sync_stage_authority WHERE run_id=?1',\n        params: [fixture.stageRunId]\n      }\n    ]);\n    servingAuthority = authority[0]?.results?.[0] || null;\n    stageAuthorityRows = Number(authority[1]?.results?.[0]?.total || 0);\n  }\n  return {`,
    `  if (authorityTableCount === 2) {\n    const authority = await tenantBatch(fixture, [\n      {\n        sql: \`SELECT tenant_id, contract_version, revision\n                FROM catalog_serving_authority\n               WHERE tenant_id=?1\n               LIMIT 1\`,\n        params: [fixture.tenantId]\n      },\n      {\n        sql: 'SELECT COUNT(*) AS total FROM supplier_sync_stage_authority WHERE run_id=?1',\n        params: [fixture.stageRunId]\n      }\n    ]);\n    servingAuthority = authority[0]?.results?.[0] || null;\n    stageAuthorityRows = Number(authority[1]?.results?.[0]?.total || 0);\n  }\n  const schemaVersion = Number(result[0]?.results?.[0]?.schema_version || 0);\n  let scopeMembershipRows = null;\n  let removalPolicyRows = null;\n  if (schemaVersion >= 8) {\n    const removalState = await tenantBatch(fixture, [\n      { sql: 'SELECT COUNT(*) AS total FROM supplier_scope_memberships', params: [] },\n      { sql: 'SELECT COUNT(*) AS total FROM supplier_sync_stage_removal_policy', params: [] }\n    ]);\n    scopeMembershipRows = Number(removalState[0]?.results?.[0]?.total || 0);\n    removalPolicyRows = Number(removalState[1]?.results?.[0]?.total || 0);\n  }\n  return {`,
    'removal-schema-readback'
  );
  source = replaceOnce(
    source,
    `    servingAuthority,\n    stageAuthorityRows,\n    foreignKeyFindings: (result[7]?.results || []).length`,
    `    servingAuthority,\n    stageAuthorityRows,\n    scopeMembershipRows,\n    removalPolicyRows,\n    foreignKeyFindings: (result[7]?.results || []).length`,
    'removal-schema-state'
  );
  source = replaceOnce(
    source,
    `    state.candidateRowCount !== 1 ||\n    state.authorityTableCount !== expectedAuthorityTableCount ||\n    state.foreignKeyFindings !== 0`,
    `    state.candidateRowCount !== 1 ||\n    state.authorityTableCount !== expectedAuthorityTableCount ||\n    (expectedSchemaVersion === CURRENT_SCHEMA_VERSION &&\n      (state.scopeMembershipRows !== 0 || state.removalPolicyRows !== 0)) ||\n    (expectedSchemaVersion !== CURRENT_SCHEMA_VERSION &&\n      (state.scopeMembershipRows !== null || state.removalPolicyRows !== null)) ||\n    state.foreignKeyFindings !== 0`,
    'removal-schema-inert-assertion'
  );
  await write(path, source);
}

console.log(JSON.stringify({ m7d9FleetV8FixApplied: true }));
