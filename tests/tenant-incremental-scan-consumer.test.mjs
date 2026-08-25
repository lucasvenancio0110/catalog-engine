import { describe, expect, it, vi } from 'vitest';
import {
  assertIncrementalScanStageContext,
  handleTenantIncrementalScan
} from '../worker/ingestion/incremental-scan-consumer.js';

const baseContext = {
  importId: 'imp_0123456789abcdefabcd',
  tenantId: 't_0123456789abcdefabcd',
  sourceKey: 'primary',
  mode: 'incremental',
  importStatus: 'queued',
  phase: 'scan',
  schemaVersion: 6,
  privateSource: {
    provider: 'yupoo',
    url: 'https://supplier.x.yupoo.com/albums/',
    syncStrategy: 'incremental',
    removalMissThreshold: 3
  },
  dataPlane: {
    databaseId: '12ac414c-4aef-4668-a8f9-dc63d57d449f',
    dispatchNamespace: 'catalog-engine-production'
  }
};

const platform = {
  dispatchNamespace: 'catalog-engine-production',
  tenantDispatch: { get: vi.fn() }
};

function previous(id, overrides = {}) {
  return {
    album_source_id: String(id),
    public_product_id: `p_${id}`,
    source_category_id: '10',
    source_category_path_json: '["1","10"]',
    listing_fingerprint: `fp-${id}`,
    detail_fingerprint: `detail-${id}`,
    status: 'active',
    miss_count: 0,
    ...overrides
  };
}

function item(id, overrides = {}) {
  return {
    albumSourceId: String(id),
    publicProductId: `p_${id}`,
    sourceUrl: `https://supplier.x.yupoo.com/albums/${id}`,
    sourceTitle: `Product ${id}`,
    sourceCategoryId: '10',
    sourceCategoryPath: ['1', '10'],
    coverSourceUrl: null,
    imageCountHint: null,
    listingFingerprint: `fp-${id}`,
    ...overrides
  };
}

function controlDb({ claimChanges = 1, transitionChanges = 1 } = {}) {
  const statements = [];
  const prepare = vi.fn((sql) => {
    const text = String(sql);
    statements.push(text);
    return {
      bind: vi.fn((...params) => ({
        run: vi.fn(async () => {
          if (text.includes("SET status='scanning'")) return { meta: { changes: claimChanges } };
          if (text.includes("SET status='details'") || text.includes("SET status='failed'")) {
            return { meta: { changes: transitionChanges } };
          }
          return { meta: { changes: 1 }, params };
        })
      }))
    };
  });
  return { db: { prepare }, prepare, statements };
}

function stagedQueryBatch({ previousRows, stageState, safetyOutcome = 'proceed' }) {
  const calls = [];
  const queryBatch = vi.fn(async (request) => {
    calls.push(request);
    const sql = String(request.batch?.[0]?.sql || '');
    if (/^\s*SELECT[\s\S]+FROM supplier_album_index/i.test(sql)) {
      return [{ results: previousRows }];
    }
    if (/SELECT state, safety_outcome/i.test(sql)) {
      return [
        {
          results: [
            {
              state: stageState,
              safety_outcome: safetyOutcome,
              observed_count: 1,
              staged_observation_count: safetyOutcome === 'proceed' ? 1 : 0,
              expected_event_count: safetyOutcome === 'proceed' ? 1 : 0,
              staged_event_count: safetyOutcome === 'proceed' ? 1 : 0,
              expected_detail_count: safetyOutcome === 'proceed' ? 1 : 0,
              staged_category_count: 0,
              last_error_code: null
            }
          ]
        }
      ];
    }
    return request.batch.map(() => ({ results: [], meta: { changes: 1 } }));
  });
  return { queryBatch, calls };
}

function providerScan(scan) {
  return {
    scanListingIndex: vi.fn(async () => scan)
  };
}

function mutatingTenantSql(calls) {
  return calls.flatMap((request) => request.batch || []).map((entry) => String(entry.sql || '')).filter(
    (sql) => /\b(?:INSERT|UPDATE|DELETE)\b/i.test(sql)
  );
}

describe('M7D3 incremental scan-to-stage consumer', () => {
  it('stages a healthy changed observation and records only the affected detail count', async () => {
    const { db, statements } = controlDb();
    const { queryBatch, calls } = stagedQueryBatch({
      previousRows: [previous('100')],
      stageState: 'details_pending'
    });
    const provider = providerScan({
      complete: true,
      taxonomy: [],
      items: [item('100', { listingFingerprint: 'fp-new' })],
      stats: {}
    });

    const result = await handleTenantIncrementalScan(
      { db, context: baseContext, provider, platform },
      { queryBatch, fetchImpl: vi.fn() }
    );

    expect(result).toMatchObject({
      outcome: 'success',
      stageOutcome: 'proceed',
      stageState: 'details_pending',
      detailCount: 1
    });
    expect(provider.scanListingIndex).toHaveBeenCalledTimes(1);
    expect(statements.some((sql) => sql.includes('discovered_count=?2'))).toBe(true);

    const mutations = mutatingTenantSql(calls);
    expect(mutations.length).toBeGreaterThan(0);
    expect(mutations.every((sql) => /supplier_sync_(?:stage_)?/i.test(sql))).toBe(true);
    expect(mutations.some((sql) => /supplier_album_index|catalog_|media_sources|product_media/i.test(sql))).toBe(false);
  });

  it('persists an incomplete scan as preserved evidence without staging destructive observations or retrying it', async () => {
    const { db, statements } = controlDb();
    const { queryBatch, calls } = stagedQueryBatch({
      previousRows: [previous('100'), previous('101')],
      stageState: 'preserved',
      safetyOutcome: 'preserve_last_known_good'
    });
    const provider = providerScan({
      complete: false,
      taxonomy: [],
      items: [item('100', { listingFingerprint: 'fp-new' })],
      stats: {}
    });

    const result = await handleTenantIncrementalScan(
      { db, context: baseContext, provider, platform },
      { queryBatch, fetchImpl: vi.fn() }
    );

    expect(result.outcome).toBe('success');
    expect(result.stageOutcome).toBe('preserve_last_known_good');
    expect(result.stageState).toBe('preserved');
    expect(result.detailCount).toBe(0);
    expect(statements.some((sql) => sql.includes("next_attempt_at=NULL"))).toBe(true);

    const mutations = mutatingTenantSql(calls);
    expect(mutations.some((sql) => /supplier_sync_stage_observations/i.test(sql) && /^\s*INSERT/i.test(sql))).toBe(false);
    expect(mutations.some((sql) => /supplier_album_index|catalog_|media_sources|product_media/i.test(sql))).toBe(false);
  });

  it('quarantines an implausible catastrophic drop while preserving canonical LKG', async () => {
    const prior = Array.from({ length: 220 }, (_, index) => previous(1000 + index));
    const observed = Array.from({ length: 20 }, (_, index) => item(1000 + index));
    const { db } = controlDb();
    const { queryBatch, calls } = stagedQueryBatch({
      previousRows: prior,
      stageState: 'quarantined',
      safetyOutcome: 'quarantine'
    });

    const result = await handleTenantIncrementalScan(
      {
        db,
        context: baseContext,
        provider: providerScan({ complete: true, taxonomy: [], items: observed, stats: {} }),
        platform
      },
      { queryBatch, fetchImpl: vi.fn() }
    );

    expect(result).toMatchObject({
      outcome: 'success',
      stageOutcome: 'quarantine',
      stageState: 'quarantined',
      detailCount: 0
    });
    expect(result.reason).toBe('sync_catastrophic_volume_drop');
    expect(mutatingTenantSql(calls).some((sql) => /supplier_album_index|catalog_/i.test(sql))).toBe(false);
  });

  it('acks a duplicate delivery for an unresolved failed safety run without re-reading tenant D1', async () => {
    const { db, prepare } = controlDb();
    const queryBatch = vi.fn();
    const result = await handleTenantIncrementalScan(
      {
        db,
        context: { ...baseContext, importStatus: 'failed' },
        provider: providerScan({ complete: true, taxonomy: [], items: [], stats: {} }),
        platform
      },
      { queryBatch }
    );

    expect(result).toEqual({ outcome: 'success', alreadyFailed: true });
    expect(prepare).not.toHaveBeenCalled();
    expect(queryBatch).not.toHaveBeenCalled();
  });

  it('treats a completed scan-stage phase as idempotently complete', async () => {
    const { db, prepare } = controlDb();
    const queryBatch = vi.fn();
    const result = await handleTenantIncrementalScan(
      {
        db,
        context: { ...baseContext, importStatus: 'details', phase: 'details' },
        provider: providerScan({ complete: true, taxonomy: [], items: [], stats: {} }),
        platform
      },
      { queryBatch }
    );

    expect(result).toEqual({ outcome: 'success', alreadyStaged: true });
    expect(prepare).not.toHaveBeenCalled();
    expect(queryBatch).not.toHaveBeenCalled();
  });

  it('returns busy when another valid lease owns the scan', async () => {
    const { db } = controlDb({ claimChanges: 0 });
    const queryBatch = vi.fn();
    const result = await handleTenantIncrementalScan(
      {
        db,
        context: baseContext,
        provider: providerScan({ complete: true, taxonomy: [], items: [], stats: {} }),
        platform
      },
      { queryBatch }
    );

    expect(result).toEqual({ outcome: 'busy' });
    expect(queryBatch).not.toHaveBeenCalled();
  });

  it('fails closed before tenant reads when the isolated data plane is too old for staging', async () => {
    const { db, prepare } = controlDb();
    const queryBatch = vi.fn();
    await expect(
      handleTenantIncrementalScan(
        {
          db,
          context: { ...baseContext, schemaVersion: 4 },
          provider: providerScan({ complete: true, taxonomy: [], items: [], stats: {} }),
          platform
        },
        { queryBatch }
      )
    ).rejects.toThrow('tenant_schema_not_ready');
    expect(prepare).not.toHaveBeenCalled();
    expect(queryBatch).not.toHaveBeenCalled();
  });

  it('fails closed if the control-plane job no longer matches the state being sealed', async () => {
    const { db } = controlDb({ transitionChanges: 0 });
    const { queryBatch } = stagedQueryBatch({
      previousRows: [previous('100')],
      stageState: 'details_pending'
    });

    await expect(
      handleTenantIncrementalScan(
        {
          db,
          context: baseContext,
          provider: providerScan({
            complete: true,
            taxonomy: [],
            items: [item('100', { listingFingerprint: 'fp-new' })],
            stats: {}
          }),
          platform
        },
        { queryBatch, fetchImpl: vi.fn() }
      )
    ).rejects.toThrow('tenant_sync_job_state_conflict');
  });

  it('rejects the initial-import context instead of entering incremental staging', () => {
    expect(() =>
      assertIncrementalScanStageContext({ ...baseContext, mode: 'initial' })
    ).toThrow('tenant_sync_incremental_context_required');
  });
});
