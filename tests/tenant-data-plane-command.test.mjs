import { describe, expect, it, vi } from 'vitest';
import { queryD1Batch, tenantBootstrapWorkerSource } from '../worker/cloudflare-platform.js';
import {
  TENANT_DATA_PLANE_COMMAND_PATH,
  handleTenantDataPlaneCommand,
  normalizeTenantDataPlaneBatch
} from '../worker/tenant-data-plane-command.js';

const tenantId = 't_0123456789abcdefabcd';
const workerScriptName = 'ce-0123456789abcdefabcd';
const databaseId = '11111111-2222-3333-4444-555555555555';

function fakeD1() {
  return {
    prepare(sql) {
      return {
        bind(...params) {
          return { sql, params };
        }
      };
    },
    async batch(statements) {
      return statements.map((statement) => ({
        success: true,
        results: statement.sql.startsWith('SELECT')
          ? [{ tenant_id: statement.params[0] || null }]
          : [],
        meta: { changes: statement.sql.startsWith('SELECT') ? 0 : 1 }
      }));
    }
  };
}

function tenantFetcher(boundTenantId = tenantId) {
  const env = { TENANT_ID: boundTenantId, CATALOG_DB: fakeD1() };
  return {
    fetch(request) {
      return handleTenantDataPlaneCommand(request, env);
    }
  };
}

describe('native tenant data-plane command', () => {
  it('routes an ingestion batch to the deterministic tenant User Worker without Cloudflare REST credentials', async () => {
    const get = vi.fn((scriptName) =>
      scriptName === workerScriptName ? tenantFetcher() : null
    );
    const fetchImpl = vi.fn(() => {
      throw new Error('administrative Cloudflare D1 REST must not be used');
    });

    const result = await queryD1Batch(
      {
        dispatchNamespace: 'catalog-engine-production',
        databaseId,
        tenantDispatch: { get },
        batch: [
          {
            sql: 'SELECT tenant_id FROM data_plane_identity WHERE tenant_id=?1',
            params: [tenantId]
          }
        ]
      },
      { fetchImpl }
    );

    expect(result[0].results).toEqual([{ tenant_id: tenantId }]);
    expect(get).toHaveBeenCalledWith(workerScriptName);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('fails closed when a batch cannot resolve exactly one opaque tenant id', async () => {
    await expect(
      queryD1Batch({
        tenantDispatch: { get: vi.fn() },
        databaseId,
        batch: [{ sql: 'SELECT 1', params: [] }]
      })
    ).rejects.toMatchObject({ code: 'tenant_data_plane_tenant_unresolved' });
  });

  it('rejects a cross-tenant command before touching D1', async () => {
    const db = fakeD1();
    db.batch = vi.fn(db.batch);
    const request = new Request(`https://catalog-engine.internal${TENANT_DATA_PLANE_COMMAND_PATH}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-catalog-tenant-id': 't_bbbbbbbbbbbbbbbbbbbb'
      },
      body: JSON.stringify({
        version: 1,
        tenantId: 't_bbbbbbbbbbbbbbbbbbbb',
        batch: [{ sql: 'SELECT tenant_id FROM data_plane_identity WHERE tenant_id=?1', params: [tenantId] }]
      })
    });

    const response = await handleTenantDataPlaneCommand(request, {
      TENANT_ID: tenantId,
      CATALOG_DB: db
    });
    expect(response.status).toBe(403);
    expect((await response.json()).error).toBe('tenant_data_plane_tenant_mismatch');
    expect(db.batch).not.toHaveBeenCalled();
  });

  it('allows only one-statement DML/read operations on the internal protocol', () => {
    expect(() =>
      normalizeTenantDataPlaneBatch([
        { sql: 'CREATE TABLE unsafe(id TEXT)', params: [] }
      ])
    ).toThrow('tenant_data_plane_sql_invalid');
    expect(() =>
      normalizeTenantDataPlaneBatch([
        { sql: 'SELECT 1; DELETE FROM catalog_products', params: [] }
      ])
    ).toThrow('tenant_data_plane_sql_invalid');
  });

  it('ships the internal command inside bootstrap User Workers without exposing an admin API', () => {
    const source = tenantBootstrapWorkerSource();
    expect(source).toContain(TENANT_DATA_PLANE_COMMAND_PATH);
    expect(source).toContain('x-catalog-tenant-id');
    expect(source).not.toContain('/api/admin/');
    expect(source).not.toContain('CLOUDFLARE_PLATFORM_API_TOKEN');
  });
});
