import { describe, expect, it } from 'vitest';
import worker from '../worker/entry.js';

const ctx = { waitUntil() {} };

function env() {
  return {
    CATALOG_ADMIN_HOST: 'app.catalogoengine.com',
    CATALOG_PLATFORM_HOSTS:
      'catalog-engine.lucassantanals0110.workers.dev,catalogoengine.com,app.catalogoengine.com',
    ADMIN_AUTH_ISSUER: 'https://catalog-beta.us.auth0.com/',
    ADMIN_AUTH_AUDIENCE: 'https://api.catalogoengine.com',
    PORTAL_AUTH_CLIENT_ID: 'public_spa_client_id',
    ASSETS: { fetch: async () => new Response('asset') }
  };
}

describe('portal auth config routing', () => {
  it('serves safe OIDC browser configuration only on the admin host', async () => {
    const response = await worker.fetch(
      new Request('https://app.catalogoengine.com/api/auth/config'),
      env(),
      ctx
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      auth: {
        provider: 'auth0',
        issuer: 'https://catalog-beta.us.auth0.com/',
        clientId: 'public_spa_client_id'
      }
    });
  });

  it('returns not found instead of exposing auth config on a merchant custom host', async () => {
    const response = await worker.fetch(
      new Request('https://merchant.example.com/api/auth/config'),
      env(),
      ctx
    );

    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain('public_spa_client_id');
  });

  it('returns not found on the generic workers.dev platform host', async () => {
    const response = await worker.fetch(
      new Request('https://catalog-engine.lucassantanals0110.workers.dev/api/auth/config'),
      env(),
      ctx
    );

    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain('public_spa_client_id');
  });
});
