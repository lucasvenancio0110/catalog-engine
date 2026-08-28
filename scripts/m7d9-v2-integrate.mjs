import { readFile, writeFile } from 'node:fs/promises';

async function read(path) {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

async function write(path, value) {
  await writeFile(new URL(`../${path}`, import.meta.url), value, 'utf8');
}

function replaceOnce(source, from, to, label) {
  const first = source.indexOf(from);
  if (first < 0) throw new Error(`m7d9_v2_patch_missing:${label}`);
  if (source.indexOf(from, first + from.length) >= 0) {
    throw new Error(`m7d9_v2_patch_ambiguous:${label}`);
  }
  return source.slice(0, first) + to + source.slice(first + from.length);
}

// Schema v8 is the additive current target, while historical v7 execution stays supported.
{
  const path = 'worker/tenant-data-plane-command.js';
  let source = await read(path);
  source = replaceOnce(
    source,
    `import {\n  TENANT_DATA_PLANE_SCHEMA_VERSION as CURRENT_TENANT_DATA_PLANE_SCHEMA_VERSION,\n  TENANT_DATA_PLANE_V7_STATEMENTS\n} from './tenant-data-plane-schema-v7.js';`,
    `import { TENANT_DATA_PLANE_V7_STATEMENTS } from './tenant-data-plane-schema-v7.js';\nimport {\n  TENANT_DATA_PLANE_SCHEMA_VERSION as CURRENT_TENANT_DATA_PLANE_SCHEMA_VERSION,\n  TENANT_DATA_PLANE_V8_STATEMENTS\n} from './tenant-data-plane-schema-v8.js';`,
    'command-current-schema-import'
  );
  source = replaceOnce(
    source,
    'export const TENANT_DATA_PLANE_MIGRATION_COMMAND_VERSION = 3;',
    'export const TENANT_DATA_PLANE_MIGRATION_COMMAND_VERSION = 4;',
    'command-protocol-version'
  );
  source = replaceOnce(
    source,
    `  6: TENANT_DATA_PLANE_V6_STATEMENTS,\n  7: TENANT_DATA_PLANE_V7_STATEMENTS\n});`,
    `  6: TENANT_DATA_PLANE_V6_STATEMENTS,\n  7: TENANT_DATA_PLANE_V7_STATEMENTS,\n  8: TENANT_DATA_PLANE_V8_STATEMENTS\n});`,
    'command-v8-statements'
  );
  await write(path, source);
}

{
  const path = 'worker/data-plane-migration-runner.js';
  let source = await read(path);
  source = replaceOnce(
    source,
    `} from './tenant-data-plane-schema-v7.js';`,
    `} from './tenant-data-plane-schema-v8.js';`,
    'fleet-current-schema-import'
  );
  await write(path, source);
}

// v8 stage captures removal policy immutably; v7 stage shape stays byte-for-byte compatible.
{
  const path = 'worker/ingestion/incremental-stage.js';
  let source = await read(path);
  const marker = `function clearStageQuery(table, context) {`;
  const functions = `function removalPolicyForStage(context, plan) {\n  if (Number(context?.schemaVersion || 0) < 8) return null;\n  const policy = plan?.removalPolicy || null;\n  if (\n    !policy ||\n    !text(policy.scopeId) ||\n    !text(policy.scopeKind) ||\n    Number(policy.contractVersion || 0) !== 1 ||\n    Number(policy.policyVersion || 0) !== 1 ||\n    Number(policy.removalThreshold || 0) < 2 ||\n    text(policy.scopeId) !== text(plan?.decision?.scope?.id) ||\n    text(policy.scopeKind) !== text(plan?.decision?.scope?.kind)\n  ) {\n    throw new Error('tenant_sync_removal_policy_invalid');\n  }\n  return policy;\n}\n\nfunction beginStageRemovalPolicyQuery(context, policy) {\n  return {\n    sql: \`INSERT OR IGNORE INTO supplier_sync_stage_removal_policy\n      (run_id, tenant_id, source_key, scope_id, scope_kind, contract_version, policy_version,\n       removal_threshold, created_at, updated_at)\n      SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP\n       WHERE EXISTS (\n         SELECT 1 FROM supplier_sync_stage_runs r\n          WHERE r.run_id=?1 AND r.tenant_id=?2 AND r.source_key=?3 AND r.state='staging'\n       )\`,\n    params: [\n      context.importId, context.tenantId, context.sourceKey, policy.scopeId, policy.scopeKind,\n      Number(policy.contractVersion), Number(policy.policyVersion), Number(policy.removalThreshold)\n    ]\n  };\n}\n\nfunction enforceRemovalPolicySnapshotQuery(context, policy) {\n  return {\n    sql: \`UPDATE supplier_sync_stage_runs\n             SET state='failed', last_error_code='sync_removal_policy_snapshot_mismatch',\n                 updated_at=CURRENT_TIMESTAMP\n           WHERE run_id=?1 AND tenant_id=?2 AND source_key=?3\n             AND state IN ('planned','details_pending')\n             AND NOT EXISTS (\n               SELECT 1 FROM supplier_sync_stage_removal_policy p\n                WHERE p.run_id=?1 AND p.tenant_id=?2 AND p.source_key=?3\n                  AND p.scope_id=?4 AND p.scope_kind=?5\n                  AND p.contract_version=CAST(?6 AS INTEGER)\n                  AND p.policy_version=CAST(?7 AS INTEGER)\n                  AND p.removal_threshold=CAST(?8 AS INTEGER)\n             )\`,\n    params: [\n      context.importId, context.tenantId, context.sourceKey, policy.scopeId, policy.scopeKind,\n      Number(policy.contractVersion), Number(policy.policyVersion), Number(policy.removalThreshold)\n    ]\n  };\n}\n\n`;
  source = replaceOnce(source, marker, functions + marker, 'stage-policy-functions');
  source = replaceOnce(
    source,
    `  const proceed = plan.decision.outcome === 'proceed';\n  const planWithTaxonomy = { ...plan, scanTaxonomyCount: scan.taxonomy.length };`,
    `  const proceed = plan.decision.outcome === 'proceed';\n  const removalPolicy = removalPolicyForStage(context, plan);\n  const planWithTaxonomy = { ...plan, scanTaxonomyCount: scan.taxonomy.length };`,
    'stage-policy-resolution'
  );
  source = replaceOnce(
    source,
    `      beginStageQuery(context, scan, plan),\n      beginStageAuthorityQuery(context),\n      clearStageQuery('supplier_sync_stage_observations', context),`,
    `      beginStageQuery(context, scan, plan),\n      beginStageAuthorityQuery(context),\n      ...(removalPolicy ? [beginStageRemovalPolicyQuery(context, removalPolicy)] : []),\n      clearStageQuery('supplier_sync_stage_observations', context),`,
    'stage-policy-begin'
  );
  source = replaceOnce(
    source,
    `    sealBatch: Object.freeze([\n      sealStageQuery(context, planWithTaxonomy),\n      sealSyncRunQuery(context)\n    ])`,
    `    sealBatch: Object.freeze([\n      sealStageQuery(context, planWithTaxonomy),\n      ...(removalPolicy ? [enforceRemovalPolicySnapshotQuery(context, removalPolicy)] : []),\n      sealSyncRunQuery(context)\n    ])`,
    'stage-policy-seal'
  );
  await write(path, source);
}

// Retained merchant truth is visible only to v8 candidate classification.
{
  const path = 'worker/ingestion/incremental-classification-runner.js';
  let source = await read(path);
  source = replaceOnce(
    source,
    `async function loadCandidateState(context, platform, queryBatch, fetchImpl) {\n  const result = await tenantRequest(`,
    `async function loadCandidateState(context, platform, queryBatch, fetchImpl) {\n  const overrideRelation = Number(context.schemaVersion || 0) >= 8\n    ? 'catalog_product_effective_classification_overrides'\n    : 'catalog_product_classification_overrides';\n  const result = await tenantRequest(`,
    'classification-override-relation'
  );
  source = replaceOnce(
    source,
    `                LEFT JOIN catalog_product_classification_overrides override\n                  ON override.product_id=d.public_product_id`,
    `                LEFT JOIN \${overrideRelation} override\n                  ON override.product_id=d.public_product_id`,
    'classification-effective-override'
  );
  await write(path, source);
}

console.log(JSON.stringify({ m7d9V2Integrated: true }));
