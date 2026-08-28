import { readFile, writeFile } from 'node:fs/promises';

async function read(path) {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}
async function write(path, value) {
  await writeFile(new URL(`../${path}`, import.meta.url), value, 'utf8');
}
function replaceOnce(source, from, to, label) {
  const first = source.indexOf(from);
  if (first < 0) throw new Error(`m7d9_ci_align_missing:${label}`);
  if (source.indexOf(from, first + from.length) >= 0) {
    throw new Error(`m7d9_ci_align_ambiguous:${label}`);
  }
  return source.slice(0, first) + to + source.slice(first + from.length);
}

{
  const path = '.github/workflows/validate-tenant-ingestion.yml';
  let source = await read(path);
  source = replaceOnce(
    source,
    `test "$(sqlite3 "$TENANT_DB" "SELECT schema_version FROM data_plane_identity LIMIT 1;")" = '7'`,
    `test "$(sqlite3 "$TENANT_DB" "SELECT schema_version FROM data_plane_identity LIMIT 1;")" = '8'`,
    'ingestion-schema-version'
  );
  source = replaceOnce(
    source,
    `test "$(sqlite3 "$TENANT_DB" "SELECT GROUP_CONCAT(version, ',') FROM (SELECT version FROM data_plane_schema_migrations ORDER BY version);")" = '1,2,3,4,5,6,7'`,
    `test "$(sqlite3 "$TENANT_DB" "SELECT GROUP_CONCAT(version, ',') FROM (SELECT version FROM data_plane_schema_migrations ORDER BY version);")" = '1,2,3,4,5,6,7,8'`,
    'ingestion-ledger'
  );
  source = replaceOnce(
    source,
    `          test "$(sqlite3 "$TENANT_DB" "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('catalog_serving_authority','supplier_sync_stage_authority');")" = '2'\n          sqlite3 "$TENANT_DB" 'PRAGMA foreign_key_check;'`,
    `          test "$(sqlite3 "$TENANT_DB" "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('catalog_serving_authority','supplier_sync_stage_authority');")" = '2'\n          test "$(sqlite3 "$TENANT_DB" "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('supplier_scope_memberships','supplier_sync_stage_removal_policy','catalog_product_classification_override_retention');")" = '3'\n          test "$(sqlite3 "$TENANT_DB" "SELECT COUNT(*) FROM sqlite_master WHERE type='view' AND name='catalog_product_effective_classification_overrides';")" = '1'\n          sqlite3 "$TENANT_DB" 'PRAGMA foreign_key_check;'`,
    'ingestion-v8-removal-schema'
  );
  await write(path, source);
}

{
  const path = 'tests/tenant-data-plane-fleet-migration.test.mjs';
  let source = await read(path);
  source = replaceOnce(
    source,
    `it('keeps tenant schema CI aligned with the v7 fleet target and migration ownership', () => {\n    for (const workflow of [saasWorkflow, ingestionWorkflow]) {\n      expect(workflow).toContain('schema_version FROM data_plane_identity');\n      expect(workflow).toContain("= '7'");\n      expect(workflow).toContain("= '1,2,3,4,5,6,7'");\n      expect(workflow).toContain('catalog_product_intelligence_state');\n      expect(workflow).toContain('supplier_sync_stage_runs');\n      expect(workflow).toContain('supplier_sync_stage_observations');\n      expect(workflow).toContain('supplier_sync_stage_events');\n      expect(workflow).toContain('supplier_sync_stage_categories');\n      expect(workflow).toContain('supplier_sync_stage_product_details');\n      expect(workflow).toContain('supplier_sync_stage_intelligence_state');\n    }`,
    `it('keeps tenant schema CI aligned with the v8 fleet target and migration ownership', () => {\n    for (const workflow of [saasWorkflow, ingestionWorkflow]) {\n      expect(workflow).toContain('schema_version FROM data_plane_identity');\n      expect(workflow).toContain("= '8'");\n      expect(workflow).toContain("= '1,2,3,4,5,6,7,8'");\n      expect(workflow).toContain('catalog_product_intelligence_state');\n      expect(workflow).toContain('supplier_sync_stage_runs');\n      expect(workflow).toContain('supplier_sync_stage_observations');\n      expect(workflow).toContain('supplier_sync_stage_events');\n      expect(workflow).toContain('supplier_sync_stage_categories');\n      expect(workflow).toContain('supplier_sync_stage_product_details');\n      expect(workflow).toContain('supplier_sync_stage_intelligence_state');\n      expect(workflow).toContain('supplier_scope_memberships');\n      expect(workflow).toContain('supplier_sync_stage_removal_policy');\n      expect(workflow).toContain('catalog_product_classification_override_retention');\n      expect(workflow).toContain('catalog_product_effective_classification_overrides');\n    }`,
    'fleet-static-ci-contract'
  );
  await write(path, source);
}

console.log(JSON.stringify({ m7d9CiContractAligned: true }));
