import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { buildIncrementalStageWritePlan } from '../worker/ingestion/incremental-stage.js';

const databases = [];

const context = {
  importId: 'imp_0123456789abcdefabcd',
  tenantId: 't_0123456789abcdefabcd',
  sourceKey: 'primary',
  mode: 'incremental'
};

function cloudflareParams(params) {
  return params.map((value) => (value === null || value === undefined ? null : String(value)));
}

function stagePlan() {
  const scan = {
    complete: true,
    taxonomy: [{ id: '10', name: 'Team', parentId: null, depth: 0 }],
    items: [
      {
        albumSourceId: '100',
        publicProductId: 'p_00000000000000000100',
        sourceUrl: 'https://supplier.example/albums/100',
        sourceTitle: 'Product 100',
        sourceCategoryId: '10',
        sourceCategoryPath: ['10'],
        coverSourceUrl: null,
        imageCountHint: 1,
        listingFingerprint: 'fp-100'
      }
    ]
  };
  const plan = {
    decision: {
      outcome: 'proceed',
      scope: { id: 's_0123456789abcdefabcd', kind: 'source' },
      policyVersion: 1
    },
    events: [
      {
        type: 'CHANGED',
        sourceId: '100',
        previous: null,
        current: {
          publicProductId: 'p_00000000000000000100'
        },
        needsDetail: true,
        reason: 'listing-changed'
      }
    ],
    detailQueue: ['100'],
    previousKnownGoodCount: 1,
    observedCount: 1,
    counts: {
      scannedAlbums: 1,
      changedCount: 1,
      detailFetchCount: 1
    }
  };
  return buildIncrementalStageWritePlan({ context, scan, plan });
}

afterEach(() => {
  while (databases.length) databases.pop().close();
});

describe('M7D3 D1 parameter affinity', () => {
  it('seals category counts when production D1 parameters arrive as strings', () => {
    const database = new DatabaseSync(':memory:');
    databases.push(database);
    database.exec(`
      CREATE TABLE supplier_sync_stage_runs (
        run_id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        source_key TEXT NOT NULL,
        state TEXT NOT NULL,
        observed_count INTEGER NOT NULL,
        expected_event_count INTEGER NOT NULL,
        staged_observation_count INTEGER NOT NULL DEFAULT 0,
        staged_event_count INTEGER NOT NULL DEFAULT 0,
        staged_category_count INTEGER NOT NULL DEFAULT 0,
        last_error_code TEXT,
        updated_at TEXT
      );
      CREATE TABLE supplier_sync_stage_observations (run_id TEXT NOT NULL);
      CREATE TABLE supplier_sync_stage_events (run_id TEXT NOT NULL);
      CREATE TABLE supplier_sync_stage_categories (run_id TEXT NOT NULL);
    `);
    database
      .prepare(`INSERT INTO supplier_sync_stage_runs
        (run_id, tenant_id, source_key, state, observed_count, expected_event_count)
        VALUES (?1, ?2, ?3, 'staging', 1, 1)`)
      .run(context.importId, context.tenantId, context.sourceKey);
    database.prepare('INSERT INTO supplier_sync_stage_observations (run_id) VALUES (?1)').run(context.importId);
    database.prepare('INSERT INTO supplier_sync_stage_events (run_id) VALUES (?1)').run(context.importId);
    database.prepare('INSERT INTO supplier_sync_stage_categories (run_id) VALUES (?1)').run(context.importId);

    const seal = stagePlan().sealBatch[0];
    expect(seal.sql).toContain('CAST(?6 AS INTEGER)');
    database.prepare(seal.sql).run(...cloudflareParams(seal.params));

    expect(
      database.prepare(`SELECT state, staged_observation_count, staged_event_count,
                               staged_category_count, last_error_code
                          FROM supplier_sync_stage_runs WHERE run_id=?1`).get(context.importId)
    ).toEqual({
      state: 'details_pending',
      staged_observation_count: 1,
      staged_event_count: 1,
      staged_category_count: 1,
      last_error_code: null
    });
  });
});
