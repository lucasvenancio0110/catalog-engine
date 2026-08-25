import { describe, expect, it, vi } from 'vitest';
import { queryD1Batch } from '../worker/cloudflare-platform.js';
import { TENANT_DATA_PLANE_COMMAND_VERSION } from '../worker/tenant-data-plane-command.js';

const tenantId = 't_0123456789abcdefabcd';
const otherTenantId = 't_fedcba9876543210abcd';

function dispatchFixture() {
  const fetch = vi.fn(async (request) => {
    const body = await request.json();
    expect(body).toMatchObject({
      version: TENANT_DATA_PLANE_COMMAND_VERSION,
      tenantId
    });
    expect(request.headers.get('x-catalog-tenant-id')).toBe(tenantId);
    return new Response(
      JSON.stringify({
        ok: true,
        version: TENANT_DATA_PLANE_COMMAND_VERSION,
        results: body.batch.map(() => ({ success: true, results: [{ album_source_id: '100' }], meta: {} }))
      }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    );
  });
  const get = vi.fn((scriptName) => {
    expect(scriptName).toBe('ce-0123456789abcdefabcd');
    return { fetch };
  });
  return { tenantDispatch: { get }, get, fetch };
}

describe('explicit tenant identity for TENANT_DISPATCH D1 batches', () => {
  it('routes an opaque run-scoped batch even when no SQL parameter contains the tenant id', async () => {
    const { tenantDispatch, get } = dispatchFixture();
    const result = await queryD1Batch({
      tenantDispatch,
      tenantId,
      databaseId: '11111111-2222-3333-4444-555555555555',
      batch: [
        {
          sql: `SELECT album_source_id
                  FROM supplier_sync_stage_events
                 WHERE run_id=?1 AND needs_detail=1
                 LIMIT ?2 OFFSET ?3`,
          params: ['imp_0123456789abcdefabcd', 100, 0]
        }
      ]
    });

    expect(result[0].results[0].album_source_id).toBe('100');
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('fails closed before dispatch when explicit identity conflicts with a tenant id in the batch', async () => {
    const { tenantDispatch, get } = dispatchFixture();
    await expect(
      queryD1Batch({
        tenantDispatch,
        tenantId,
        databaseId: '11111111-2222-3333-4444-555555555555',
        batch: [{ sql: 'SELECT ?1', params: [otherTenantId] }]
      })
    ).rejects.toMatchObject({ code: 'tenant_data_plane_tenant_mismatch' });
    expect(get).not.toHaveBeenCalled();
  });

  it('preserves fail-closed inference when neither explicit nor parameter identity exists', async () => {
    const { tenantDispatch, get } = dispatchFixture();
    await expect(
      queryD1Batch({
        tenantDispatch,
        databaseId: '11111111-2222-3333-4444-555555555555',
        batch: [{ sql: 'SELECT ?1', params: ['imp_0123456789abcdefabcd'] }]
      })
    ).rejects.toMatchObject({ code: 'tenant_data_plane_tenant_unresolved' });
    expect(get).not.toHaveBeenCalled();
  });
});
