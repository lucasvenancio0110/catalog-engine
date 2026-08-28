import { readFile, writeFile } from 'node:fs/promises';

async function read(path) {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

async function write(path, value) {
  await writeFile(new URL(`../${path}`, import.meta.url), value, 'utf8');
}

function replaceOnce(source, from, to, label) {
  const first = source.indexOf(from);
  if (first < 0) throw new Error(`m7d9_correct_missing:${label}`);
  if (source.indexOf(from, first + from.length) >= 0) {
    throw new Error(`m7d9_correct_ambiguous:${label}`);
  }
  return source.slice(0, first) + to + source.slice(first + from.length);
}

// Preserve the already-green v7 non-removal path while the fleet migrates to v8.
{
  const path = 'worker/ingestion/incremental-scan-consumer.js';
  let source = await read(path);
  source = source.replace('MIN_INCREMENTAL_STAGE_SCHEMA_VERSION = 8', 'MIN_INCREMENTAL_STAGE_SCHEMA_VERSION = 7');
  source = source.replace('MIN_INCREMENTAL_DETAIL_SCHEMA_VERSION = 8', 'MIN_INCREMENTAL_DETAIL_SCHEMA_VERSION = 7');
  await write(path, source);
}

{
  const path = 'worker/ingestion/incremental-classification-runner.js';
  let source = await read(path);
  source = source.replaceAll('schema_version >= 8', 'schema_version >= 6');
  source = source.replaceAll('schemaVersion < 8', 'schemaVersion < 6');
  source = replaceOnce(
    source,
    'async function loadCandidateState(context, platform, queryBatch, fetchImpl) {\n  const result = await tenantRequest(',
    "async function loadCandidateState(context, platform, queryBatch, fetchImpl) {\n  const overrideRelation = Number(context.schemaVersion || 0) >= 8\n    ? 'catalog_product_effective_classification_overrides'\n    : 'catalog_product_classification_overrides';\n  const result = await tenantRequest(",
    'classification-override-relation'
  );
  source = source.replaceAll(
    'LEFT JOIN catalog_product_effective_classification_overrides override',
    'LEFT JOIN ${overrideRelation} override'
  );
  await write(path, source);
}

{
  const path = 'worker/ingestion/incremental-verification-runner.js';
  let source = await read(path);
  source = source.replaceAll('schema_version >= 8', 'schema_version >= 6');
  source = source.replaceAll('schemaVersion < 8', 'schemaVersion < 6');
  source = replaceOnce(
    source,
    'function metricSpecs(context) {\n  const runId = context.importId;',
    "function metricSpecs(context) {\n  const runId = context.importId;\n  const overrideRelation = Number(context.schemaVersion || 0) >= 8\n    ? 'catalog_product_effective_classification_overrides'\n    : 'catalog_product_classification_overrides';",
    'verification-override-relation'
  );
  source = source.replaceAll(
    'LEFT JOIN catalog_product_effective_classification_overrides o',
    'LEFT JOIN ${overrideRelation} o'
  );
  await write(path, source);
}

{
  const path = 'worker/ingestion/incremental-finalization-runner.js';
  let source = await read(path);
  source = source.replaceAll('instance.schema_version>=8', 'instance.schema_version>=7');
  source = source.replaceAll('instance.schema_version >= 8', 'instance.schema_version >= 7');
  source = source.replaceAll('schemaVersion < 8', 'schemaVersion < 7');
  await write(path, source);
}

// Stage policy is additive. Historical/manual v7 plans stay valid and never touch v8 tables.
{
  const path = 'worker/ingestion/incremental-stage.js';
  let source = await read(path);
  source = replaceOnce(
    source,
    "    !Array.isArray(plan.events) ||\n    !Array.isArray(plan.detailQueue) ||\n    !plan.removalPolicy ||\n    !text(plan.removalPolicy.scopeId) ||\n    !text(plan.removalPolicy.scopeKind) ||\n    Number(plan.removalPolicy.removalThreshold || 0) < 2\n",
    "    !Array.isArray(plan.events) ||\n    !Array.isArray(plan.detailQueue)\n",
    'stage-backward-compatible-input'
  );
  source = replaceOnce(
    source,
    `      beginStageAuthorityQuery(context),\n      beginStageRemovalPolicyQuery(context, plan),\n      clearStageQuery('supplier_sync_stage_observations', context),`,
    `      beginStageAuthorityQuery(context),\n      ...(Number(context.schemaVersion || 0) >= 8 && plan.removalPolicy\n        ? [beginStageRemovalPolicyQuery(context, plan)]\n        : []),\n      clearStageQuery('supplier_sync_stage_observations', context),`,
    'stage-conditional-policy-begin'
  );
  source = replaceOnce(
    source,
    `      sealStageQuery(context, planWithTaxonomy),\n      enforceRemovalPolicySnapshotQuery(context, plan),\n      sealSyncRunQuery(context)`,
    `      sealStageQuery(context, planWithTaxonomy),\n      ...(Number(context.schemaVersion || 0) >= 8 && plan.removalPolicy\n        ? [enforceRemovalPolicySnapshotQuery(context, plan)]\n        : []),\n      sealSyncRunQuery(context)`,
    'stage-conditional-policy-seal'
  );
  await write(path, source);
}

// Promotion stays backward-compatible for v7 runs without absence. D9-specific statements
// are included only for v8; absence on v7 fails closed before canonical mutation.
{
  const path = 'worker/ingestion/incremental-promotion.js';
  let source = await read(path);
  source = source.replace('Number(context.schemaVersion || 0) < 8', 'Number(context.schemaVersion || 0) < 7');

  const oldComposedStart = 'function composedProductCountSql() {';
  const composedStart = source.indexOf(oldComposedStart);
  const composedEnd = source.indexOf('\n}\n\nfunction composedMediaCountSql()', composedStart);
  if (composedStart < 0 || composedEnd < 0) throw new Error('m7d9_correct_missing:composed-product');
  const composedReplacement = `function composedProductCountSql(context) {\n  if (Number(context?.schemaVersion || 0) < 8) {\n    return \`(\n      (SELECT COUNT(*) FROM catalog_products p\n        WHERE NOT EXISTS (\n          SELECT 1 FROM supplier_sync_stage_product_details d\n           WHERE d.run_id=?1 AND d.public_product_id=p.product_id\n        ))\n      + (SELECT COUNT(*) FROM supplier_sync_stage_product_details d\n          WHERE d.run_id=?1 AND d.detail_state='complete')\n    )\`;\n  }\n  return \`(\n    (SELECT COUNT(*) FROM catalog_products p\n      WHERE NOT EXISTS (\n        SELECT 1 FROM supplier_sync_stage_product_details d\n         WHERE d.run_id=?1 AND d.public_product_id=p.product_id\n      )\n      AND NOT EXISTS (\n        SELECT 1 FROM supplier_sync_stage_events e\n        JOIN supplier_sync_stage_runs r ON r.run_id=e.run_id\n         WHERE e.run_id=?1 AND e.public_product_id=p.product_id AND e.event_type='REMOVED'\n           AND NOT EXISTS (\n             SELECT 1 FROM supplier_scope_memberships sm\n              WHERE sm.tenant_id=r.tenant_id AND sm.public_product_id=p.product_id\n                AND sm.scope_id<>r.scope_id AND sm.state IN ('active','missing')\n           )\n      ))\n    + (SELECT COUNT(*) FROM supplier_sync_stage_product_details d\n        WHERE d.run_id=?1 AND d.detail_state='complete')\n  )\`;\n}`;
  source = source.slice(0, composedStart) + composedReplacement + source.slice(composedEnd + 2);
  source = source.replaceAll('${composedProductCountSql()}', '${composedProductCountSql(context)}');

  source = replaceOnce(
    source,
    'function overrideMismatchSql() {\n  return `EXISTS (',
    "function overrideMismatchSql(context) {\n  const overrideRelation = Number(context?.schemaVersion || 0) >= 8\n    ? 'catalog_product_effective_classification_overrides'\n    : 'catalog_product_classification_overrides';\n  return `EXISTS (",
    'promotion-override-relation'
  );
  source = source.replaceAll(
    'LEFT JOIN catalog_product_effective_classification_overrides o',
    'LEFT JOIN ${overrideRelation} o'
  );
  source = source.replaceAll('${overrideMismatchSql()}', '${overrideMismatchSql(context)}');

  const preflightOld = `    {\n      sql: \`SELECT COUNT(*) AS total FROM supplier_sync_stage_events\n             WHERE run_id=?1 AND event_type IN ('MISSING','REMOVED')\`,\n      params: [context.importId]\n    },\n    { sql: \`SELECT CASE WHEN \${removalPolicyGateSql()} THEN 1 ELSE 0 END AS total\`, params },\n    {`;
  const preflightNew = `    {\n      sql: \`SELECT COUNT(*) AS total FROM supplier_sync_stage_events\n             WHERE run_id=?1 AND event_type IN ('MISSING','REMOVED')\`,\n      params: [context.importId]\n    },\n    ...(Number(context.schemaVersion || 0) >= 8\n      ? [{ sql: \`SELECT CASE WHEN \${removalPolicyGateSql()} THEN 1 ELSE 0 END AS total\`, params }]\n      : []),\n    {`;
  source = replaceOnce(source, preflightOld, preflightNew, 'promotion-conditional-policy-preflight');

  source = replaceOnce(
    source,
    `export function parseIncrementalPromotionPreflight(result) {\n  return Object.freeze({\n    run: resultRows(result?.[0])[0] || null,\n    composedProducts: Number(resultRows(result?.[1])[0]?.total || 0),\n    composedMediaRelationships: Number(resultRows(result?.[2])[0]?.total || 0),\n    absenceEvents: Number(resultRows(result?.[3])[0]?.total || 0),\n    removalPolicyValid: Number(resultRows(result?.[4])[0]?.total || 0),\n    overrideMismatches: Number(resultRows(result?.[5])[0]?.total || 0),\n    publicLeakFindings: Number(resultRows(result?.[6])[0]?.total || 0)\n  });\n}`,
    `export function parseIncrementalPromotionPreflight(result) {\n  const hasRemovalPolicyProbe = Array.isArray(result) && result.length >= 7;\n  const overrideIndex = hasRemovalPolicyProbe ? 5 : 4;\n  const leakIndex = hasRemovalPolicyProbe ? 6 : 5;\n  return Object.freeze({\n    run: resultRows(result?.[0])[0] || null,\n    composedProducts: Number(resultRows(result?.[1])[0]?.total || 0),\n    composedMediaRelationships: Number(resultRows(result?.[2])[0]?.total || 0),\n    absenceEvents: Number(resultRows(result?.[3])[0]?.total || 0),\n    removalPolicyValid: hasRemovalPolicyProbe\n      ? Number(resultRows(result?.[4])[0]?.total || 0)\n      : 0,\n    overrideMismatches: Number(resultRows(result?.[overrideIndex])[0]?.total || 0),\n    publicLeakFindings: Number(resultRows(result?.[leakIndex])[0]?.total || 0)\n  });\n}`,
    'promotion-preflight-parser-dual-schema'
  );

  source = replaceOnce(
    source,
    `  if (Number(preflight.removalPolicyValid || 0) !== 1) {\n    return { allowed: false, code: 'sync_promotion_removal_policy_invalid' };\n  }`,
    `  if (preflight.absenceEvents > 0 && Number(context.schemaVersion || 0) < 8) {\n    return { allowed: false, code: 'sync_promotion_removal_schema_not_ready' };\n  }\n  if (preflight.absenceEvents > 0 && Number(preflight.removalPolicyValid || 0) !== 1) {\n    return { allowed: false, code: 'sync_promotion_removal_policy_invalid' };\n  }`,
    'promotion-policy-only-for-absence'
  );

  source = replaceOnce(
    source,
    `  const params = [context.importId, context.tenantId, context.sourceKey];\n  const gate = exactPromotingGate();\n  const statements = [`,
    `  const params = [context.importId, context.tenantId, context.sourceKey];\n  const gate = exactPromotingGate();\n  const removalGate = Number(context.schemaVersion || 0) >= 8 ? removalPolicyGateSql() : '1=1';\n  const statements = [`,
    'promotion-removal-gate-variable'
  );
  source = source.replace('               AND ${removalPolicyGateSql()}\n', '               AND ${removalGate}\n');

  source = replaceOnce(
    source,
    `  validatePromotionTransactionShape(statements);\n  return Object.freeze(statements.map((statement) => Object.freeze(statement)));`,
    `  const activeStatements =\n    Number(context.schemaVersion || 0) >= 8\n      ? statements\n      : statements.filter(\n          (statement) =>\n            !/supplier_scope_memberships|catalog_product_classification_override_retention/.test(\n              String(statement.sql || '')\n            )\n        );\n  validatePromotionTransactionShape(activeStatements);\n  return Object.freeze(activeStatements.map((statement) => Object.freeze(statement)));`,
    'promotion-filter-v8-statements'
  );
  await write(path, source);
}

console.log(JSON.stringify({ m7d9CompatibilityCorrectionApplied: true }));
