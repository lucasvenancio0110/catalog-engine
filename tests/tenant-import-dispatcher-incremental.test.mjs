import { describe, expect, it, vi } from 'vitest';
import { runDueTenantImportDispatches } from '../worker/tenant-import-dispatcher.js';
import { initialTenantImportId } from '../worker/tenant-import-queue.js';

const tenantId = 't_0123456789abcdefabcd';
const incrementalImportId = 'imp_0123456789abcdefabcd';

function dispatcherDb(dueJob) {
  const sqlSeen = [];
  const prepare = vi.fn((sql) => {
    const text = String(sql);
    sqlSeen.push(text);
    const directRun = vi.fn(async () => ({ meta: { changes: 0 } }));
    const bind = vi.fn((...params) => ({
      all: vi.fn(async () => {
        if (text.includes('SELECT DISTINCT r.tenant_id')) return { results: [] };
        if (text.includes('SELECT j.import_id') && text.includes('FROM tenant_import_jobs j')) {
          return { results: dueJob ? [dueJob] : [] };
        }
        if (text.includes('SELECT import_id, tenant_id, source_key')) return { results: [] };
        return { results: [] };
      }),
      run: vi.fn(async () => ({ meta: { changes: 1 }, params }))
    }));
    return { run: directRun, bind };
  });
  const batch = vi.fn(async () => [{ meta: { changes: 1 } }]);
  return { db: { prepare, batch }, sqlSeen, batch };
}

function envFor(db) {
  return {
    CATALOG_DB: db,
    TENANT_IMPORT_AUTOMATION_ENABLED: '1',
    TENANT_IMPORT_QUEUE: {
      send: vi.fn(async () => undefined)
    },
    TENANT_IMPORT_DETAIL_QUEUE: {
      send: vi.fn(async () => undefined),
      sendBatch: vi.fn(async () => undefined)
    }
  };
}

describe('M7D3 incremental dispatcher boundary', () => {
  it('dispatches the scheduler-owned incremental job as the existing opaque scan message', async () => {
    const { db, sqlSeen, batch } = dispatcherDb({
      import_id: incrementalImportId,
      tenant_id: tenantId,
      source_key: 'primary',
      mode: 'incremental',
      attempt_count: 0,
      phase: 'scan',
      provisioning_id: null
    });
    const env = envFor(db);

    const result = await runDueTenantImportDispatches(env, { limit: 1 });

    expect(result).toMatchObject({ enabled: true, selected: 1, scanDispatched: 1, failed: 0 });
    expect(env.TENANT_IMPORT_QUEUE.send).toHaveBeenCalledTimes(1);
    expect(env.TENANT_IMPORT_QUEUE.send.mock.calls[0][0]).toEqual({
      version: 1,
      type: 'scan',
      importId: incrementalImportId,
      tenantId,
      sourceKey: 'primary'
    });
    expect(JSON.stringify(env.TENANT_IMPORT_QUEUE.send.mock.calls[0][0])).not.toMatch(
      /mode|https?:\/\/|yupoo|sourceUrl|databaseId|secret|token/i
    );
    expect(batch).toHaveBeenCalledTimes(1);

    const dueSql = sqlSeen.find(
      (sql) => sql.includes('SELECT j.import_id') && sql.includes('FROM tenant_import_jobs j')
    );
    expect(dueSql).toContain("j.mode='incremental'");
    expect(dueSql).toContain("j.phase='scan'");
    expect(dueSql).toContain("j.status='failed' AND j.next_attempt_at IS NOT NULL");
  });

  it('preserves initial import identity and the onboarding dispatch path', async () => {
    const importId = await initialTenantImportId({ tenantId, sourceKey: 'primary' });
    const { db, batch } = dispatcherDb({
      import_id: importId,
      tenant_id: tenantId,
      source_key: 'primary',
      mode: 'initial',
      attempt_count: 0,
      phase: 'scan',
      provisioning_id: 'p_example'
    });
    const env = envFor(db);

    const result = await runDueTenantImportDispatches(env, { limit: 1 });

    expect(result.scanDispatched).toBe(1);
    expect(env.TENANT_IMPORT_QUEUE.send.mock.calls[0][0]).toEqual({
      version: 1,
      type: 'scan',
      importId,
      tenantId,
      sourceKey: 'primary'
    });
    expect(batch).toHaveBeenCalledTimes(1);
  });

  it('does not dispatch when the existing import automation kill switch is off', async () => {
    const { db } = dispatcherDb(null);
    const env = envFor(db);
    env.TENANT_IMPORT_AUTOMATION_ENABLED = '0';

    const result = await runDueTenantImportDispatches(env, { limit: 1 });

    expect(result).toEqual({
      enabled: false,
      reason: 'tenant_import_automation_disabled',
      dispatched: 0
    });
    expect(env.TENANT_IMPORT_QUEUE.send).not.toHaveBeenCalled();
  });
});
