import { describe, expect, it, vi } from 'vitest';
import {
  PrivatePreviewError,
  dispatchPrivatePreviewRequest,
  loadPrivatePreviewAuthority,
  normalizePrivatePreviewPath,
  validatePrivatePreviewContext
} from '../worker/private-preview.js';
import { CATALOG_CLASSIFIER_VERSION } from '../src/domain/catalog-classifier.js';
import { TENANT_CATALOG_RUNTIME_VERSION } from '../worker/tenant-catalog-runtime.js';

const tenantId = 't_aaaaaaaaaaaaaaaaaaaa';
const principalId = 'principal_test';

function readyContext(overrides = {}) {
  return {
    membership_role: 'owner',
    membership_status: 'active',
    setup_status: 'ready',
    worker_script_name: 'catalog-tenant-a',
    worker_status: 'active',
    runtime_kind: 'catalog',
    runtime_status: 'verified',
    runtime_version: TENANT_CATALOG_RUNTIME_VERSION,
    verification_status: 'success',
    classifier_version: CATALOG_CLASSIFIER_VERSION,
    finding_count: 0,
    ...overrides
  };
}

function fakeDb(row) {
  const first = vi.fn(async () => row);
  const bind = vi.fn(() => ({ first }));
  const prepare = vi.fn(() => ({ bind }));
  return { prepare, bind, first };
}

describe('PB9 private preview authority', () => {
  it('accepts only an active member with verified catalog runtime and zero verification findings', () => {
    expect(validatePrivatePreviewContext(readyContext())).toBeNull();
    expect(validatePrivatePreviewContext(null)).toBe('preview_store_not_found');
    expect(validatePrivatePreviewContext(readyContext({ membership_status: 'disabled' }))).toBe(
      'preview_store_not_found'
    );
    expect(validatePrivatePreviewContext(readyContext({ runtime_status: 'pending' }))).toBe(
      'preview_runtime_not_ready'
    );
    expect(validatePrivatePreviewContext(readyContext({ verification_status: 'failed' }))).toBe(
      'preview_catalog_not_ready'
    );
    expect(validatePrivatePreviewContext(readyContext({ finding_count: 1 }))).toBe(
      'preview_catalog_not_ready'
    );
  });

  it('resolves the runtime only through server-side membership authority', async () => {
    const db = fakeDb(readyContext());
    const authority = await loadPrivatePreviewAuthority(db, tenantId, principalId);
    expect(authority).toEqual({ tenantId, workerScriptName: 'catalog-tenant-a' });
    expect(db.bind).toHaveBeenCalledWith(tenantId, principalId);
    expect(Object.isFrozen(authority)).toBe(true);
  });

  it('fails closed when membership lookup returns no row', async () => {
    const db = fakeDb(null);
    await expect(loadPrivatePreviewAuthority(db, tenantId, principalId)).rejects.toMatchObject({
      name: 'PrivatePreviewError',
      code: 'preview_store_not_found',
      status: 404
    });
  });

  it('does not accept arbitrary preview paths or private runtime locators', () => {
    expect(normalizePrivatePreviewPath('/api/catalog/meta')).toBe('/api/catalog/meta');
    expect(normalizePrivatePreviewPath('/api/products')).toBe('/api/products');
    expect(normalizePrivatePreviewPath('/api/products/p_aaaaaaaaaaaaaaaaaaaa')).toBe(
      '/api/products/p_aaaaaaaaaaaaaaaaaaaa'
    );
    expect(() => normalizePrivatePreviewPath('/api/admin/session')).toThrow(PrivatePreviewError);
    expect(() => normalizePrivatePreviewPath('/api/health')).toThrow(PrivatePreviewError);
    expect(() => normalizePrivatePreviewPath('/internal/runtime/catalog-tenant-a')).toThrow(
      PrivatePreviewError
    );
  });

  it('dispatches read-only requests to the server-resolved tenant and forces private noindex headers', async () => {
    const fetch = vi.fn(async (request) => {
      expect(new URL(request.url).pathname).toBe('/api/catalog/meta');
      expect(request.method).toBe('GET');
      return new Response(JSON.stringify({ stats: { products: 6097 } }), {
        status: 200,
        headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=60' }
      });
    });
    const env = { TENANT_DISPATCH: { get: vi.fn(() => ({ fetch })) } };
    const request = new Request('https://app.catalogoengine.com/api/admin/preview?x=1');
    const response = await dispatchPrivatePreviewRequest(
      request,
      env,
      { tenantId, workerScriptName: 'catalog-tenant-a' },
      '/api/catalog/meta'
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow, noarchive');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(await response.json()).toEqual({ stats: { products: 6097 } });
  });

  it('rejects mutation methods even after authority resolution', async () => {
    const request = new Request('https://app.catalogoengine.com/api/admin/preview', {
      method: 'POST'
    });
    await expect(
      dispatchPrivatePreviewRequest(
        request,
        { TENANT_DISPATCH: { get: vi.fn() } },
        { tenantId, workerScriptName: 'catalog-tenant-a' },
        '/api/catalog/meta'
      )
    ).rejects.toMatchObject({ code: 'preview_method_not_allowed', status: 405 });
  });
});
