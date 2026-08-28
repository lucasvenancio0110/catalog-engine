import { readFile, writeFile } from 'node:fs/promises';

async function read(path) {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

async function write(path, value) {
  await writeFile(new URL(`../${path}`, import.meta.url), value, 'utf8');
}

function replaceOnce(source, from, to, label) {
  const first = source.indexOf(from);
  if (first < 0) throw new Error(`m7d9_patch_missing:${label}`);
  if (source.indexOf(from, first + from.length) >= 0) throw new Error(`m7d9_patch_ambiguous:${label}`);
  return source.slice(0, first) + to + source.slice(first + from.length);
}

function replaceAllRequired(source, from, to, label, minimum = 1) {
  const count = source.split(from).length - 1;
  if (count < minimum) throw new Error(`m7d9_patch_missing:${label}:${count}`);
  return source.split(from).join(to);
}

// Stage owns an immutable removal-policy snapshot per run.
{
  const path = 'worker/ingestion/incremental-stage.js';
  let source = await read(path);
  source = replaceOnce(
    source,
    "    !Array.isArray(plan.events) ||\n    !Array.isArray(plan.detailQueue)\n",
    "    !Array.isArray(plan.events) ||\n    !Array.isArray(plan.detailQueue) ||\n    !plan.removalPolicy ||\n    !text(plan.removalPolicy.scopeId) ||\n    !text(plan.removalPolicy.scopeKind) ||\n    Number(plan.removalPolicy.removalThreshold || 0) < 2\n",
    'stage-input-removal-policy'
  );
  const authorityMarker = `function clearStageQuery(table, context) {`;
  const policyFunctions = `function beginStageRemovalPolicyQuery(context, plan) {\n  const policy = plan.removalPolicy;\n  return {\n    sql: \`INSERT OR IGNORE INTO supplier_sync_stage_removal_policy\n      (run_id, tenant_id, source_key, scope_id, scope_kind, contract_version, policy_version,\n       removal_threshold, created_at, updated_at)\n      SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP\n       WHERE EXISTS (\n         SELECT 1 FROM supplier_sync_stage_runs r\n          WHERE r.run_id=?1 AND r.tenant_id=?2 AND r.source_key=?3 AND r.state='staging'\n       )\`,\n    params: [\n      context.importId, context.tenantId, context.sourceKey, policy.scopeId, policy.scopeKind,\n      Number(policy.contractVersion), Number(policy.policyVersion), Number(policy.removalThreshold)\n    ]\n  };\n}\n\nfunction enforceRemovalPolicySnapshotQuery(context, plan) {\n  const policy = plan.removalPolicy;\n  return {\n    sql: \`UPDATE supplier_sync_stage_runs\n             SET state='failed', last_error_code='sync_removal_policy_snapshot_mismatch',\n                 updated_at=CURRENT_TIMESTAMP\n           WHERE run_id=?1 AND tenant_id=?2 AND source_key=?3\n             AND state IN ('planned','details_pending')\n             AND NOT EXISTS (\n               SELECT 1 FROM supplier_sync_stage_removal_policy p\n                WHERE p.run_id=?1 AND p.tenant_id=?2 AND p.source_key=?3\n                  AND p.scope_id=?4 AND p.scope_kind=?5\n                  AND p.contract_version=CAST(?6 AS INTEGER)\n                  AND p.policy_version=CAST(?7 AS INTEGER)\n                  AND p.removal_threshold=CAST(?8 AS INTEGER)\n             )\`,\n    params: [\n      context.importId, context.tenantId, context.sourceKey, policy.scopeId, policy.scopeKind,\n      Number(policy.contractVersion), Number(policy.policyVersion), Number(policy.removalThreshold)\n    ]\n  };\n}\n\n`;
  source = replaceOnce(source, authorityMarker, policyFunctions + authorityMarker, 'stage-policy-functions');
  source = replaceOnce(
    source,
    `      beginStageAuthorityQuery(context),\n      clearStageQuery('supplier_sync_stage_observations', context),`,
    `      beginStageAuthorityQuery(context),\n      beginStageRemovalPolicyQuery(context, plan),\n      clearStageQuery('supplier_sync_stage_observations', context),`,
    'stage-policy-begin'
  );
  source = replaceOnce(
    source,
    `      sealStageQuery(context, planWithTaxonomy),\n      sealSyncRunQuery(context)`,
    `      sealStageQuery(context, planWithTaxonomy),\n      enforceRemovalPolicySnapshotQuery(context, plan),\n      sealSyncRunQuery(context)`,
    'stage-policy-seal'
  );
  await write(path, source);
}

// D9 state is schema-v8 only; older tenants remain LKG-serving until additive fleet migration completes.
for (const path of [
  'worker/ingestion/incremental-scan-consumer.js',
  'worker/ingestion/incremental-detail-consumer.js',
  'worker/ingestion/incremental-classification-runner.js',
  'worker/ingestion/incremental-verification-runner.js',
  'worker/ingestion/incremental-finalization-runner.js'
]) {
  let source = await read(path);
  source = source.replaceAll('schema_version >= 6', 'schema_version >= 8');
  source = source.replaceAll('schema_version>=7', 'schema_version>=8');
  source = source.replaceAll('schema_version >= 7', 'schema_version >= 8');
  source = source.replaceAll('schemaVersion < 6', 'schemaVersion < 8');
  source = source.replaceAll('schemaVersion < 7', 'schemaVersion < 8');
  source = source.replaceAll('MIN_INCREMENTAL_STAGE_SCHEMA_VERSION = 7', 'MIN_INCREMENTAL_STAGE_SCHEMA_VERSION = 8');
  source = source.replaceAll('MIN_INCREMENTAL_DETAIL_SCHEMA_VERSION = 7', 'MIN_INCREMENTAL_DETAIL_SCHEMA_VERSION = 8');
  await write(path, source);
}

// Removed products may still have a retained merchant override; classification and verification read the effective view.
for (const path of [
  'worker/ingestion/incremental-classification-runner.js',
  'worker/ingestion/incremental-verification-runner.js'
]) {
  let source = await read(path);
  source = source.replaceAll(
    'catalog_product_classification_overrides override',
    'catalog_product_effective_classification_overrides override'
  );
  source = source.replaceAll(
    'catalog_product_classification_overrides o',
    'catalog_product_effective_classification_overrides o'
  );
  await write(path, source);
}

// Verification treats REMOVED as global only when no other non-detached membership remains.
{
  const path = 'worker/ingestion/incremental-verification-runner.js';
  let source = await read(path);
  const rawRemovedCondition = `e.needs_detail=1 OR e.event_type='REMOVED'`;
  const safeRemovedCondition = `e.needs_detail=1 OR (e.event_type='REMOVED' AND NOT EXISTS (\n                      SELECT 1 FROM supplier_scope_memberships sm\n                      JOIN supplier_sync_stage_runs sr ON sr.run_id=e.run_id\n                     WHERE sm.tenant_id=sr.tenant_id\n                       AND sm.public_product_id=e.public_product_id\n                       AND sm.scope_id<>sr.scope_id\n                       AND sm.state IN ('active','missing')\n                    ))`;
  source = replaceAllRequired(source, rawRemovedCondition, safeRemovedCondition, 'verification-global-removal', 2);

  const absenceOld = `['absenceSemantics', \`SELECT COUNT(*) AS total\n       FROM supplier_sync_stage_events\n      WHERE run_id=?1 AND event_type IN ('MISSING','REMOVED')\n        AND (needs_detail<>0 OR next_miss_count IS NULL OR next_miss_count<1\n             OR COALESCE(reason_code,'')<>'sync_not_observed_authoritative')\`, [runId]],`;
  const absenceNew = `['absenceSemantics', \`SELECT COUNT(*) AS total\n       FROM supplier_sync_stage_events e\n       LEFT JOIN supplier_sync_stage_removal_policy p ON p.run_id=e.run_id\n      WHERE e.run_id=?1 AND e.event_type IN ('MISSING','REMOVED')\n        AND (e.needs_detail<>0 OR e.next_miss_count IS NULL OR e.next_miss_count<1\n             OR COALESCE(e.reason_code,'')<>'sync_not_observed_authoritative'\n             OR p.run_id IS NULL\n             OR (e.event_type='MISSING' AND e.next_miss_count>=p.removal_threshold)\n             OR (e.event_type='REMOVED' AND e.next_miss_count<p.removal_threshold))\`, [runId]],\n    ['removalPolicyValid', \`SELECT COUNT(*) AS total\n       FROM supplier_sync_stage_removal_policy p\n       JOIN supplier_sync_stage_runs r ON r.run_id=p.run_id\n      WHERE p.run_id=?1 AND p.tenant_id=?2 AND p.source_key=?3\n        AND p.scope_id=r.scope_id AND p.scope_kind=r.scope_kind\n        AND p.contract_version=1 AND p.policy_version=1 AND p.removal_threshold>=2\`,\n      [runId, tenantId, sourceKey]],`;
  source = replaceOnce(source, absenceOld, absenceNew, 'verification-absence-policy');

  const blockersEnd = `  for (const [metric, code] of blockingMetricCodes) {\n    if (Number(metrics[metric] || 0) > 0) findings.push(code);\n  }\n`;
  source = replaceOnce(
    source,
    blockersEnd,
    blockersEnd + `  if (Number(metrics.removalPolicyValid || 0) !== 1) findings.push('removal_policy_invalid');\n`,
    'verification-policy-finding'
  );

  const proposedOld = `- (SELECT COUNT(*) FROM catalog_products p WHERE EXISTS (\n           SELECT 1 FROM supplier_sync_stage_events e\n            WHERE e.run_id=?1 AND e.public_product_id=p.product_id AND e.event_type='REMOVED'\n              AND e.needs_detail=0\n         ))`;
  const proposedNew = `- (SELECT COUNT(*) FROM catalog_products p WHERE EXISTS (\n           SELECT 1 FROM supplier_sync_stage_events e\n           JOIN supplier_sync_stage_runs sr ON sr.run_id=e.run_id\n            WHERE e.run_id=?1 AND e.public_product_id=p.product_id AND e.event_type='REMOVED'\n              AND e.needs_detail=0\n              AND NOT EXISTS (\n                SELECT 1 FROM supplier_scope_memberships sm\n                 WHERE sm.tenant_id=sr.tenant_id\n                   AND sm.public_product_id=e.public_product_id\n                   AND sm.scope_id<>sr.scope_id\n                   AND sm.state IN ('active','missing')\n              )\n         ))`;
  source = replaceOnce(source, proposedOld, proposedNew, 'verification-proposed-products');
  await write(path, source);
}

// Promotion admits verified absence events only under the exact snapshotted policy, then applies
// membership progression/removal/restoration inside the same serving-authority transaction.
{
  const path = 'worker/ingestion/incremental-promotion.js';
  let source = await read(path);
  source = replaceOnce(source, 'Number(context.schemaVersion || 0) < 7', 'Number(context.schemaVersion || 0) < 8', 'promotion-schema');
  source = source.replaceAll(
    'catalog_product_classification_overrides o',
    'catalog_product_effective_classification_overrides o'
  );

  const oldComposed = `function composedProductCountSql() {\n  return \`(\n    (SELECT COUNT(*) FROM catalog_products p\n      WHERE NOT EXISTS (\n        SELECT 1 FROM supplier_sync_stage_product_details d\n         WHERE d.run_id=?1 AND d.public_product_id=p.product_id\n      ))\n    + (SELECT COUNT(*) FROM supplier_sync_stage_product_details d\n        WHERE d.run_id=?1 AND d.detail_state='complete')\n  )\`;\n}`;
  const newComposed = `function composedProductCountSql() {\n  return \`(\n    (SELECT COUNT(*) FROM catalog_products p\n      WHERE NOT EXISTS (\n        SELECT 1 FROM supplier_sync_stage_product_details d\n         WHERE d.run_id=?1 AND d.public_product_id=p.product_id\n      )\n      AND NOT EXISTS (\n        SELECT 1 FROM supplier_sync_stage_events e\n        JOIN supplier_sync_stage_runs r ON r.run_id=e.run_id\n         WHERE e.run_id=?1 AND e.public_product_id=p.product_id AND e.event_type='REMOVED'\n           AND NOT EXISTS (\n             SELECT 1 FROM supplier_scope_memberships sm\n              WHERE sm.tenant_id=r.tenant_id AND sm.public_product_id=p.product_id\n                AND sm.scope_id<>r.scope_id AND sm.state IN ('active','missing')\n           )\n      ))\n    + (SELECT COUNT(*) FROM supplier_sync_stage_product_details d\n        WHERE d.run_id=?1 AND d.detail_state='complete')\n  )\`;\n}`;
  source = replaceOnce(source, oldComposed, newComposed, 'promotion-composed-product');

  const absenceFunction = `function absenceEventSql() {\n  return \`EXISTS (\n    SELECT 1 FROM supplier_sync_stage_events e\n     WHERE e.run_id=?1 AND e.event_type IN ('MISSING','REMOVED')\n  )\`;\n}`;
  const policyFunction = `function removalPolicyGateSql() {\n  return \`EXISTS (\n    SELECT 1\n      FROM supplier_sync_stage_runs r\n      JOIN supplier_sync_stage_removal_policy p\n        ON p.run_id=r.run_id AND p.tenant_id=r.tenant_id AND p.source_key=r.source_key\n     WHERE r.run_id=?1 AND r.tenant_id=?2 AND r.source_key=?3\n       AND p.scope_id=r.scope_id AND p.scope_kind=r.scope_kind\n       AND p.contract_version=1 AND p.policy_version=1 AND p.removal_threshold>=2\n       AND NOT EXISTS (\n         SELECT 1 FROM supplier_sync_stage_events e\n          WHERE e.run_id=?1 AND e.event_type IN ('MISSING','REMOVED') AND (\n            e.needs_detail<>0 OR e.next_miss_count IS NULL OR e.next_miss_count<1\n            OR COALESCE(e.reason_code,'')<>'sync_not_observed_authoritative'\n            OR (e.event_type='MISSING' AND e.next_miss_count>=p.removal_threshold)\n            OR (e.event_type='REMOVED' AND e.next_miss_count<p.removal_threshold)\n          )\n       )\n  )\`;\n}`;
  source = replaceOnce(source, absenceFunction, policyFunction, 'promotion-policy-gate');

  const preflightAbsence = `    {\n      sql: \`SELECT COUNT(*) AS total FROM supplier_sync_stage_events\n             WHERE run_id=?1 AND event_type IN ('MISSING','REMOVED')\`,\n      params: [context.importId]\n    },\n`;
  source = replaceOnce(
    source,
    preflightAbsence,
    preflightAbsence + `    { sql: \`SELECT CASE WHEN \${removalPolicyGateSql()} THEN 1 ELSE 0 END AS total\`, params },\n`,
    'promotion-preflight-policy'
  );
  source = replaceOnce(
    source,
    `    absenceEvents: Number(resultRows(result?.[3])[0]?.total || 0),\n    overrideMismatches: Number(resultRows(result?.[4])[0]?.total || 0),\n    publicLeakFindings: Number(resultRows(result?.[5])[0]?.total || 0)`,
    `    absenceEvents: Number(resultRows(result?.[3])[0]?.total || 0),\n    removalPolicyValid: Number(resultRows(result?.[4])[0]?.total || 0),\n    overrideMismatches: Number(resultRows(result?.[5])[0]?.total || 0),\n    publicLeakFindings: Number(resultRows(result?.[6])[0]?.total || 0)`,
    'promotion-preflight-parse'
  );
  source = replaceOnce(
    source,
    `  if (preflight.absenceEvents > 0) {\n    return { allowed: false, code: 'sync_promotion_removal_not_ready' };\n  }`,
    `  if (Number(preflight.removalPolicyValid || 0) !== 1) {\n    return { allowed: false, code: 'sync_promotion_removal_policy_invalid' };\n  }`,
    'promotion-removal-admission'
  );
  source = replaceOnce(
    source,
    `               AND NOT \${absenceEventSql()}\n               AND NOT \${overrideMismatchSql()}`,
    `               AND \${removalPolicyGateSql()}\n               AND NOT \${overrideMismatchSql()}`,
    'promotion-transaction-policy'
  );

  const categoryMarker = `    {\n      sql: \`INSERT INTO catalog_categories`;
  const membershipStatements = `    {\n      sql: \`INSERT INTO supplier_scope_memberships\n              (tenant_id,source_key,scope_id,scope_kind,album_source_id,public_product_id,\n               contract_version,removal_policy_version,removal_threshold,state,miss_count,\n               last_observed_run_id,last_progress_run_id,detached_at,updated_at)\n            SELECT r.tenant_id,r.source_key,r.scope_id,r.scope_kind,o.album_source_id,o.public_product_id,\n                   p.contract_version,p.policy_version,p.removal_threshold,'active',0,?1,?1,NULL,CURRENT_TIMESTAMP\n              FROM supplier_sync_stage_observations o\n              JOIN supplier_sync_stage_runs r ON r.run_id=o.run_id\n              JOIN supplier_sync_stage_removal_policy p ON p.run_id=r.run_id\n             WHERE o.run_id=?1 AND \${gate}\n            ON CONFLICT(tenant_id,source_key,scope_id,album_source_id) DO UPDATE SET\n              public_product_id=excluded.public_product_id,scope_kind=excluded.scope_kind,\n              contract_version=excluded.contract_version,\n              removal_policy_version=excluded.removal_policy_version,\n              removal_threshold=excluded.removal_threshold,state='active',miss_count=0,\n              last_observed_run_id=?1,last_progress_run_id=?1,detached_at=NULL,updated_at=CURRENT_TIMESTAMP\`,\n      params\n    },\n    {\n      sql: \`INSERT INTO supplier_scope_memberships\n              (tenant_id,source_key,scope_id,scope_kind,album_source_id,public_product_id,\n               contract_version,removal_policy_version,removal_threshold,state,miss_count,\n               last_progress_run_id,detached_at,updated_at)\n            SELECT r.tenant_id,r.source_key,r.scope_id,r.scope_kind,e.album_source_id,e.public_product_id,\n                   p.contract_version,p.policy_version,p.removal_threshold,\n                   CASE WHEN e.event_type='REMOVED' THEN 'detached' ELSE 'missing' END,\n                   e.next_miss_count,?1,\n                   CASE WHEN e.event_type='REMOVED' THEN CURRENT_TIMESTAMP ELSE NULL END,CURRENT_TIMESTAMP\n              FROM supplier_sync_stage_events e\n              JOIN supplier_sync_stage_runs r ON r.run_id=e.run_id\n              JOIN supplier_sync_stage_removal_policy p ON p.run_id=r.run_id\n             WHERE e.run_id=?1 AND e.event_type IN ('MISSING','REMOVED') AND \${gate}\n            ON CONFLICT(tenant_id,source_key,scope_id,album_source_id) DO UPDATE SET\n              public_product_id=excluded.public_product_id,scope_kind=excluded.scope_kind,\n              contract_version=excluded.contract_version,\n              removal_policy_version=excluded.removal_policy_version,\n              removal_threshold=excluded.removal_threshold,state=excluded.state,\n              miss_count=excluded.miss_count,last_progress_run_id=?1,\n              detached_at=excluded.detached_at,updated_at=CURRENT_TIMESTAMP\`,\n      params\n    },\n    {\n      sql: \`UPDATE supplier_album_index\n               SET status=CASE\n                     WHEN EXISTS (\n                       SELECT 1 FROM supplier_scope_memberships sm\n                        WHERE sm.tenant_id=?2 AND sm.public_product_id=supplier_album_index.public_product_id\n                          AND sm.state='active'\n                     ) THEN 'active'\n                     WHEN EXISTS (\n                       SELECT 1 FROM supplier_scope_memberships sm\n                        WHERE sm.tenant_id=?2 AND sm.public_product_id=supplier_album_index.public_product_id\n                          AND sm.state='missing'\n                     ) THEN 'missing'\n                     ELSE 'deleted'\n                   END,\n                   miss_count=COALESCE((\n                     SELECT MAX(sm.miss_count) FROM supplier_scope_memberships sm\n                      WHERE sm.tenant_id=?2 AND sm.public_product_id=supplier_album_index.public_product_id\n                   ),0),\n                   updated_at=CURRENT_TIMESTAMP\n             WHERE tenant_id=?2 AND source_key=?3 AND \${gate}\n               AND EXISTS (\n                 SELECT 1 FROM supplier_sync_stage_events e\n                  WHERE e.run_id=?1 AND e.album_source_id=supplier_album_index.album_source_id\n                    AND e.event_type IN ('MISSING','REMOVED')\n               )\`,\n      params\n    },\n`;
  source = replaceOnce(source, categoryMarker, membershipStatements + categoryMarker, 'promotion-memberships');

  const productMediaMarker = `    {\n      sql: \`DELETE FROM product_media`;
  const removalStatements = `    {\n      sql: \`INSERT INTO catalog_product_classification_override_retention\n              (product_id,override_json,override_version,original_created_at,original_updated_at,\n               retained_by_run_id,retained_at,updated_at)\n            SELECT o.product_id,o.override_json,o.override_version,o.created_at,o.updated_at,\n                   ?1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP\n              FROM catalog_product_classification_overrides o\n              JOIN supplier_sync_stage_events e ON e.public_product_id=o.product_id\n              JOIN supplier_sync_stage_runs r ON r.run_id=e.run_id\n             WHERE e.run_id=?1 AND e.event_type='REMOVED' AND \${gate}\n               AND NOT EXISTS (\n                 SELECT 1 FROM supplier_scope_memberships sm\n                  WHERE sm.tenant_id=r.tenant_id AND sm.public_product_id=e.public_product_id\n                    AND sm.state IN ('active','missing')\n               )\n            ON CONFLICT(product_id) DO UPDATE SET\n              override_json=excluded.override_json,override_version=excluded.override_version,\n              original_created_at=excluded.original_created_at,\n              original_updated_at=excluded.original_updated_at,\n              retained_by_run_id=excluded.retained_by_run_id,retained_at=CURRENT_TIMESTAMP,\n              updated_at=CURRENT_TIMESTAMP\`,\n      params\n    },\n    {\n      sql: \`DELETE FROM catalog_products\n             WHERE \${gate}\n               AND EXISTS (\n                 SELECT 1 FROM supplier_sync_stage_events e\n                 JOIN supplier_sync_stage_runs r ON r.run_id=e.run_id\n                  WHERE e.run_id=?1 AND e.event_type='REMOVED'\n                    AND e.public_product_id=catalog_products.product_id\n                    AND NOT EXISTS (\n                      SELECT 1 FROM supplier_scope_memberships sm\n                       WHERE sm.tenant_id=r.tenant_id\n                         AND sm.public_product_id=e.public_product_id\n                         AND sm.state IN ('active','missing')\n                    )\n               )\`,\n      params\n    },\n    {\n      sql: \`INSERT INTO catalog_product_classification_overrides\n              (product_id,override_json,override_version,created_at,updated_at)\n            SELECT r.product_id,r.override_json,r.override_version,r.original_created_at,r.original_updated_at\n              FROM catalog_product_classification_override_retention r\n             WHERE \${gate}\n               AND EXISTS (SELECT 1 FROM catalog_products p WHERE p.product_id=r.product_id)\n               AND EXISTS (\n                 SELECT 1 FROM supplier_sync_stage_events e\n                  WHERE e.run_id=?1 AND e.public_product_id=r.product_id AND e.event_type='RESTORED'\n               )\n            ON CONFLICT(product_id) DO UPDATE SET\n              override_json=excluded.override_json,override_version=excluded.override_version,\n              updated_at=excluded.updated_at\n              WHERE excluded.override_version>=catalog_product_classification_overrides.override_version\`,\n      params\n    },\n    {\n      sql: \`DELETE FROM catalog_product_classification_override_retention\n             WHERE \${gate}\n               AND EXISTS (\n                 SELECT 1 FROM supplier_sync_stage_events e\n                  WHERE e.run_id=?1 AND e.public_product_id=catalog_product_classification_override_retention.product_id\n                    AND e.event_type='RESTORED'\n               )\n               AND EXISTS (\n                 SELECT 1 FROM catalog_product_classification_overrides o\n                  WHERE o.product_id=catalog_product_classification_override_retention.product_id\n                    AND o.override_version>=catalog_product_classification_override_retention.override_version\n               )\`,\n      params\n    },\n`;
  source = replaceOnce(source, productMediaMarker, removalStatements + productMediaMarker, 'promotion-removal-statements');
  await write(path, source);
}

// Schema v8 becomes the current isolated-tenant migration target/capability.
{
  const path = 'worker/tenant-data-plane-command.js';
  let source = await read(path);
  source = replaceOnce(
    source,
    `import {\n  TENANT_DATA_PLANE_SCHEMA_VERSION as CURRENT_TENANT_DATA_PLANE_SCHEMA_VERSION,\n  TENANT_DATA_PLANE_V7_STATEMENTS\n} from './tenant-data-plane-schema-v7.js';`,
    `import { TENANT_DATA_PLANE_V7_STATEMENTS } from './tenant-data-plane-schema-v7.js';\nimport {\n  TENANT_DATA_PLANE_SCHEMA_VERSION as CURRENT_TENANT_DATA_PLANE_SCHEMA_VERSION,\n  TENANT_DATA_PLANE_V8_STATEMENTS\n} from './tenant-data-plane-schema-v8.js';`,
    'command-v8-import'
  );
  source = replaceOnce(source, 'TENANT_DATA_PLANE_MIGRATION_COMMAND_VERSION = 3', 'TENANT_DATA_PLANE_MIGRATION_COMMAND_VERSION = 4', 'command-version');
  source = replaceOnce(
    source,
    `  6: TENANT_DATA_PLANE_V6_STATEMENTS,\n  7: TENANT_DATA_PLANE_V7_STATEMENTS\n`,
    `  6: TENANT_DATA_PLANE_V6_STATEMENTS,\n  7: TENANT_DATA_PLANE_V7_STATEMENTS,\n  8: TENANT_DATA_PLANE_V8_STATEMENTS\n`,
    'command-v8-map'
  );
  await write(path, source);
}

for (const path of [
  'worker/data-plane-migration-runner.js',
  'scripts/emit-tenant-data-plane-schema.mjs',
  'scripts/cloudflare-tenant-data-plane-fleet-prepare.mjs'
]) {
  let source = await read(path);
  source = source.replaceAll("./tenant-data-plane-schema-v7.js", "./tenant-data-plane-schema-v8.js");
  source = source.replaceAll("../worker/tenant-data-plane-schema-v7.js", "../worker/tenant-data-plane-schema-v8.js");
  await write(path, source);
}

console.log(JSON.stringify({ m7d9IntegrationApplied: true }));
