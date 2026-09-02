import { describe, expect, it } from 'vitest';
import {
  createPortalAuthAdapter,
  PortalAuthError,
  portalAuthInternals,
  validatePortalAuthConfig
} from '../src/app/auth/auth0-adapter.js';

class MemoryStorage {
  constructor(entries = {}) {
    this.values = new Map(Object.entries(entries));
  }

  getItem(key) {
    return this.values.has(key) ? this.values.get(key) : null;
  }

  setItem(key, value) {
    this.values.set(key, String(value));
  }

  removeItem(key) {
    this.values.delete(key);
  }
}

function authConfig() {
  return {
    auth: {
      provider: 'auth0',
      issuer: 'https://catalog-beta.us.auth0.com/',
      audience: 'https://api.catalogoengine.com',
      clientId: 'public_spa_client_id',
      scope: 'openid profile email offline_access'
    }
  };
}

function response(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

function browserFixture({ search = '', pathname = '/', storage = new MemoryStorage() } = {}) {
  const assigned = [];
  const replaced = [];
  const location = {
    origin: 'https://app.catalogoengine.com',
    pathname,
    search,
    hash: '',
    assign(value) {
      assigned.push(String(value));
    }
  };
  const windowRef = {
    location,
    sessionStorage: storage,
    history: {
      replaceState(_state, _title, value) {
        replaced.push(String(value));
      }
    }
  };
  return { windowRef, storage, assigned, replaced };
}

describe('portal Auth0 adapter', () => {
  it('rejects malformed public configuration before an OAuth redirect can start', () => {
    expect(() =>
      validatePortalAuthConfig({
        auth: { ...authConfig().auth, issuer: 'http://identity.example.com/' }
      })
    ).toThrowError(PortalAuthError);
  });

  it('starts Authorization Code + PKCE and never puts the verifier in the redirect URL', async () => {
    const browser = browserFixture({ pathname: '/lojas' });
    const adapter = createPortalAuthAdapter({
      windowRef: browser.windowRef,
      storage: browser.storage,
      cryptoImpl: crypto,
      fetchImpl: async () => response(authConfig())
    });

    await adapter.initialize();
    await adapter.login({ signup: true });

    expect(browser.assigned).toHaveLength(1);
    const redirect = new URL(browser.assigned[0]);
    expect(redirect.origin).toBe('https://catalog-beta.us.auth0.com');
    expect(redirect.pathname).toBe('/authorize');
    expect(redirect.searchParams.get('response_type')).toBe('code');
    expect(redirect.searchParams.get('audience')).toBe('https://api.catalogoengine.com');
    expect(redirect.searchParams.get('scope')).toContain('offline_access');
    expect(redirect.searchParams.get('code_challenge_method')).toBe('S256');
    expect(redirect.searchParams.get('code_challenge')).toBeTruthy();
    expect(redirect.searchParams.get('screen_hint')).toBe('signup');
    expect(redirect.searchParams.has('code_verifier')).toBe(false);

    const transaction = JSON.parse(browser.storage.getItem(portalAuthInternals.TRANSACTION_KEY));
    expect(transaction.state).toBe(redirect.searchParams.get('state'));
    expect(transaction.verifier).toBeTruthy();
    expect(transaction.returnTo).toBe('/lojas');
  });

  it('validates callback state, exchanges the code and restores the intended portal route', async () => {
    const storage = new MemoryStorage({
      [portalAuthInternals.TRANSACTION_KEY]: JSON.stringify({
        state: 'state-123',
        verifier: 'verifier-123',
        returnTo: '/lojas?tab=catalogo',
        createdAt: 1_800_000_000_000
      })
    });
    const browser = browserFixture({
      pathname: '/auth/callback',
      search: '?code=code-123&state=state-123',
      storage
    });
    const calls = [];
    const adapter = createPortalAuthAdapter({
      windowRef: browser.windowRef,
      storage,
      cryptoImpl: crypto,
      now: () => 1_800_000_010_000,
      fetchImpl: async (url, init = {}) => {
        calls.push({ url: String(url), init });
        if (String(url) === '/api/auth/config') return response(authConfig());
        return response({
          access_token: 'access-token-1',
          refresh_token: 'refresh-token-1',
          token_type: 'Bearer',
          expires_in: 3600
        });
      }
    });

    const status = await adapter.initialize();
    expect(status).toEqual({ configured: true, authenticated: true });
    expect(browser.replaced).toEqual(['/lojas?tab=catalogo']);
    expect(storage.getItem(portalAuthInternals.TRANSACTION_KEY)).toBeNull();
    expect(await adapter.getAccessToken()).toBe('access-token-1');

    const tokenCall = calls.find((call) => call.url.endsWith('/oauth/token'));
    expect(tokenCall).toBeTruthy();
    const body = new URLSearchParams(tokenCall.init.body);
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('code_verifier')).toBe('verifier-123');
    expect(body.get('redirect_uri')).toBe('https://app.catalogoengine.com/auth/callback');
  });

  it('fails closed on callback state mismatch without exchanging the code', async () => {
    const storage = new MemoryStorage({
      [portalAuthInternals.TRANSACTION_KEY]: JSON.stringify({
        state: 'expected',
        verifier: 'verifier',
        returnTo: '/',
        createdAt: 1_800_000_000_000
      })
    });
    const browser = browserFixture({
      pathname: '/auth/callback',
      search: '?code=code-123&state=attacker',
      storage
    });
    let tokenCalls = 0;
    const adapter = createPortalAuthAdapter({
      windowRef: browser.windowRef,
      storage,
      now: () => 1_800_000_010_000,
      fetchImpl: async (url) => {
        if (String(url) === '/api/auth/config') return response(authConfig());
        tokenCalls += 1;
        return response({});
      }
    });

    await expect(adapter.initialize()).rejects.toMatchObject({
      code: 'authentication_state_invalid'
    });
    expect(tokenCalls).toBe(0);
    expect(storage.getItem(portalAuthInternals.SESSION_KEY)).toBeNull();
  });

  it('refreshes an expired access token and requires refresh-token rotation', async () => {
    const now = 1_800_000_000_000;
    const storage = new MemoryStorage({
      [portalAuthInternals.SESSION_KEY]: JSON.stringify({
        accessToken: 'expired-access',
        refreshToken: 'refresh-old',
        expiresAt: now - 1
      })
    });
    const browser = browserFixture({ storage });
    const adapter = createPortalAuthAdapter({
      windowRef: browser.windowRef,
      storage,
      now: () => now,
      fetchImpl: async (url) => {
        if (String(url) === '/api/auth/config') return response(authConfig());
        return response({
          access_token: 'access-new',
          refresh_token: 'refresh-new',
          token_type: 'Bearer',
          expires_in: 1800
        });
      }
    });

    expect(await adapter.getAccessToken()).toBe('access-new');
    const saved = JSON.parse(storage.getItem(portalAuthInternals.SESSION_KEY));
    expect(saved.refreshToken).toBe('refresh-new');
    expect(saved.accessToken).toBe('access-new');
  });

  it('clears the browser session when the provider does not rotate the refresh token', async () => {
    const now = 1_800_000_000_000;
    const storage = new MemoryStorage({
      [portalAuthInternals.SESSION_KEY]: JSON.stringify({
        accessToken: 'expired-access',
        refreshToken: 'refresh-same',
        expiresAt: now - 1
      })
    });
    const browser = browserFixture({ storage });
    const adapter = createPortalAuthAdapter({
      windowRef: browser.windowRef,
      storage,
      now: () => now,
      fetchImpl: async (url) => {
        if (String(url) === '/api/auth/config') return response(authConfig());
        return response({
          access_token: 'access-new',
          refresh_token: 'refresh-same',
          token_type: 'Bearer',
          expires_in: 1800
        });
      }
    });

    await expect(adapter.getAccessToken()).rejects.toMatchObject({
      code: 'identity_provider_refresh_rotation_required'
    });
    expect(storage.getItem(portalAuthInternals.SESSION_KEY)).toBeNull();
  });

  it('never allows a cross-origin return target', async () => {
    const browser = browserFixture();
    const adapter = createPortalAuthAdapter({
      windowRef: browser.windowRef,
      storage: browser.storage,
      cryptoImpl: crypto,
      fetchImpl: async () => response(authConfig())
    });

    await adapter.login({ returnTo: 'https://evil.example/steal' });
    const transaction = JSON.parse(browser.storage.getItem(portalAuthInternals.TRANSACTION_KEY));
    expect(transaction.returnTo).toBe('/');
  });
});
