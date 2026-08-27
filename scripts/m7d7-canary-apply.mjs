import { readFile, writeFile } from 'node:fs/promises';

const path = 'scripts/cloudflare-incremental-scan-stage-canary.mjs';
let text = await readFile(path, 'utf8');

function replaceOnce(before, after) {
  if (!text.includes(before)) throw new Error(`m7d7_canary_patch_missing:${before.slice(0,120)}`);
  text = text.replace(before, after);
}

replaceOnce(
  "import { incrementalTenantImportId } from '../worker/tenant-import-queue.js';",
  "import { incrementalTenantImportId } from '../worker/tenant-import-queue.js';\nimport { processTenantIncrementalPromotion } from '../worker/ingestion/incremental-promotion.js';"
);

replaceOnce("const SOURCE_KEY = 'm7d6-canary';", "const SOURCE_KEY = 'm7d7-canary';");
replaceOnce("const MERCHANT_OVERRIDE_NAME = 'M7D6 Merchant Override';", "const MERCHANT_OVERRIDE_NAME = 'M7D7 Merchant Override';");
replaceOnce("createHash('sha256').update(`m7d6-canary:${seed}`)", "createHash('sha256').update(`m7d7-canary:${seed}`)");
replaceOnce("databaseName: `cem7d6-${suffix}`", "databaseName: `cem7d7-${suffix}`");
replaceOnce("dataPlaneKey: `m7d6-${suffix}`", "dataPlaneKey: `m7d7-${suffix}`");
replaceOnce("'M7D6 Canary'", "'M7D7 Canary'");
replaceOnce("`m7d6-${fixture.tenantId.slice(2)}`", "`m7d7-${fixture.tenantId.slice(2)}`");
replaceOnce("worker.versionId || 'm7d6-canary'", "worker.versionId || 'm7d7-canary'");

replaceOnce(
`    { sql: 'SELECT COUNT(*) AS total FROM catalog_product_intelligence_state', params: [] }
  ]);
  return {
    lkgHash: createHash('sha256').update(JSON.stringify(result[0]?.results || [])).digest('hex'),
    lkgCount: (result[0]?.results || []).length,
    catalogHash: createHash('sha256').update(JSON.stringify(result[1]?.results || [])).digest('hex'),
    catalogCount: (result[1]?.results || []).length,
    overrideHash: createHash('sha256').update(JSON.stringify(result[2]?.results || [])).digest('hex'),
    overrideCount: (result[2]?.results || []).length,
    canonicalIntelligenceCount: Number(result[3]?.results?.[0]?.total || 0)
  };`,
`    { sql: 'SELECT COUNT(*) AS total FROM catalog_product_intelligence_state', params: [] },
    { sql: 'SELECT COUNT(*) AS total FROM product_media', params: [] }
  ]);
  const catalogRows = result[1]?.results || [];
  return {
    lkgHash: createHash('sha256').update(JSON.stringify(result[0]?.results || [])).digest('hex'),
    lkgCount: (result[0]?.results || []).length,
    catalogHash: createHash('sha256').update(JSON.stringify(catalogRows)).digest('hex'),
    catalogCount: catalogRows.length,
    catalogDisplayName: String(catalogRows[0]?.display_name || ''),
    overrideHash: createHash('sha256').update(JSON.stringify(result[2]?.results || [])).digest('hex'),
    overrideCount: (result[2]?.results || []).length,
    canonicalIntelligenceCount: Number(result[3]?.results?.[0]?.total || 0),
    canonicalProductMediaCount: Number(result[4]?.results?.[0]?.total || 0)
  };`
);

replaceOnce(
`async function stageState(fixture) {
  const result = await tenantBatch(fixture.databaseId, [`,
`async function scheduleState(fixture) {
  const result = await controlBatch([
    {
      sql: \`SELECT status,next_sync_at,last_scheduled_at,last_import_id
              FROM tenant_sync_schedules
             WHERE tenant_id=?1 AND source_key=?2 LIMIT 1\`,
      params: [fixture.tenantId, SOURCE_KEY]
    }
  ]);
  return result[0]?.results?.[0] || null;
}

async function stageState(fixture) {
  const result = await tenantBatch(fixture.databaseId, [`
);

replaceOnce(
`    {
      sql: \`SELECT COUNT(*) AS total
              FROM supplier_sync_stage_catalog_meta
             WHERE run_id=?1 AND key='merchandising' AND json_valid(value_json)=1
               AND json_extract(value_json,'$.projection')='candidate-composed-v1'\`,
      params: [fixture.importId]
    },
    { sql: 'PRAGMA foreign_key_check', params: [] }
  ]);`,
`    {
      sql: \`SELECT COUNT(*) AS total
              FROM supplier_sync_stage_catalog_meta
             WHERE run_id=?1 AND key='merchandising' AND json_valid(value_json)=1
               AND json_extract(value_json,'$.projection')='candidate-composed-v1'\`,
      params: [fixture.importId]
    },
    {
      sql: \`SELECT base_authority_revision
              FROM supplier_sync_stage_authority
             WHERE run_id=?1 AND tenant_id=?2 AND source_key=?3 LIMIT 1\`,
      params: [fixture.importId, fixture.tenantId, SOURCE_KEY]
    },
    {
      sql: \`SELECT revision,last_promoted_run_id,last_promoted_source_key,promoted_at
              FROM catalog_serving_authority
             WHERE tenant_id=?1 LIMIT 1\`,
      params: [fixture.tenantId]
    },
    { sql: 'PRAGMA foreign_key_check', params: [] }
  ]);`
);

replaceOnce(
`    candidateNavigationMetaCount: Number(result[7]?.results?.[0]?.total || 0),
    candidateMerchandisingMetaCount: Number(result[8]?.results?.[0]?.total || 0),
    foreignKeyFindings: (result[9]?.results || []).length
  };`,
`    candidateNavigationMetaCount: Number(result[7]?.results?.[0]?.total || 0),
    candidateMerchandisingMetaCount: Number(result[8]?.results?.[0]?.total || 0),
    baseAuthorityRevision: Number(result[9]?.results?.[0]?.base_authority_revision ?? -1),
    authorityRevision: Number(result[10]?.results?.[0]?.revision ?? -1),
    authorityRunId: String(result[10]?.results?.[0]?.last_promoted_run_id || ''),
    authoritySourceKey: String(result[10]?.results?.[0]?.last_promoted_source_key || ''),
    authorityPromotedAt: String(result[10]?.results?.[0]?.promoted_at || ''),
    foreignKeyFindings: (result[11]?.results || []).length
  };`
);

replaceOnce(
`  const state = await waitForVerifiedCandidate(fixture);
  const after = await canonicalSnapshot(fixture);
  const finalBacklogs = await waitQueuesClean(queues);
  if (before.lkgHash !== after.lkgHash || before.lkgCount !== after.lkgCount) {`,
`  const state = await waitForVerifiedCandidate(fixture);
  const verifiedSnapshot = await canonicalSnapshot(fixture);
  const scheduleBeforePromotion = await scheduleState(fixture);
  const finalBacklogs = await waitQueuesClean(queues);
  if (before.lkgHash !== verifiedSnapshot.lkgHash || before.lkgCount !== verifiedSnapshot.lkgCount) {`
);

text = text.replaceAll('before.catalogHash !== after.catalogHash', 'before.catalogHash !== verifiedSnapshot.catalogHash');
text = text.replaceAll('before.catalogCount !== after.catalogCount', 'before.catalogCount !== verifiedSnapshot.catalogCount');
text = text.replaceAll('before.overrideHash !== after.overrideHash', 'before.overrideHash !== verifiedSnapshot.overrideHash');
text = text.replaceAll('before.overrideCount !== after.overrideCount', 'before.overrideCount !== verifiedSnapshot.overrideCount');
text = text.replaceAll('before.canonicalIntelligenceCount !== after.canonicalIntelligenceCount', 'before.canonicalIntelligenceCount !== verifiedSnapshot.canonicalIntelligenceCount');
text = text.replaceAll('after.canonicalIntelligenceCount !== 0', 'verifiedSnapshot.canonicalIntelligenceCount !== 0');

replaceOnce(
`  if (
    state.job.status !== 'finalizing' ||
    state.job.phase !== 'finalize' ||
    Number(state.job.detail_enqueue_cursor || 0) !== 1 ||
    Number(state.job.queued_detail_count || 0) !== 1 ||
    Number(state.job.completed_detail_count || 0) !== 1 ||
    Number(state.job.failed_detail_count || 0) !== 0 ||
    Number(state.job.deferred_detail_count || 0) !== 0
  ) {
    throw new Error('m7d6_canary_control_progress_invalid');
  }
  const summary = {`,
`  if (
    state.job.status !== 'finalizing' ||
    state.job.phase !== 'finalize' ||
    Number(state.job.detail_enqueue_cursor || 0) !== 1 ||
    Number(state.job.queued_detail_count || 0) !== 1 ||
    Number(state.job.completed_detail_count || 0) !== 1 ||
    Number(state.job.failed_detail_count || 0) !== 0 ||
    Number(state.job.deferred_detail_count || 0) !== 0
  ) {
    throw new Error('m7d6_canary_control_progress_invalid');
  }
  if (state.stage.baseAuthorityRevision !== 0 || state.stage.authorityRevision !== 0) {
    throw new Error('m7d7_canary_authority_base_invalid');
  }
  if (scheduleBeforePromotion !== null) throw new Error('m7d7_canary_schedule_unexpected_before_promotion');

  const promotion = await processTenantIncrementalPromotion(
    {
      CLOUDFLARE_PLATFORM_ACCOUNT_ID: ACCOUNT_ID,
      CLOUDFLARE_PLATFORM_API_TOKEN: API_TOKEN,
      CLOUDFLARE_PLATFORM_DISPATCH_NAMESPACE: DISPATCH_NAMESPACE
    },
    {
      importId: fixture.importId,
      tenantId: fixture.tenantId,
      sourceKey: SOURCE_KEY,
      mode: 'incremental',
      schemaVersion: TENANT_DATA_PLANE_SCHEMA_VERSION,
      dataPlane: { databaseId: fixture.databaseId, dispatchNamespace: DISPATCH_NAMESPACE }
    },
    { queryBatch: queryD1Batch }
  );
  if (
    promotion.outcome !== 'success' || promotion.alreadyComplete !== false ||
    promotion.stageState !== 'promoted' || Number(promotion.authorityRevision || 0) !== 1
  ) {
    throw new Error('m7d7_canary_promotion_failed');
  }

  const promotedStage = await stageState(fixture);
  const promotedSnapshot = await canonicalSnapshot(fixture);
  const controlAfterPromotion = await controlState(fixture);
  const scheduleAfterPromotion = await scheduleState(fixture);

  if (before.lkgHash === promotedSnapshot.lkgHash) throw new Error('m7d7_canary_lkg_not_promoted');
  if (before.catalogHash === promotedSnapshot.catalogHash) throw new Error('m7d7_canary_catalog_not_promoted');
  if (
    before.overrideHash !== promotedSnapshot.overrideHash ||
    before.overrideCount !== promotedSnapshot.overrideCount ||
    promotedSnapshot.catalogDisplayName !== MERCHANT_OVERRIDE_NAME
  ) {
    throw new Error('m7d7_canary_override_truth_changed');
  }
  if (promotedSnapshot.canonicalIntelligenceCount !== 1) {
    throw new Error('m7d7_canary_intelligence_not_promoted');
  }
  if (promotedSnapshot.canonicalProductMediaCount < 1) {
    throw new Error('m7d7_canary_media_not_promoted');
  }
  if (
    promotedStage.state !== 'promoted' ||
    promotedStage.baseAuthorityRevision !== 0 ||
    promotedStage.authorityRevision !== 1 ||
    promotedStage.authorityRunId !== fixture.importId ||
    promotedStage.authoritySourceKey !== SOURCE_KEY ||
    !promotedStage.authorityPromotedAt
  ) {
    throw new Error('m7d7_canary_authority_not_committed');
  }
  if (promotedStage.foreignKeyFindings !== 0) throw new Error('m7d7_canary_foreign_key_findings');
  if (
    controlAfterPromotion?.status !== state.job.status ||
    controlAfterPromotion?.phase !== state.job.phase ||
    Number(controlAfterPromotion?.completed_detail_count || 0) !== Number(state.job.completed_detail_count || 0)
  ) {
    throw new Error('m7d7_canary_control_plane_advanced');
  }
  if (scheduleAfterPromotion !== null) throw new Error('m7d7_canary_schedule_advanced');

  const summary = {`
);

replaceOnce(
`    incrementalCandidateVerificationCanaryPassed: true,
    manualQueueMessagesProduced: false,`,
`    incrementalCandidateVerificationCanaryPassed: true,
    incrementalPromotionAuthorityCanaryPassed: true,
    manualQueueMessagesProduced: false,`
);

replaceOnce(
`    canonicalLkgUnchanged: true,
    canonicalCatalogUnchanged: true,
    canonicalMerchantOverrideUnchanged: true,
    canonicalIntelligenceUnchanged: true,
    storefrontCatalogUnchanged: true,
    promotionPerformed: false,
    cursorAdvanced: false,
    removalActivated: false,`,
`    canonicalLkgUnchangedThroughVerification: true,
    canonicalCatalogUnchangedThroughVerification: true,
    canonicalIntelligenceUnchangedThroughVerification: true,
    canonicalLkgPromotedAtomically: true,
    canonicalCatalogPromotedAtomically: true,
    canonicalMerchantOverrideUnchanged: true,
    canonicalIntelligencePromoted: true,
    canonicalProductMediaPromoted: promotedSnapshot.canonicalProductMediaCount,
    promotionPerformed: true,
    promotionAlreadyComplete: promotion.alreadyComplete,
    promotedStageState: promotedStage.state,
    baseAuthorityRevision: promotedStage.baseAuthorityRevision,
    authorityRevision: promotedStage.authorityRevision,
    authorityAdvancedExactlyOnce: promotedStage.authorityRevision === promotedStage.baseAuthorityRevision + 1,
    authorityRunMatch: promotedStage.authorityRunId === fixture.importId,
    controlPlaneStillFinalizing: controlAfterPromotion?.status === 'finalizing' && controlAfterPromotion?.phase === 'finalize',
    cursorAdvanced: false,
    removalActivated: false,`
);

replaceOnce(
`      incrementalCandidateVerificationCanaryPassed: false,
      retainedEvidence: true,`,
`      incrementalCandidateVerificationCanaryPassed: false,
      incrementalPromotionAuthorityCanaryPassed: false,
      retainedEvidence: true,`
);

await writeFile(path, text, 'utf8');
console.log(JSON.stringify({ ok: true, boundary: 'm7d7-production-canary-extension' }));
