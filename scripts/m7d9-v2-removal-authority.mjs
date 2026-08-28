import { readFile, writeFile } from 'node:fs/promises';

async function read(path) {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}
async function write(path, value) {
  await writeFile(new URL(`../${path}`, import.meta.url), value, 'utf8');
}
function replaceOnce(source, from, to, label) {
  const first = source.indexOf(from);
  if (first < 0) throw new Error(`m7d9_v2_authority_missing:${label}`);
  if (source.indexOf(from, first + from.length) >= 0) {
    throw new Error(`m7d9_v2_authority_ambiguous:${label}`);
  }
  return source.slice(0, first) + to + source.slice(first + from.length);
}
function replaceAllRequired(source, from, to, label, minimum = 1) {
  const count = source.split(from).length - 1;
  if (count < minimum) throw new Error(`m7d9_v2_authority_missing:${label}:${count}`);
  return source.split(from).join(to);
}

// Verification composes global removals only when the exact scope is the final live membership.
{
  const path = 'worker/ingestion/incremental-verification-runner.js';
  let source = await read(path);
  source = replaceOnce(
    source,
    `function tenantRequest(context, platform, batch, queryBatch, fetchImpl) {\n  return queryBatch(\n    {\n      ...platform,\n      tenantId: context.tenantId,\n      databaseId: context.dataPlane.databaseId,\n      batch\n    },\n    { fetchImpl }\n  );\n}\n`,
    `function tenantRequest(context, platform, batch, queryBatch, fetchImpl) {\n  return queryBatch(\n    {\n      ...platform,\n      tenantId: context.tenantId,\n      databaseId: context.dataPlane.databaseId,\n      batch\n    },\n    { fetchImpl }\n  );\n}\n\nfunction globalRemovalEventSql(context, alias = 'e') {\n  if (Number(context?.schemaVersion || 0) < 8) return \`\${alias}.event_type='REMOVED'\`;\n  return \`(\${alias}.event_type='REMOVED' AND NOT EXISTS (\n    SELECT 1 FROM supplier_scope_memberships sm\n    JOIN supplier_sync_stage_runs sr ON sr.run_id=\${alias}.run_id\n     WHERE sm.tenant_id=sr.tenant_id\n       AND sm.public_product_id=\${alias}.public_product_id\n       AND sm.scope_id<>sr.scope_id\n       AND sm.state IN ('active','missing')\n  ))\`;\n}\n`,
    'verification-global-removal-helper'
  );
  source = replaceOnce(
    source,
    `async function persistProposedMerchandising(context, platform, queryBatch, fetchImpl) {\n  const result = await tenantRequest(`,
    `async function persistProposedMerchandising(context, platform, queryBatch, fetchImpl) {\n  const globalRemoval = globalRemovalEventSql(context);\n  const result = await tenantRequest(`,
    'verification-merchandising-removal-setup'
  );
  source = replaceAllRequired(
    source,
    `(e.needs_detail=1 OR e.event_type='REMOVED')`,
    `(e.needs_detail=1 OR \${globalRemoval})`,
    'verification-merchandising-removal',
    2
  );
  source = replaceOnce(
    source,
    `function metricSpecs(context) {\n  const runId = context.importId;\n  const tenantId = context.tenantId;\n  const sourceKey = context.sourceKey;`,
    `function metricSpecs(context) {\n  const runId = context.importId;\n  const tenantId = context.tenantId;\n  const sourceKey = context.sourceKey;\n  const removalSchema = Number(context.schemaVersion || 0) >= 8;\n  const overrideRelation = removalSchema\n    ? 'catalog_product_effective_classification_overrides'\n    : 'catalog_product_classification_overrides';\n  const globalRemoval = globalRemovalEventSql(context);`,
    'verification-metric-removal-setup'
  );
  source = replaceOnce(
    source,
    `    ['absenceSemantics', \`SELECT COUNT(*) AS total\n       FROM supplier_sync_stage_events\n      WHERE run_id=?1 AND event_type IN ('MISSING','REMOVED')\n        AND (needs_detail<>0 OR next_miss_count IS NULL OR next_miss_count<1\n             OR COALESCE(reason_code,'')<>'sync_not_observed_authoritative')\`, [runId]],`,
    `    ['absenceSemantics', \`SELECT COUNT(*) AS total\n       FROM supplier_sync_stage_events\n      WHERE run_id=?1 AND event_type IN ('MISSING','REMOVED')\n        AND (needs_detail<>0 OR next_miss_count IS NULL OR next_miss_count<1\n             OR COALESCE(reason_code,'')<>'sync_not_observed_authoritative')\`, [runId]],\n    ...(removalSchema ? [\n      ['removalPolicyValid', \`SELECT COUNT(*) AS total\n         FROM supplier_sync_stage_removal_policy p\n         JOIN supplier_sync_stage_runs r ON r.run_id=p.run_id\n        WHERE p.run_id=?1 AND p.tenant_id=?2 AND p.source_key=?3\n          AND p.scope_id=r.scope_id AND p.scope_kind=r.scope_kind\n          AND p.contract_version=1 AND p.policy_version=1 AND p.removal_threshold>=2\`,\n        [runId, tenantId, sourceKey]],\n      ['removalSemantics', \`SELECT COUNT(*) AS total\n         FROM supplier_sync_stage_events e\n         JOIN supplier_sync_stage_removal_policy p ON p.run_id=e.run_id\n        WHERE e.run_id=?1 AND e.event_type IN ('MISSING','REMOVED') AND (\n          (e.event_type='MISSING' AND e.next_miss_count>=p.removal_threshold)\n          OR (e.event_type='REMOVED' AND e.next_miss_count<p.removal_threshold)\n        )\`, [runId]]\n    ] : []),`,
    'verification-removal-policy-metrics'
  );
  source = replaceOnce(
    source,
    `       LEFT JOIN catalog_product_classification_overrides o ON o.product_id=c.public_product_id`,
    `       LEFT JOIN \${overrideRelation} o ON o.product_id=c.public_product_id`,
    'verification-effective-override'
  );
  source = replaceOnce(
    source,
    `           AND (e.needs_detail=1 OR e.event_type='REMOVED')`,
    `           AND (e.needs_detail=1 OR \${globalRemoval})`,
    'verification-unchanged-global-removal'
  );
  source = replaceOnce(
    source,
    `            WHERE e.run_id=?1 AND e.public_product_id=p.product_id AND e.event_type='REMOVED'\n              AND e.needs_detail=0`,
    `            WHERE e.run_id=?1 AND e.public_product_id=p.product_id AND \${globalRemoval}\n              AND e.needs_detail=0`,
    'verification-proposed-global-removal'
  );
  source = replaceOnce(
    source,
    `    ['absenceSemantics', 'absence_semantics_invalid'],`,
    `    ['absenceSemantics', 'absence_semantics_invalid'],\n    ['removalSemantics', 'removal_semantics_invalid'],`,
    'verification-removal-blocker'
  );
  source = replaceOnce(
    source,
    `  for (const [metric, code] of blockingMetricCodes) {\n    if (Number(metrics[metric] || 0) > 0) findings.push(code);\n  }`,
    `  for (const [metric, code] of blockingMetricCodes) {\n    if (Number(metrics[metric] || 0) > 0) findings.push(code);\n  }\n  if (Object.hasOwn(metrics, 'removalPolicyValid') && Number(metrics.removalPolicyValid || 0) !== 1) {\n    findings.push('removal_policy_invalid');\n  }`,
    'verification-removal-policy-finding'
  );
  source = replaceOnce(
    source,
    `async function markVerified(context, platform, queryBatch, fetchImpl) {\n  const result = await tenantRequest(`,
    `async function markVerified(context, platform, queryBatch, fetchImpl) {\n  const removalPolicyGate = Number(context.schemaVersion || 0) >= 8\n    ? \`AND EXISTS (\n         SELECT 1 FROM supplier_sync_stage_removal_policy p\n         JOIN supplier_sync_stage_runs rr ON rr.run_id=p.run_id\n        WHERE p.run_id=?1 AND p.tenant_id=?2 AND p.source_key=?3\n          AND p.scope_id=rr.scope_id AND p.scope_kind=rr.scope_kind\n          AND p.contract_version=1 AND p.policy_version=1 AND p.removal_threshold>=2\n       )\`\n    : '';\n  const result = await tenantRequest(`,
    'verification-mark-policy-setup'
  );
  source = replaceOnce(
    source,
    `                 AND staged_event_count=expected_event_count\n                 AND (SELECT COUNT(*) FROM supplier_sync_stage_observations o WHERE o.run_id=?1)=observed_count`,
    `                 AND staged_event_count=expected_event_count\n                 \${removalPolicyGate}\n                 AND (SELECT COUNT(*) FROM supplier_sync_stage_observations o WHERE o.run_id=?1)=observed_count`,
    'verification-mark-policy-gate'
  );
  await write(path, source);
}

// Promotion is dual-path: v7 remains non-destructive; v8 owns scoped miss progression and safe detach/removal.
{
  const path = 'worker/ingestion/incremental-promotion.js';
  let source = await read(path);
  const oldComposedProduct = `function composedProductCountSql() {\n  return \`(\n    (SELECT COUNT(*) FROM catalog_products p\n      WHERE NOT EXISTS (\n        SELECT 1 FROM supplier_sync_stage_product_details d\n         WHERE d.run_id=?1 AND d.public_product_id=p.product_id\n      ))\n    + (SELECT COUNT(*) FROM supplier_sync_stage_product_details d\n        WHERE d.run_id=?1 AND d.detail_state='complete')\n  )\`;\n}`;
  const newComposedProduct = `function composedProductCountSql(context) {\n  if (Number(context?.schemaVersion || 0) < 8) {\n    return \`(\n      (SELECT COUNT(*) FROM catalog_products p\n        WHERE NOT EXISTS (\n          SELECT 1 FROM supplier_sync_stage_product_details d\n           WHERE d.run_id=?1 AND d.public_product_id=p.product_id\n        ))\n      + (SELECT COUNT(*) FROM supplier_sync_stage_product_details d\n          WHERE d.run_id=?1 AND d.detail_state='complete')\n    )\`;\n  }\n  return \`(\n    (SELECT COUNT(*) FROM catalog_products p\n      WHERE NOT EXISTS (\n        SELECT 1 FROM supplier_sync_stage_product_details d\n         WHERE d.run_id=?1 AND d.public_product_id=p.product_id\n      )\n      AND NOT EXISTS (\n        SELECT 1 FROM supplier_sync_stage_events e\n        JOIN supplier_sync_stage_runs r ON r.run_id=e.run_id\n         WHERE e.run_id=?1 AND e.public_product_id=p.product_id AND e.event_type='REMOVED'\n           AND NOT EXISTS (\n             SELECT 1 FROM supplier_scope_memberships sm\n              WHERE sm.tenant_id=r.tenant_id AND sm.public_product_id=p.product_id\n                AND sm.scope_id<>r.scope_id AND sm.state IN ('active','missing')\n           )\n      ))\n    + (SELECT COUNT(*) FROM supplier_sync_stage_product_details d\n        WHERE d.run_id=?1 AND d.detail_state='complete')\n  )\`;\n}`;
  source = replaceOnce(source, oldComposedProduct, newComposedProduct, 'promotion-composed-products');

  const oldComposedMedia = `function composedMediaCountSql() {\n  return \`(\n    (SELECT COUNT(*) FROM product_media pm\n      WHERE NOT EXISTS (\n        SELECT 1 FROM supplier_sync_stage_product_details d\n         WHERE d.run_id=?1 AND d.public_product_id=pm.product_id\n      ))\n    + (SELECT COUNT(*) FROM supplier_sync_stage_product_media pm WHERE pm.run_id=?1)\n  )\`;\n}`;
  const newComposedMedia = `function composedMediaCountSql(context) {\n  if (Number(context?.schemaVersion || 0) < 8) {\n    return \`(\n      (SELECT COUNT(*) FROM product_media pm\n        WHERE NOT EXISTS (\n          SELECT 1 FROM supplier_sync_stage_product_details d\n           WHERE d.run_id=?1 AND d.public_product_id=pm.product_id\n        ))\n      + (SELECT COUNT(*) FROM supplier_sync_stage_product_media pm WHERE pm.run_id=?1)\n    )\`;\n  }\n  return \`(\n    (SELECT COUNT(*) FROM product_media pm\n      WHERE NOT EXISTS (\n        SELECT 1 FROM supplier_sync_stage_product_details d\n         WHERE d.run_id=?1 AND d.public_product_id=pm.product_id\n      )\n      AND NOT EXISTS (\n        SELECT 1 FROM supplier_sync_stage_events e\n        JOIN supplier_sync_stage_runs r ON r.run_id=e.run_id\n         WHERE e.run_id=?1 AND e.public_product_id=pm.product_id AND e.event_type='REMOVED'\n           AND NOT EXISTS (\n             SELECT 1 FROM supplier_scope_memberships sm\n              WHERE sm.tenant_id=r.tenant_id AND sm.public_product_id=pm.product_id\n                AND sm.scope_id<>r.scope_id AND sm.state IN ('active','missing')\n           )\n      ))\n    + (SELECT COUNT(*) FROM supplier_sync_stage_product_media pm WHERE pm.run_id=?1)\n  )\`;\n}`;
  source = replaceOnce(source, oldComposedMedia, newComposedMedia, 'promotion-composed-media');

  source = replaceOnce(
    source,
    `function overrideMismatchSql() {\n  return \`EXISTS (`,
    `function overrideMismatchSql(context) {\n  const overrideRelation = Number(context?.schemaVersion || 0) >= 8\n    ? 'catalog_product_effective_classification_overrides'\n    : 'catalog_product_classification_overrides';\n  return \`EXISTS (`,
    'promotion-override-helper'
  );
  source = replaceOnce(
    source,
    `      LEFT JOIN catalog_product_classification_overrides o ON o.product_id=c.public_product_id`,
    `      LEFT JOIN \${overrideRelation} o ON o.product_id=c.public_product_id`,
    'promotion-effective-override'
  );
  const absenceFunction = `function absenceEventSql() {\n  return \`EXISTS (\n    SELECT 1 FROM supplier_sync_stage_events e\n     WHERE e.run_id=?1 AND e.event_type IN ('MISSING','REMOVED')\n  )\`;\n}`;
  const policyFunction = `${absenceFunction}\n\nfunction removalPolicyGateSql() {\n  return \`EXISTS (\n    SELECT 1\n      FROM supplier_sync_stage_runs r\n      JOIN supplier_sync_stage_removal_policy p\n        ON p.run_id=r.run_id AND p.tenant_id=r.tenant_id AND p.source_key=r.source_key\n     WHERE r.run_id=?1 AND r.tenant_id=?2 AND r.source_key=?3\n       AND p.scope_id=r.scope_id AND p.scope_kind=r.scope_kind\n       AND p.contract_version=1 AND p.policy_version=1 AND p.removal_threshold>=2\n       AND NOT EXISTS (\n         SELECT 1 FROM supplier_sync_stage_events e\n          WHERE e.run_id=?1 AND e.event_type IN ('MISSING','REMOVED') AND (\n            e.needs_detail<>0 OR e.next_miss_count IS NULL OR e.next_miss_count<1\n            OR COALESCE(e.reason_code,'')<>'sync_not_observed_authoritative'\n            OR (e.event_type='MISSING' AND e.next_miss_count>=p.removal_threshold)\n            OR (e.event_type='REMOVED' AND e.next_miss_count<p.removal_threshold)\n          )\n       )\n  )\`;\n}`;
  source = replaceOnce(source, absenceFunction, policyFunction, 'promotion-removal-policy-helper');

  source = replaceOnce(
    source,
    `export function buildIncrementalPromotionPreflightBatch({ context }) {\n  assertContext(context);\n  const params = [context.importId, context.tenantId, context.sourceKey];\n  return Object.freeze([`,
    `export function buildIncrementalPromotionPreflightBatch({ context }) {\n  assertContext(context);\n  const params = [context.importId, context.tenantId, context.sourceKey];\n  const removalSchema = Number(context.schemaVersion || 0) >= 8;\n  return Object.freeze([`,
    'promotion-preflight-removal-setup'
  );
  source = replaceAllRequired(source, '${composedProductCountSql()}', '${composedProductCountSql(context)}', 'promotion-composed-product-call', 2);
  source = replaceAllRequired(source, '${composedMediaCountSql()}', '${composedMediaCountSql(context)}', 'promotion-composed-media-call', 2);
  source = replaceOnce(
    source,
    `    {\n      sql: \`SELECT COUNT(*) AS total FROM supplier_sync_stage_events\n             WHERE run_id=?1 AND event_type IN ('MISSING','REMOVED')\`,\n      params: [context.importId]\n    },\n    {\n      sql: \`SELECT COUNT(*) AS total\n              FROM supplier_sync_stage_classification_state c\n              LEFT JOIN catalog_product_classification_overrides o ON o.product_id=c.public_product_id\n             WHERE c.run_id=?1 AND (\n               c.override_applied<>CASE WHEN o.product_id IS NULL THEN 0 ELSE 1 END\n               OR (o.product_id IS NOT NULL AND (\n                 COALESCE(c.merchant_override_version,0)<>o.override_version\n                 OR COALESCE(c.merchant_override_updated_at,'')<>COALESCE(o.updated_at,'')\n               ))\n               OR (o.product_id IS NULL AND c.merchant_override_version IS NOT NULL)\n             )\`,\n      params: [context.importId]\n    },`,
    `    {\n      sql: \`SELECT COUNT(*) AS total FROM supplier_sync_stage_events\n             WHERE run_id=?1 AND event_type IN ('MISSING','REMOVED')\`,\n      params: [context.importId]\n    },\n    ...(removalSchema\n      ? [{ sql: \`SELECT CASE WHEN \${removalPolicyGateSql()} THEN 1 ELSE 0 END AS total\`, params }]\n      : []),\n    {\n      sql: \`SELECT CASE WHEN \${overrideMismatchSql(context)} THEN 1 ELSE 0 END AS total\`,\n      params: [context.importId]\n    },`,
    'promotion-preflight-policy-and-override'
  );
  source = replaceOnce(
    source,
    `export function parseIncrementalPromotionPreflight(result) {\n  return Object.freeze({\n    run: resultRows(result?.[0])[0] || null,\n    composedProducts: Number(resultRows(result?.[1])[0]?.total || 0),\n    composedMediaRelationships: Number(resultRows(result?.[2])[0]?.total || 0),\n    absenceEvents: Number(resultRows(result?.[3])[0]?.total || 0),\n    overrideMismatches: Number(resultRows(result?.[4])[0]?.total || 0),\n    publicLeakFindings: Number(resultRows(result?.[5])[0]?.total || 0)\n  });\n}`,
    `export function parseIncrementalPromotionPreflight(result) {\n  const hasRemovalPolicyProbe = Array.isArray(result) && result.length >= 7;\n  const overrideIndex = hasRemovalPolicyProbe ? 5 : 4;\n  const leakIndex = hasRemovalPolicyProbe ? 6 : 5;\n  return Object.freeze({\n    run: resultRows(result?.[0])[0] || null,\n    composedProducts: Number(resultRows(result?.[1])[0]?.total || 0),\n    composedMediaRelationships: Number(resultRows(result?.[2])[0]?.total || 0),\n    absenceEvents: Number(resultRows(result?.[3])[0]?.total || 0),\n    removalPolicyValid: hasRemovalPolicyProbe\n      ? Number(resultRows(result?.[4])[0]?.total || 0)\n      : null,\n    overrideMismatches: Number(resultRows(result?.[overrideIndex])[0]?.total || 0),\n    publicLeakFindings: Number(resultRows(result?.[leakIndex])[0]?.total || 0)\n  });\n}`,
    'promotion-preflight-parser'
  );
  source = replaceOnce(
    source,
    `  if (preflight.absenceEvents > 0) {\n    return { allowed: false, code: 'sync_promotion_removal_not_ready' };\n  }`,
    `  if (preflight.absenceEvents > 0 && Number(context.schemaVersion || 0) < 8) {\n    return { allowed: false, code: 'sync_promotion_removal_not_ready' };\n  }\n  if (Number(context.schemaVersion || 0) >= 8 && Number(preflight.removalPolicyValid || 0) !== 1) {\n    return { allowed: false, code: 'sync_promotion_removal_policy_invalid' };\n  }`,
    'promotion-admit-v8-removal'
  );
  source = replaceOnce(
    source,
    `  const params = [context.importId, context.tenantId, context.sourceKey];\n  const gate = exactPromotingGate();\n  const statements = [`,
    `  const params = [context.importId, context.tenantId, context.sourceKey];\n  const gate = exactPromotingGate();\n  const removalSchema = Number(context.schemaVersion || 0) >= 8;\n  const removalGate = removalSchema ? removalPolicyGateSql() : \`NOT \${absenceEventSql()}\`;\n  const statements = [`,
    'promotion-transaction-removal-setup'
  );
  source = replaceOnce(
    source,
    `               AND NOT \${absenceEventSql()}\n               AND NOT \${overrideMismatchSql()}`,
    `               AND \${removalGate}\n               AND NOT \${overrideMismatchSql(context)}`,
    'promotion-transaction-removal-gate'
  );

  const categoryMarker = `    {\n      sql: \`INSERT INTO catalog_categories`;
  const memberships = `    ...(removalSchema ? [\n      {\n        sql: \`INSERT INTO supplier_scope_memberships\n                (tenant_id,source_key,scope_id,scope_kind,album_source_id,public_product_id,\n                 contract_version,removal_policy_version,removal_threshold,state,miss_count,\n                 last_observed_run_id,last_progress_run_id,detached_at,updated_at)\n              SELECT r.tenant_id,r.source_key,r.scope_id,r.scope_kind,o.album_source_id,o.public_product_id,\n                     p.contract_version,p.policy_version,p.removal_threshold,'active',0,?1,?1,NULL,CURRENT_TIMESTAMP\n                FROM supplier_sync_stage_observations o\n                JOIN supplier_sync_stage_runs r ON r.run_id=o.run_id\n                JOIN supplier_sync_stage_removal_policy p ON p.run_id=r.run_id\n               WHERE o.run_id=?1 AND \${gate}\n              ON CONFLICT(tenant_id,source_key,scope_id,album_source_id) DO UPDATE SET\n                public_product_id=excluded.public_product_id,scope_kind=excluded.scope_kind,\n                contract_version=excluded.contract_version,removal_policy_version=excluded.removal_policy_version,\n                removal_threshold=excluded.removal_threshold,state='active',miss_count=0,\n                last_observed_run_id=?1,last_progress_run_id=?1,detached_at=NULL,updated_at=CURRENT_TIMESTAMP\`,\n        params\n      },\n      {\n        sql: \`INSERT INTO supplier_scope_memberships\n                (tenant_id,source_key,scope_id,scope_kind,album_source_id,public_product_id,\n                 contract_version,removal_policy_version,removal_threshold,state,miss_count,\n                 last_progress_run_id,detached_at,updated_at)\n              SELECT r.tenant_id,r.source_key,r.scope_id,r.scope_kind,e.album_source_id,e.public_product_id,\n                     p.contract_version,p.policy_version,p.removal_threshold,\n                     CASE WHEN e.event_type='REMOVED' THEN 'detached' ELSE 'missing' END,\n                     e.next_miss_count,?1,\n                     CASE WHEN e.event_type='REMOVED' THEN CURRENT_TIMESTAMP ELSE NULL END,CURRENT_TIMESTAMP\n                FROM supplier_sync_stage_events e\n                JOIN supplier_sync_stage_runs r ON r.run_id=e.run_id\n                JOIN supplier_sync_stage_removal_policy p ON p.run_id=r.run_id\n               WHERE e.run_id=?1 AND e.event_type IN ('MISSING','REMOVED') AND \${gate}\n              ON CONFLICT(tenant_id,source_key,scope_id,album_source_id) DO UPDATE SET\n                public_product_id=excluded.public_product_id,scope_kind=excluded.scope_kind,\n                contract_version=excluded.contract_version,removal_policy_version=excluded.removal_policy_version,\n                removal_threshold=excluded.removal_threshold,state=excluded.state,miss_count=excluded.miss_count,\n                last_progress_run_id=?1,detached_at=excluded.detached_at,updated_at=CURRENT_TIMESTAMP\`,\n        params\n      },\n      {\n        sql: \`UPDATE supplier_album_index\n                 SET status=CASE\n                       WHEN EXISTS (SELECT 1 FROM supplier_scope_memberships sm\n                                    WHERE sm.tenant_id=?2 AND sm.public_product_id=supplier_album_index.public_product_id\n                                      AND sm.state='active') THEN 'active'\n                       WHEN EXISTS (SELECT 1 FROM supplier_scope_memberships sm\n                                    WHERE sm.tenant_id=?2 AND sm.public_product_id=supplier_album_index.public_product_id\n                                      AND sm.state='missing') THEN 'missing'\n                       ELSE 'deleted'\n                     END,\n                     miss_count=COALESCE((SELECT MAX(sm.miss_count) FROM supplier_scope_memberships sm\n                                          WHERE sm.tenant_id=?2 AND sm.public_product_id=supplier_album_index.public_product_id),0),\n                     updated_at=CURRENT_TIMESTAMP\n               WHERE tenant_id=?2 AND source_key=?3 AND \${gate}\n                 AND EXISTS (SELECT 1 FROM supplier_sync_stage_events e\n                              WHERE e.run_id=?1 AND e.album_source_id=supplier_album_index.album_source_id\n                                AND e.event_type IN ('MISSING','REMOVED'))\`,\n        params\n      }\n    ] : []),\n`;
  source = replaceOnce(source, categoryMarker, memberships + categoryMarker, 'promotion-membership-statements');

  const mediaMarker = `    {\n      sql: \`DELETE FROM product_media`;
  const removalStatements = `    ...(removalSchema ? [\n      {\n        sql: \`INSERT INTO catalog_product_classification_override_retention\n                (product_id,override_json,override_version,original_created_at,original_updated_at,\n                 retained_by_run_id,retained_at,updated_at)\n              SELECT o.product_id,o.override_json,o.override_version,o.created_at,o.updated_at,\n                     ?1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP\n                FROM catalog_product_classification_overrides o\n                JOIN supplier_sync_stage_events e ON e.public_product_id=o.product_id\n                JOIN supplier_sync_stage_runs r ON r.run_id=e.run_id\n               WHERE e.run_id=?1 AND e.event_type='REMOVED' AND \${gate}\n                 AND NOT EXISTS (SELECT 1 FROM supplier_scope_memberships sm\n                                  WHERE sm.tenant_id=r.tenant_id AND sm.public_product_id=e.public_product_id\n                                    AND sm.state IN ('active','missing'))\n              ON CONFLICT(product_id) DO UPDATE SET\n                override_json=excluded.override_json,override_version=excluded.override_version,\n                original_created_at=excluded.original_created_at,original_updated_at=excluded.original_updated_at,\n                retained_by_run_id=excluded.retained_by_run_id,retained_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP\`,\n        params\n      },\n      {\n        sql: \`DELETE FROM catalog_products\n               WHERE \${gate}\n                 AND EXISTS (\n                   SELECT 1 FROM supplier_sync_stage_events e\n                   JOIN supplier_sync_stage_runs r ON r.run_id=e.run_id\n                    WHERE e.run_id=?1 AND e.event_type='REMOVED'\n                      AND e.public_product_id=catalog_products.product_id\n                      AND NOT EXISTS (SELECT 1 FROM supplier_scope_memberships sm\n                                      WHERE sm.tenant_id=r.tenant_id AND sm.public_product_id=e.public_product_id\n                                        AND sm.state IN ('active','missing'))\n                 )\`,\n        params\n      },\n      {\n        sql: \`INSERT INTO catalog_product_classification_overrides\n                (product_id,override_json,override_version,created_at,updated_at)\n              SELECT retained.product_id,retained.override_json,retained.override_version,\n                     retained.original_created_at,retained.original_updated_at\n                FROM catalog_product_classification_override_retention retained\n               WHERE \${gate}\n                 AND EXISTS (SELECT 1 FROM catalog_products p WHERE p.product_id=retained.product_id)\n                 AND EXISTS (SELECT 1 FROM supplier_sync_stage_events e\n                              WHERE e.run_id=?1 AND e.public_product_id=retained.product_id\n                                AND e.event_type='RESTORED')\n              ON CONFLICT(product_id) DO UPDATE SET\n                override_json=excluded.override_json,override_version=excluded.override_version,\n                updated_at=excluded.updated_at\n              WHERE excluded.override_version>=catalog_product_classification_overrides.override_version\`,\n        params\n      },\n      {\n        sql: \`DELETE FROM catalog_product_classification_override_retention\n               WHERE \${gate}\n                 AND EXISTS (SELECT 1 FROM supplier_sync_stage_events e\n                              WHERE e.run_id=?1\n                                AND e.public_product_id=catalog_product_classification_override_retention.product_id\n                                AND e.event_type='RESTORED')\n                 AND EXISTS (SELECT 1 FROM catalog_product_classification_overrides o\n                              WHERE o.product_id=catalog_product_classification_override_retention.product_id\n                                AND o.override_version>=catalog_product_classification_override_retention.override_version)\`,\n        params\n      }\n    ] : []),\n`;
  source = replaceOnce(source, mediaMarker, removalStatements + mediaMarker, 'promotion-removal-statements');
  await write(path, source);
}

console.log(JSON.stringify({ m7d9V2RemovalAuthorityIntegrated: true }));
