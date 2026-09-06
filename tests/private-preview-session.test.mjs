import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import {
  clearPrivatePreviewCookie,
  createPrivatePreviewSession,
  loadPrivatePreviewSessionAuthority,
  privatePreviewCookie,
  readPrivatePreviewToken,
  revokePrivatePreviewSessions
} from '../worker/private-preview.js';
import { handlePrivatePreviewSurfaceRequest } from '../worker/private-preview-routing.js';
import { CATALOG_CLASSIFIER_VERSION } from '../src/domain/catalog-classifier.js';
import { TENANT_CATALOG_RUNTIME_VERSION } from '../worker/tenant-catalog-runtime.js';

const tenantId = 't_aaaaaaaaaaaaaaaaaaaa';
const principalId = 'prn_bbbbbbbbbbbbbbbbbbbb';

function readyContext(overrides = {}) {
  return {
    tenant_id: tenantId,
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

function sessionDb({ sessionRow = readyContext() } = {}) {
  const calls = [];
  const prepare = vi.fn((sql) => ({
    bind(...values) {
      calls.push({ sql, values });
      return {
        async first() {
          if (sql.includes('FROM tenant_private_preview_sessions ps')) return sessionRow;
          if (sql.includes('FROM tenant_memberships m')) return readyContext();
          return null;
        },
        async run() {
          return { success: true };
        }
      };
    }
  }));
  return { prepare, calls };
}

function tokenRequest(pathname, token, options = {}) {
  return new Request(`https://app.catalogoengine.com${pathname}`, {
    ...options,
    headers: {
      ...(options.headers || {}),
      cookie: `other=value; __Host-ce-preview=${token}`
    }
  });
}

describe('PB9 private preview session capability', () => {
  it('uses a host-only HttpOnly strict cookie and rejects malformed cookie values', () => {
    const token = 'a'.repeat(64);
    expect(privatePreviewCookie(token)).toContain('__Host-ce-preview=');
    expect(privatePreviewCookie(token)).toContain('Path=/');
    expect(privatePreviewCookie(token)).toContain('HttpOnly');
    expect(privatePreviewCookie(token)).toContain('Secure');
    expect(privatePreviewCookie(token)).toContain('SameSite=Strict');
    expect(privatePreviewCookie(token)).not.toContain('Domain=');
    expect(clearPrivatePreviewCookie()).toContain('Max-Age=0');
    expect(readPrivatePreviewToken(tokenRequest('/preview', token))).toBe(token);
    expect(
      readPrivatePreviewToken(
        new Request('https://app.catalogoengine.com/preview', {
          headers: { cookie: '__Host-ce-preview=not-a-valid-token' }
        })
      )
    ).toBeNull();
  });

  it('persists only a SHA-256 session hash after readiness is revalidated', async () => {
    const db = sessionDb();
    const session = await createPrivatePreviewSession(db, tenantId, principalId, 1_788_720_000_000);
    expect(session.token).toMatch(/^[a-f0-9]{64}$/);
    expect(session.cookie).toContain(session.token);
    expect(session.authority).toEqual({ tenantId, workerScriptName: 'catalog-tenant-a' });

    const insert = db.calls.find((call) => call.sql.includes('INSERT INTO tenant_private_preview_sessions'));
    expect(insert).toBeTruthy();
    expect(insert.values[0]).toMatch(/^[a-f0-9]{64}$/);
    expect(insert.values[0]).not.toBe(session.token);
    expect(insert.values[1]).toBe(tenantId);
    expect(insert.values[2]).toBe(principalId);
  });

  it('revalidates membership/runtime/catalog from the hashed cookie on every preview request', async () => {
    const token = 'c'.repeat(64);
    const db = sessionDb();
    const authority = await loadPrivatePreviewSessionAuthority(
      db,
      tokenRequest('/api/catalog/meta', token),
      1_788_720_000_000
    );
    expect(authority).toEqual({ tenantId, workerScriptName: 'catalog-tenant-a' });
    const lookup = db.calls.find((call) => call.sql.includes('FROM tenant_private_preview_sessions ps'));
    expect(lookup.values[0]).toMatch(/^[a-f0-9]{64}$/);
    expect(lookup.values[0]).not.toBe(token);
    expect(lookup.sql).toContain("m.status='active'");
    expect(lookup.sql).toContain('tenant_verification_jobs');
    expect(lookup.sql).toContain('tenant_data_plane_provider_state');
  });

  it('fails closed when the preview session is absent, expired or no longer authorized', async () => {
    const missing = sessionDb({ sessionRow: null });
    await expect(
      loadPrivatePreviewSessionAuthority(
        missing,
        tokenRequest('/preview', 'd'.repeat(64)),
        1_788_720_000_000
      )
    ).rejects.toMatchObject({ code: 'preview_session_invalid', status: 404 });

    await expect(
      loadPrivatePreviewSessionAuthority(
        missing,
        new Request('https://app.catalogoengine.com/preview'),
        1_788_720_000_000
      )
    ).rejects.toMatchObject({ code: 'preview_session_required', status: 404 });
  });

  it('serves the real storefront shell privately and dispatches only the server-resolved tenant', async () => {
    const token = 'e'.repeat(64);
    const db = sessionDb();
    const assetFetch = vi.fn(async (request) => {
      expect(new URL(request.url).pathname).toBe('/');
      return new Response('<title>Catálogo</title>', {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' }
      });
    });
    const runtimeFetch = vi.fn(async (request) => {
      expect(new URL(request.url).hostname).toBe(`${tenantId}.tenant-preview.internal`);
      return Response.json({ stats: { products: 6097 } });
    });
    const get = vi.fn((scriptName) => {
      expect(scriptName).toBe('catalog-tenant-a');
      return { fetch: runtimeFetch };
    });
    const env = {
      CATALOG_ADMIN_HOST: 'app.catalogoengine.com',
      CATALOG_DB: db,
      ASSETS: { fetch: assetFetch },
      TENANT_DISPATCH: { get }
    };

    const shell = await handlePrivatePreviewSurfaceRequest(tokenRequest('/preview', token), env);
    expect(shell.status).toBe(200);
    expect(shell.headers.get('cache-control')).toBe('private, no-store');
    expect(shell.headers.get('x-robots-tag')).toBe('noindex, nofollow, noarchive');
    expect(shell.headers.get('content-security-policy')).toContain("frame-ancestors 'self'");
    expect(await shell.text()).toContain('Catálogo');

    const meta = await handlePrivatePreviewSurfaceRequest(
      tokenRequest('/api/catalog/meta', token),
      env
    );
    expect(meta.status).toBe(200);
    expect(await meta.json()).toEqual({ stats: { products: 6097 } });
    expect(get).toHaveBeenCalledWith('catalog-tenant-a');
  });

  it('never serves the preview shell anonymously', async () => {
    const assetFetch = vi.fn();
    const response = await handlePrivatePreviewSurfaceRequest(
      new Request('https://app.catalogoengine.com/preview'),
      {
        CATALOG_ADMIN_HOST: 'app.catalogoengine.com',
        CATALOG_DB: sessionDb(),
        ASSETS: { fetch: assetFetch }
      }
    );
    expect(response.status).toBe(404);
    expect(assetFetch).not.toHaveBeenCalled();
  });

  it('revokes all private preview sessions for the authenticated principal', async () => {
    const db = sessionDb();
    await revokePrivatePreviewSessions(db, principalId);
    const removal = db.calls.find((call) => call.sql.includes('DELETE FROM tenant_private_preview_sessions WHERE principal_id'));
    expect(removal.values).toEqual([principalId]);
  });

  it('defines the session table as opaque, expiring control-plane state', async () => {
    const migration = await readFile(
      new URL('../migrations/0024_tenant_private_preview_sessions.sql', import.meta.url),
      'utf8'
    );
    expect(migration).toContain('tenant_private_preview_sessions');
    expect(migration).toContain('session_hash TEXT PRIMARY KEY');
    expect(migration).toContain('expires_at TEXT NOT NULL');
    expect(migration).not.toMatch(/worker_script|source_url|provider_id/i);
  });
});
