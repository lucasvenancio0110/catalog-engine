import { describe, expect, it } from 'vitest';
import {
  buildPortalAuthConfig,
  handlePortalAuthConfig,
  normalizePortalAuthIssuer
} from '../worker/portal-auth-config.js';

function env(overrides = {}) {
  return {
    ADMIN_AUTH_ISSUER: 'https://catalog-beta.us.auth0.com/',
    ADMIN_AUTH_AUDIENCE: 'https://api.catalogoengine.com',
    PORTAL_AUTH_CLIENT_ID: 'public_spa_client_id',
    ...overrides
  };
}

describe('portal public auth configuration', () => {
  it('projects only the public values needed by the SPA', async () => {
    const config = buildPortalAuthConfig(env());
    expect(config).toEqual({
      provider: 'auth0',
      issuer: 'https://catalog-beta.us.auth0.com/',
      audience: 'https://api.catalogoengine.com',
      clientId: 'public_spa_client_id',
      scope: 'openid profile email offline_access'
    });
    expect(JSON.stringify(config)).not.toContain('JWKS');
    expect(JSON.stringify(config)).not.toContain('secret');
  });

  it('fails closed when any required browser configuration is absent', async () => {
    expect(buildPortalAuthConfig(env({ PORTAL_AUTH_CLIENT_ID: '' }))).toBeNull();
    expect(buildPortalAuthConfig(env({ ADMIN_AUTH_AUDIENCE: '' }))).toBeNull();
    expect(buildPortalAuthConfig(env({ ADMIN_AUTH_ISSUER: '' }))).toBeNull();

    const response = handlePortalAuthConfig(
      new Request('https://app.catalogoengine.com/api/auth/config'),
      env({ PORTAL_AUTH_CLIENT_ID: '' })
    );
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: 'portal_auth_unconfigured' });
  });

  it('fails closed when the backend audience list is not a single browser API audience', () => {
    expect(
      buildPortalAuthConfig(
        env({ ADMIN_AUTH_AUDIENCE: 'https://api.catalogoengine.com,https://admin.catalogoengine.com' })
      )
    ).toBeNull();
    expect(buildPortalAuthConfig(env({ ADMIN_AUTH_AUDIENCE: 'one.example, two.example' }))).toBeNull();
  });

  it('rejects non-HTTPS, credentialed and path-bearing issuers', () => {
    expect(normalizePortalAuthIssuer('http://identity.example.com')).toBe('');
    expect(normalizePortalAuthIssuer('https://user:pass@identity.example.com')).toBe('');
    expect(normalizePortalAuthIssuer('https://identity.example.com/tenant')).toBe('');
    expect(normalizePortalAuthIssuer('https://identity.example.com/?secret=1')).toBe('');
    expect(normalizePortalAuthIssuer('https://identity.example.com/')).toBe(
      'https://identity.example.com/'
    );
  });

  it('allows only GET/HEAD and marks the public configuration no-store', async () => {
    const getResponse = handlePortalAuthConfig(
      new Request('https://app.catalogoengine.com/api/auth/config'),
      env()
    );
    expect(getResponse.status).toBe(200);
    expect(getResponse.headers.get('cache-control')).toBe('no-store');
    expect(getResponse.headers.get('referrer-policy')).toBe('no-referrer');

    const postResponse = handlePortalAuthConfig(
      new Request('https://app.catalogoengine.com/api/auth/config', { method: 'POST' }),
      env()
    );
    expect(postResponse.status).toBe(405);
  });
});
