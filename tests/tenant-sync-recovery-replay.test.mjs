import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runDueTenantIncrementalRecoveries } from '../worker/ingestion/incremental-recovery-runner.js';
import { tenantDataPlaneCurrentBatch } from '../worker/tenant-data-plane-schema-v8.js';
import {
  createTenantSyncReplayRequest,
  readTenantSyncOperations,
  runDueTenantSyncReplays
} from '../worker/tenant-sync-replay.js';

const databases = [];
const SOURCE_KEY = 'primary';
const SOURCE_URL = 'https://private-supplier.x.yupoo.com/albums/';

class Statement {
  constructor(statement, params = []) {
    this.statement = statement;
    this.params = params;
  }

  bind(...params) {
    return new Statement(this.statement, params);
  }

  run() {
    const result = this.statement.run(...this.params);
    return { success: true, meta: { changes: Number(result.changes || 0) } };
  }

  first() {
    return this.statement.get(...this.params) || null;
  }

  all() {
    return { results: this.statement.all(...this.params) };
  }
}

class D1Adapter {
  constructor(database) {
    this.database = database;
  }

  prepare(sql) {
    return new Statement(this.database.prepare(sql));
  }

  async batch(statements) {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const results = statements.map((statement) => statement.run());
      this.database.exec('COMMIT');
      return results;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }
}

function controlDatabase() {
  const database = new DatabaseSync(':memory:');
  databases.push(database);
  database.exec('PRAGMA foreign_keys=ON');
  for (const migration of readdirSync('migrations').sort()) {
    database.exec(readFileSync(`migrations/${migration}`, 'utf8'));
  }
  return { database, d1: new D1Adapter(database) };
}

function applyBatch(database, batch) {
  database.exec('BEGIN IMMEDIATE');
  try {
    for (const query of batch) database.prepare(query.sql).run(...(query.params || []));
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

function tenantDatabase({ tenantId }) {
  const database = new DatabaseSync(':memory:');
  databases.push(database);
  database.exec('PRAGMA foreign_keys=ON');
  applyBatch(
    database,
    tenantDataPlaneCurrentBatch({
      tenantId,
      source: {
        provider: 'yupoo',
        sourceKey: SOURCE_KEY,
        sourceUrl: SOURCE_URL,
        syncStrategy: 'incremental',
        removalMissThreshold: 3
      }
    })
  );
  return database;
}

function seedControl(
  database,
  {
    tenantId,
    importId,
    databaseId,
    failurePhase,
    phase = failurePhase === 'finalization' ? 'finalize' : 'details',
    stateRevision = 7,
    recoveryAttempts = 1,
    nextAttempt = '2000-01-01 00:00:00',
    error = `sync_candidate_${failurePhase}_failed`
  }
) {
  database.prepare(`INSERT INTO catalog_tenants(tenant_id,slug,display_name,status)
    VALUES (?,?,?,'active')`).run(tenantId, `store-${tenantId.slice(2, 10)}`, `Store ${tenantId.slice(2, 6)}`);
  database.prepare(`INSERT INTO supplier_sources
    (tenant_id,source_key,provider,source_url,status,sync_strategy,removal_miss_threshold)
    VALUES (?,?,'yupoo',?,'active','incremental',3)`).run(tenantId, SOURCE_KEY, SOURCE_URL);
  database.prepare(`INSERT INTO tenant_catalog_instances
    (tenant_id,data_plane_key,status,schema_version)
    VALUES (?,?,'ready',8)`).run(tenantId, `plane-${tenantId}`);
  database.prepare(`INSERT INTO tenant_data_plane_provider_state
    (tenant_id,dispatch_namespace,worker_script_name,d1_database_name,d1_database_id,
     worker_status,database_status)
    VALUES (?,'catalog-engine-production',?,?,?,'active','active')`).run(
    tenantId,
    `worker-${tenantId}`,
    `database-${tenantId}`,
    databaseId
  );
  database.prepare(`INSERT INTO tenant_import_jobs
    (import_id,tenant_id,source_key,mode,status,phase,state_revision,
     recovery_attempt_count,last_failure_phase,last_error_code,next_attempt_at,
     sync_scheduled_for)
    VALUES (?,?,?,'incremental','failed',?,?,?,?,?,?,
            '2026-08-30 10:00:00')`).run(
    importId,
    tenantId,
    SOURCE_KEY,
    phase,
    stateRevision,
    recoveryAttempts,
    failurePhase,
    error,
    nextAttempt
  );
  if (['verification', 'finalization'].includes(failurePhase)) {
    database.prepare(`UPDATE tenant_import_jobs
      SET candidate_classified_at=CURRENT_TIMESTAMP WHERE import_id=?`).run(importId);
  }
}

function seedStage(
  database,
  {
    tenantId,
    importId,
    state,
    error = null,
    authorityRevision = 0,
    lastPromoted = false,
    detail = false
  }
) {
  database.prepare(`INSERT INTO supplier_sync_runs
    (run_id,tenant_id,source_key,mode,status,complete_scan,scanned_albums,
     detail_fetch_count,started_at,finished_at,error_text)
    VALUES (?,?,?,'incremental',?,1,1,?,CURRENT_TIMESTAMP,?,?)`).run(
    importId,
    tenantId,
    SOURCE_KEY,
    state === 'failed' ? 'failed' : 'running',
    detail ? 1 : 0,
    state === 'failed' ? '2026-08-30 10:01:00' : null,
    state === 'failed' ? error : null
  );
  database.prepare(`INSERT INTO supplier_sync_stage_runs
    (run_id,tenant_id,source_key,scope_id,scope_kind,state,safety_outcome,
     scan_complete,observed_count,expected_event_count,expected_detail_count,
     staged_observation_count,staged_event_count,last_error_code)
    VALUES (?,?,?,'catalog','catalog',?,'proceed',1,1,1,?,1,1,?)`).run(
    importId,
    tenantId,
    SOURCE_KEY,
    state,
    detail ? 1 : 0,
    error
  );
  database.prepare(`INSERT INTO supplier_sync_stage_authority
    (run_id,tenant_id,source_key,base_authority_revision)
    VALUES (?,?,?,0)`).run(importId, tenantId, SOURCE_KEY);
  database.prepare(`UPDATE catalog_serving_authority
    SET revision=?,last_promoted_run_id=?,last_promoted_source_key=?
    WHERE tenant_id=?`).run(
    authorityRevision,
    lastPromoted ? importId : null,
    lastPromoted ? SOURCE_KEY : null,
    tenantId
  );

  if (detail) {
    const albumId = 'album-private-100';
    const productId = 'p_0123456789abcdefabcd';
    database.prepare(`INSERT INTO supplier_sync_stage_observations
      (run_id,album_source_id,public_product_id,source_url,source_title,
       source_category_path_json,listing_fingerprint)
      VALUES (?,?,?,?,'Private candidate','[]','listing-v2')`).run(
      importId,
      albumId,
      productId,
      `${SOURCE_URL}${albumId}`
    );
    database.prepare(`INSERT INTO supplier_sync_stage_events
      (run_id,album_source_id,public_product_id,event_type,needs_detail,reason_code)
      VALUES (?,?,?,'CHANGED',1,'sync_listing_changed')`).run(importId, albumId, productId);
    database.prepare(`INSERT INTO supplier_sync_stage_product_details
      (run_id,album_source_id,public_product_id,detail_state,attempt_count,
       outcome_code,last_error_code)
      VALUES (?,?,?,'failed',4,'sync_detail_retry_exhausted','supplier_request_failed')`).run(
      importId,
      albumId,
      productId
    );
  }
}

function queryBatchRouter(databasesById) {
  return async (request) => {
    const database = databasesById.get(request.databaseId);
    if (!database) throw new Error('tenant_data_plane_unresolved');
    database.exec('BEGIN IMMEDIATE');
    try {
      const results = (request.batch || []).map((query) => {
        const statement = database.prepare(query.sql);
        const params = query.params || [];
        if (/^\s*(?:SELECT|PRAGMA)\b/i.test(query.sql)) {
          return { results: statement.all(...params), meta: { changes: 0 } };
        }
        const result = statement.run(...params);
        return { results: [], meta: { changes: Number(result.changes || 0) } };
      });
      database.exec('COMMIT');
      return results;
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  };
}

function env(controlD1) {
  return {
    CATALOG_DB: controlD1,
    TENANT_DISPATCH: { get: vi.fn() },
    CLOUDFLARE_PLATFORM_DISPATCH_NAMESPACE: 'catalog-engine-production'
  };
}

afterEach(() => {
  while (databases.length) databases.pop().close();
});

describe('M7D10 automatic recovery', () => {
  it('continues a healthy tenant even when another tenant has non-admissible failed evidence', async () => {
    const { database: control, d1 } = controlDatabase();
    const healthy = {
      tenantId: 't_aaaaaaaaaaaaaaaaaaaa',
      importId: 'imp_aaaaaaaaaaaaaaaaaaaa',
      databaseId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
    };
    const broken = {
      tenantId: 't_bbbbbbbbbbbbbbbbbbbb',
      importId: 'imp_bbbbbbbbbbbbbbbbbbbb',
      databaseId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
    };
    seedControl(control, { ...healthy, failurePhase: 'classification' });
    seedControl(control, { ...broken, failurePhase: 'classification' });
    const healthyDb = tenantDatabase(healthy);
    const brokenDb = tenantDatabase(broken);
    seedStage(healthyDb, { ...healthy, state: 'details_complete' });
    seedStage(brokenDb, {
      ...broken,
      state: 'failed',
      error: 'sync_candidate_classification_failed'
    });

    const result = await runDueTenantIncrementalRecoveries(env(d1), {
      limit: 2,
      queryBatch: queryBatchRouter(
        new Map([
          [healthy.databaseId, healthyDb],
          [broken.databaseId, brokenDb]
        ])
      )
    });

    expect(result).toMatchObject({ selected: 2, processed: 2, recovered: 1, blocked: 1 });
    expect(control.prepare(`SELECT status,phase,state_revision,last_recovery_at
      FROM tenant_import_jobs WHERE import_id=?`).get(healthy.importId)).toMatchObject({
      status: 'details',
      phase: 'details',
      state_revision: 8
    });
    expect(control.prepare(`SELECT status,next_attempt_at
      FROM tenant_import_jobs WHERE import_id=?`).get(broken.importId)).toEqual({
      status: 'failed',
      next_attempt_at: null
    });
  });

  it('resets only a matching transient verification failure back to private candidate work', async () => {
    const { database: control, d1 } = controlDatabase();
    const fixture = {
      tenantId: 't_cccccccccccccccccccc',
      importId: 'imp_cccccccccccccccccccc',
      databaseId: 'cccccccc-cccc-cccc-cccc-cccccccccccc'
    };
    seedControl(control, {
      ...fixture,
      failurePhase: 'verification',
      error: 'sync_candidate_verification_failed'
    });
    const tenant = tenantDatabase(fixture);
    seedStage(tenant, {
      ...fixture,
      state: 'failed',
      error: 'sync_candidate_verification_failed'
    });

    const result = await runDueTenantIncrementalRecoveries(env(d1), {
      queryBatch: queryBatchRouter(new Map([[fixture.databaseId, tenant]]))
    });

    expect(result).toMatchObject({ recovered: 1, failed: 0, blocked: 0 });
    expect(tenant.prepare(`SELECT state,last_error_code FROM supplier_sync_stage_runs`).get())
      .toEqual({ state: 'details_complete', last_error_code: null });
    expect(tenant.prepare(`SELECT status,error_text FROM supplier_sync_runs`).get())
      .toEqual({ status: 'running', error_text: null });
    expect(control.prepare(`SELECT status,phase FROM tenant_import_jobs`).get())
      .toEqual({ status: 'details', phase: 'details' });
  });

  it('recovers post-promotion finalization without a second authority change', async () => {
    const { database: control, d1 } = controlDatabase();
    const fixture = {
      tenantId: 't_dddddddddddddddddddd',
      importId: 'imp_dddddddddddddddddddd',
      databaseId: 'dddddddd-dddd-dddd-dddd-dddddddddddd'
    };
    seedControl(control, {
      ...fixture,
      failurePhase: 'finalization',
      error: 'sync_promotion_transaction_failed'
    });
    const tenant = tenantDatabase(fixture);
    seedStage(tenant, {
      ...fixture,
      state: 'promoted',
      authorityRevision: 1,
      lastPromoted: true
    });

    const result = await runDueTenantIncrementalRecoveries(env(d1), {
      queryBatch: queryBatchRouter(new Map([[fixture.databaseId, tenant]]))
    });

    expect(result.recovered).toBe(1);
    expect(control.prepare(`SELECT status,phase FROM tenant_import_jobs`).get())
      .toEqual({ status: 'finalizing', phase: 'finalize' });
    expect(tenant.prepare(`SELECT revision,last_promoted_run_id
      FROM catalog_serving_authority`).get()).toEqual({
      revision: 1,
      last_promoted_run_id: fixture.importId
    });
  });
});

describe('M7D10 validated replay and safe observability', () => {
  it('retries a crash-gap detail replay from durable evidence without accepting a manual payload', async () => {
    const { database: control, d1 } = controlDatabase();
    const fixture = {
      tenantId: 't_99999999999999999999',
      importId: 'imp_99999999999999999999',
      databaseId: '99999999-9999-9999-9999-999999999999'
    };
    seedControl(control, {
      ...fixture,
      failurePhase: 'detail',
      recoveryAttempts: 4,
      nextAttempt: null,
      error: 'sync_detail_retry_exhausted'
    });
    const tenant = tenantDatabase(fixture);
    seedStage(tenant, { ...fixture, state: 'details_pending', detail: true });
    await createTenantSyncReplayRequest(d1, {
      tenantId: fixture.tenantId,
      requestedByPrincipalId: 'principal_owner_1',
      importId: fixture.importId,
      phase: 'detail',
      expectedJobRevision: 7,
      expectedAuthorityRevision: 0
    });

    const sendBatch = vi
      .fn()
      .mockRejectedValueOnce(new Error('tenant_sync_queue_unavailable'))
      .mockResolvedValueOnce(undefined);
    const runtime = { ...env(d1), TENANT_IMPORT_DETAIL_QUEUE: { sendBatch } };
    const options = {
      queryBatch: queryBatchRouter(new Map([[fixture.databaseId, tenant]]))
    };

    const interrupted = await runDueTenantSyncReplays(runtime, options);
    expect(interrupted).toMatchObject({ succeeded: 0, failed: 1 });
    expect(control.prepare(`SELECT status,state_revision FROM tenant_import_jobs`).get())
      .toEqual({ status: 'failed', state_revision: 7 });
    expect(tenant.prepare(`SELECT detail_state FROM supplier_sync_stage_product_details`).get())
      .toEqual({ detail_state: 'pending' });

    control.prepare(`UPDATE tenant_sync_replay_requests
      SET next_attempt_at=CURRENT_TIMESTAMP`).run();
    const recovered = await runDueTenantSyncReplays(runtime, options);

    expect(recovered).toMatchObject({ succeeded: 1, failed: 0 });
    expect(sendBatch).toHaveBeenCalledTimes(2);
    expect(sendBatch.mock.calls[1][0][0].body).toMatchObject({
      type: 'detail',
      importId: fixture.importId,
      tenantId: fixture.tenantId
    });
    expect(control.prepare(`SELECT status,state_revision FROM tenant_import_jobs`).get())
      .toEqual({ status: 'details', state_revision: 8 });
    expect(control.prepare(`SELECT status,attempt_count FROM tenant_sync_replay_requests`).get())
      .toEqual({ status: 'success', attempt_count: 2 });
  });

  it('derives a canonical detail replay from durable state and never accepts a payload', async () => {
    const { database: control, d1 } = controlDatabase();
    const fixture = {
      tenantId: 't_eeeeeeeeeeeeeeeeeeee',
      importId: 'imp_eeeeeeeeeeeeeeeeeeee',
      databaseId: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'
    };
    seedControl(control, {
      ...fixture,
      failurePhase: 'detail',
      recoveryAttempts: 4,
      nextAttempt: null,
      error: 'sync_detail_retry_exhausted'
    });
    const tenant = tenantDatabase(fixture);
    seedStage(tenant, { ...fixture, state: 'details_pending', detail: true });

    const input = {
      tenantId: fixture.tenantId,
      requestedByPrincipalId: 'principal_owner_1',
      importId: fixture.importId,
      phase: 'detail',
      expectedJobRevision: 7,
      expectedAuthorityRevision: 0
    };
    await expect(
      createTenantSyncReplayRequest(d1, {
        ...input,
        payload: { albumSourceId: 'caller-selected-private-id' }
      })
    ).rejects.toMatchObject({ name: 'ZodError' });
    const first = await createTenantSyncReplayRequest(d1, input);
    const duplicate = await createTenantSyncReplayRequest(d1, input);
    expect(duplicate).toEqual(first);
    await expect(
      createTenantSyncReplayRequest(d1, { ...input, expectedJobRevision: 6 })
    ).rejects.toMatchObject({ code: 'sync_replay_stale_request' });

    const sendBatch = vi.fn(async () => undefined);
    const result = await runDueTenantSyncReplays(
      { ...env(d1), TENANT_IMPORT_DETAIL_QUEUE: { sendBatch } },
      { queryBatch: queryBatchRouter(new Map([[fixture.databaseId, tenant]])) }
    );

    expect(result).toMatchObject({ selected: 1, processed: 1, succeeded: 1, failed: 0 });
    expect(sendBatch).toHaveBeenCalledTimes(1);
    const message = sendBatch.mock.calls[0][0][0].body;
    expect(message).toMatchObject({
      type: 'detail',
      importId: fixture.importId,
      tenantId: fixture.tenantId,
      sourceKey: SOURCE_KEY
    });
    expect(JSON.stringify(message)).not.toMatch(/https?:\/\/|yupoo|database|secret|token/i);
    expect(control.prepare(`SELECT status,phase,state_revision,last_error_code
      FROM tenant_import_jobs`).get()).toEqual({
      status: 'details',
      phase: 'details',
      state_revision: 8,
      last_error_code: null
    });
    expect(control.prepare(`SELECT status,attempt_count,replayed_item_count,last_error_code
      FROM tenant_sync_replay_requests`).get()).toEqual({
      status: 'success',
      attempt_count: 1,
      replayed_item_count: 1,
      last_error_code: null
    });

    const operations = await readTenantSyncOperations(d1, fixture.tenantId);
    expect(operations).toMatchObject({
      tenantId: fixture.tenantId,
      queue: { status: 'managed', backlog: 1, dlqCount: null },
      failedCount: 0
    });
    expect(JSON.stringify(operations)).not.toMatch(/https?:\/\/|yupoo|d1_database|worker_script/i);
    expect(operations.jobs[0]).not.toHaveProperty('sourceKey');
  });

  it('fails a stale-authority replay closed without touching LKG or control state', async () => {
    const { database: control, d1 } = controlDatabase();
    const fixture = {
      tenantId: 't_ffffffffffffffffffff',
      importId: 'imp_ffffffffffffffffffff',
      databaseId: 'ffffffff-ffff-ffff-ffff-ffffffffffff'
    };
    seedControl(control, {
      ...fixture,
      failurePhase: 'classification',
      recoveryAttempts: 4,
      nextAttempt: null
    });
    const tenant = tenantDatabase(fixture);
    seedStage(tenant, { ...fixture, state: 'details_complete', authorityRevision: 1 });
    tenant.prepare(`INSERT INTO catalog_products
      (product_id,name,search_text,category_id,category_name,description,
       source_name,display_name,source_category_name,display_category_name)
      VALUES ('p_ffffffffffffffffffff','LKG','lkg','legacy','Legacy','healthy',
              'LKG','LKG','Legacy','Legacy')`).run();
    await createTenantSyncReplayRequest(d1, {
      tenantId: fixture.tenantId,
      requestedByPrincipalId: 'principal_owner_1',
      importId: fixture.importId,
      phase: 'classification',
      expectedJobRevision: 7,
      expectedAuthorityRevision: 0
    });

    const result = await runDueTenantSyncReplays(env(d1), {
      queryBatch: queryBatchRouter(new Map([[fixture.databaseId, tenant]]))
    });

    expect(result).toMatchObject({ succeeded: 0, failed: 1 });
    expect(control.prepare(`SELECT status,state_revision FROM tenant_import_jobs`).get())
      .toEqual({ status: 'failed', state_revision: 7 });
    expect(tenant.prepare(`SELECT name,description FROM catalog_products`).get())
      .toEqual({ name: 'LKG', description: 'healthy' });
    expect(control.prepare(`SELECT status,last_error_code FROM tenant_sync_replay_requests`).get())
      .toEqual({ status: 'failed', last_error_code: 'sync_replay_authority_stale' });
  });
});
