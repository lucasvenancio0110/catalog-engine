import { describe, expect, it, vi } from 'vitest';
import { handleTenantIncrementalScan } from '../worker/ingestion/incremental-scan-consumer.js';

function context(tenantId) {
  return {
    importId: `imp_${tenantId.slice(2)}ab`,
    tenantId,
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
      databaseId: `db-${tenantId}`,
      dispatchNamespace: 'catalog-engine-production'
    }
  };
}

function controlDb() {
  return {
    prepare: vi.fn((_sql) => ({
      bind: vi.fn(() => ({
        run: vi.fn(async () => ({ meta: { changes: 1 } }))
      }))
    }))
  };
}

function previousRow(id) {
  return {
    album_source_id: String(id),
    public_product_id: `p_${id}`,
    source_category_id: '10',
    source_category_path_json: '["10"]',
    listing_fingerprint: `fp-${id}`,
    detail_fingerprint: `detail-${id}`,
    status: 'active',
    miss_count: 0
  };
}

function stageQuery(previousRows, finalState, safetyOutcome) {
  const calls = [];
  const queryBatch = vi.fn(async (request) => {
    calls.push(request);
    const sql = String(request.batch?.[0]?.sql || '');
    if (/FROM supplier_album_index/i.test(sql)) return [{ results: previousRows }];
    if (/SELECT state, safety_outcome/i.test(sql)) {
      return [{ results: [{ state: finalState, safety_outcome: safetyOutcome, observed_count: 0, staged_observation_count: 0, expected_event_count: 0, staged_event_count: 0, expected_detail_count: 0, staged_category_count: 0, last_error_code: null }] }];
    }
    return request.batch.map(() => ({ results: [], meta: { changes: 1 } }));
  });
  return { queryBatch, calls };
}

function mutationSql(calls) {
  return calls.flatMap((request) => request.batch || []).map((entry) => String(entry.sql || '')).filter((sql) => /\b(?:INSERT|UPDATE|DELETE)\b/i.test(sql));
}

describe('M7D3 incremental scan safety completion', () => {
  it('quarantines a complete empty scan and never mutates canonical LKG', async () => {
    const tenant = context('t_0123456789abcdefabcd');
    const { queryBatch, calls } = stageQuery([previousRow('100')], 'quarantined', 'quarantine');
    const provider = { scanListingIndex: vi.fn(async () => ({ complete: true, taxonomy: [], items: [], stats: {} })) };

    const result = await handleTenantIncrementalScan(
      { db: controlDb(), context: tenant, provider, platform: { dispatchNamespace: 'catalog-engine-production', tenantDispatch: { get: vi.fn() } } },
      { queryBatch, fetchImpl: vi.fn() }
    );

    expect(result).toMatchObject({ outcome: 'success', stageOutcome: 'quarantine', stageState: 'quarantined', detailCount: 0 });
    expect(result.reason).toBe('sync_scan_empty');
    expect(mutationSql(calls).some((sql) => /supplier_album_index|catalog_|media_sources|product_media/i.test(sql))).toBe(false);
  });

  it('keeps tenant data-plane calls isolated by the server-resolved tenant context', async () => {
    const tenantA = context('t_aaaaaaaaaaaaaaaaaaaa');
    const tenantB = context('t_bbbbbbbbbbbbbbbbbbbb');
    const seenDatabaseIds = [];
    const queryBatch = vi.fn(async (request) => {
      seenDatabaseIds.push(request.databaseId);
      const sql = String(request.batch?.[0]?.sql || '');
      if (/FROM supplier_album_index/i.test(sql)) return [{ results: [previousRow('100')] }];
      if (/SELECT state, safety_outcome/i.test(sql)) return [{ results: [{ state: 'quarantined', safety_outcome: 'quarantine', observed_count: 0, staged_observation_count: 0, expected_event_count: 0, staged_event_count: 0, expected_detail_count: 0, staged_category_count: 0, last_error_code: null }] }];
      return request.batch.map(() => ({ results: [], meta: { changes: 1 } }));
    });
    const provider = { scanListingIndex: vi.fn(async () => ({ complete: true, taxonomy: [], items: [], stats: {} })) };
    const platform = { dispatchNamespace: 'catalog-engine-production', tenantDispatch: { get: vi.fn() } };

    await handleTenantIncrementalScan({ db: controlDb(), context: tenantA, provider, platform }, { queryBatch, fetchImpl: vi.fn() });
    await handleTenantIncrementalScan({ db: controlDb(), context: tenantB, provider, platform }, { queryBatch, fetchImpl: vi.fn() });

    expect(seenDatabaseIds).toContain(tenantA.dataPlane.databaseId);
    expect(seenDatabaseIds).toContain(tenantB.dataPlane.databaseId);
    expect(seenDatabaseIds.every((id) => id === tenantA.dataPlane.databaseId || id === tenantB.dataPlane.databaseId)).toBe(true);
  });
});
