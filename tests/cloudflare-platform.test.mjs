import { describe, expect, it, vi } from 'vitest';
import {
  CloudflarePlatformError,
  assertDispatchNamespace,
  ensureD1Database,
  queryD1Batch,
  tenantBootstrapWorkerSource,
  uploadTenantBootstrapWorker
} from '../worker/cloudflare-platform.js';

const accountId = '0123456789abcdef0123456789abcdef';
const apiToken = 'platform-token-that-is-long-enough-for-tests';
const dispatchNamespace = 'catalog-engine-production';
const databaseName = 'ce-0123456789abcdefabcd';
const databaseId = '11111111-2222-3333-4444-555555555555';
const tenantId = 't_0123456789abcdefabcd';

function success(result, status = 200) {
  return new Response(JSON.stringify({ success: true, errors: [], messages: [], result }), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

const baseConfig = { accountId, apiToken, dispatchNamespace };

describe('Cloudflare Workers for Platforms adapter', () => {
  it('requires an existing single production dispatch namespace', async () => {
    const fetchImpl = vi.fn(async () =>
      success({ namespace_name: dispatchNamespace, namespace_id: 'namespace-id' })
    );
    const result = await assertDispatchNamespace(baseConfig, { fetchImpl });

    expect(result).toEqual({ namespace: dispatchNamespace, namespaceId: 'namespace-id' });
    expect(fetchImpl.mock.calls[0][0]).toBe(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/dispatch/namespaces/${dispatchNamespace}`
    );
  });

  it('reuses an existing D1 database by deterministic name instead of creating a duplicate', async () => {
    const fetchImpl = vi.fn(async () => success([{ name: databaseName, uuid: databaseId }]));
    const result = await ensureD1Database({ ...baseConfig, databaseName }, { fetchImpl });

    expect(result).toEqual({ databaseId, databaseName, created: false });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][1].method).toBe('GET');
  });

  it('creates the isolated D1 only after a deterministic lookup finds nothing', async () => {
    const fetchImpl = vi
      .fn()
      .mockImplementationOnce(async () => success([]))
      .mockImplementationOnce(async (_url, options) => {
        expect(options.method).toBe('POST');
        expect(JSON.parse(options.body)).toEqual({
          name: databaseName,
          read_replication: { mode: 'disabled' }
        });
        return success({ name: databaseName, uuid: databaseId }, 200);
      });

    const result = await ensureD1Database({ ...baseConfig, databaseName }, { fetchImpl });
    expect(result).toEqual({ databaseId, databaseName, created: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('sends tenant schema operations through the D1 batch query API with bound params', async () => {
    const batch = [
      { sql: 'CREATE TABLE IF NOT EXISTS example(id TEXT PRIMARY KEY)', params: [] },
      { sql: 'INSERT INTO example(id) VALUES (?1)', params: ['safe-opaque-id'] }
    ];
    const fetchImpl = vi.fn(async (url, options) => {
      expect(url).toBe(
        `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`
      );
      expect(options.method).toBe('POST');
      expect(JSON.parse(options.body)).toEqual({ batch });
      return success([
        { success: true, results: [], meta: {} },
        { success: true, results: [], meta: {} }
      ]);
    });

    const result = await queryD1Batch(
      { ...baseConfig, databaseId, batch },
      { fetchImpl }
    );
    expect(result).toHaveLength(2);
  });

  it('rejects a partially failed D1 batch even if the envelope is successful', async () => {
    const fetchImpl = async () =>
      success([
        { success: true, results: [] },
        { success: false, results: [] }
      ]);
    await expect(
      queryD1Batch(
        {
          ...baseConfig,
          databaseId,
          batch: [
            { sql: 'SELECT 1', params: [] },
            { sql: 'SELECT 2', params: [] }
          ]
        },
        { fetchImpl }
      )
    ).rejects.toMatchObject({ code: 'tenant_d1_query_failed' });
  });

  it('uploads one tenant Worker with only that tenant D1 binding and opaque tenant id', async () => {
    const fetchImpl = vi.fn(async (_url, options) => {
      expect(options.method).toBe('PUT');
      expect(options.body).toBeInstanceOf(FormData);
      const form = options.body;
      const metadata = JSON.parse(await form.get('metadata').text());
      expect(metadata).toEqual({
        main_module: 'worker.js',
        compatibility_date: '2026-08-17',
        bindings: [
          { type: 'd1', name: 'CATALOG_DB', database_id: databaseId },
          { type: 'plain_text', name: 'TENANT_ID', text: tenantId },
          { type: 'plain_text', name: 'TENANT_RUNTIME_VERSION', text: '0' }
        ]
      });
      const module = await form.get('worker.js').text();
      expect(module).toContain('tenant_catalog_provisioning');
      expect(module).not.toContain('yupoo.com');
      return success({ startup_time_ms: 3, version_id: 'version-1' });
    });

    const result = await uploadTenantBootstrapWorker(
      {
        ...baseConfig,
        scriptName: 'ce-0123456789abcdefabcd',
        databaseId,
        tenantId
      },
      { fetchImpl }
    );

    expect(result).toEqual({
      scriptName: 'ce-0123456789abcdefabcd',
      runtimeVersion: 0,
      startupTimeMs: 3,
      versionId: 'version-1'
    });
  });

  it('bootstrap Worker exposes only health while migrations/import are incomplete', () => {
    const source = tenantBootstrapWorkerSource();
    expect(source).toContain("url.pathname === '/api/health'");
    expect(source).toContain("status: 'provisioning'");
    expect(source).toContain("error: 'tenant_catalog_provisioning'");
    expect(source).not.toMatch(/sourceUrl|credential|password|yupoo/i);
  });

  it('fails closed before any provider call when the platform runtime is absent', async () => {
    const fetchImpl = vi.fn();
    await expect(
      assertDispatchNamespace({ accountId: '', apiToken: '', dispatchNamespace }, { fetchImpl })
    ).rejects.toBeInstanceOf(CloudflarePlatformError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('collapses provider errors to stable codes without echoing provider messages or tokens', async () => {
    const fetchImpl = async () =>
      new Response(
        JSON.stringify({
          success: false,
          result: null,
          errors: [{ code: 10090, message: `never expose ${apiToken}` }]
        }),
        { status: 403, headers: { 'content-type': 'application/json' } }
      );

    await expect(assertDispatchNamespace(baseConfig, { fetchImpl })).rejects.toMatchObject({
      name: 'CloudflarePlatformError',
      code: 'cloudflare_platform_10090',
      status: 422
    });
  });
});
