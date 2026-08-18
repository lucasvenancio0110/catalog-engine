import { beforeEach, describe, expect, it } from 'vitest';
import {
  AdminAuthError,
  authenticateAdminRequest,
  clearAdminAuthJwksCacheForTests
} from '../worker/admin-auth.js';

const encoder = new TextEncoder();
const issuer = 'https://identity.example.com';
const audience = 'catalog-engine-admin';
const jwksUrl = 'https://identity.example.com/.well-known/jwks.json';

function base64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlJson(value) {
  return base64Url(encoder.encode(JSON.stringify(value)));
}

async function authFixture() {
  const keys = await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256'
    },
    true,
    ['sign', 'verify']
  );
  const publicJwk = await crypto.subtle.exportKey('jwk', keys.publicKey);
  Object.assign(publicJwk, { kid: 'test-key-1', alg: 'RS256', use: 'sig' });

  const issueToken = async (overrides = {}) => {
    const now = 1_800_000_000;
    const header = { alg: 'RS256', typ: 'JWT', kid: 'test-key-1' };
    const payload = {
      iss: issuer,
      aud: audience,
      sub: 'user_very_private_subject',
      iat: now - 5,
      exp: now + 3600,
      ...overrides
    };
    const signingInput = `${base64UrlJson(header)}.${base64UrlJson(payload)}`;
    const signature = await crypto.subtle.sign(
      'RSASSA-PKCS1-v1_5',
      keys.privateKey,
      encoder.encode(signingInput)
    );
    return `${signingInput}.${base64Url(new Uint8Array(signature))}`;
  };

  const fetchImpl = async () =>
    new Response(JSON.stringify({ keys: [publicJwk] }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });

  return { issueToken, fetchImpl };
}

function authEnv(overrides = {}) {
  return {
    ADMIN_AUTH_ISSUER: issuer,
    ADMIN_AUTH_AUDIENCE: audience,
    ADMIN_AUTH_JWKS_URL: jwksUrl,
    ...overrides
  };
}

beforeEach(() => clearAdminAuthJwksCacheForTests());

describe('admin OIDC authentication', () => {
  it('verifies an RS256 token and converts the external subject into an opaque principal id', async () => {
    const fixture = await authFixture();
    const token = await fixture.issueToken();
    const auth = await authenticateAdminRequest(
      new Request('https://catalog.example/api/admin/session', {
        headers: { authorization: `Bearer ${token}` }
      }),
      authEnv(),
      { fetchImpl: fixture.fetchImpl, now: () => 1_800_000_000_000 }
    );

    expect(auth.principalId).toMatch(/^prn_[a-f0-9]{20}$/);
    expect(auth.principalId).not.toContain('user_very_private_subject');
    expect(auth.expiresAt).toBe(1_800_003_600);
    expect(auth.issuer).toBe(issuer);
  });

  it('rejects requests without a bearer token', async () => {
    await expect(
      authenticateAdminRequest(new Request('https://catalog.example/api/admin/session'), authEnv())
    ).rejects.toMatchObject({
      name: 'AdminAuthError',
      code: 'authentication_required',
      status: 401
    });
  });

  it('rejects a token issued for a different audience even when the signature is valid', async () => {
    const fixture = await authFixture();
    const token = await fixture.issueToken({ aud: 'other-application' });
    await expect(
      authenticateAdminRequest(
        new Request('https://catalog.example/api/admin/session', {
          headers: { authorization: `Bearer ${token}` }
        }),
        authEnv(),
        { fetchImpl: fixture.fetchImpl, now: () => 1_800_000_000_000 }
      )
    ).rejects.toMatchObject({ code: 'invalid_token_audience', status: 401 });
  });

  it('rejects expired tokens', async () => {
    const fixture = await authFixture();
    const token = await fixture.issueToken({ exp: 1_799_999_000 });
    await expect(
      authenticateAdminRequest(
        new Request('https://catalog.example/api/admin/session', {
          headers: { authorization: `Bearer ${token}` }
        }),
        authEnv(),
        { fetchImpl: fixture.fetchImpl, now: () => 1_800_000_000_000 }
      )
    ).rejects.toMatchObject({ code: 'access_token_expired', status: 401 });
  });

  it('fails closed when production authentication is not configured', async () => {
    await expect(
      authenticateAdminRequest(
        new Request('https://catalog.example/api/admin/session', {
          headers: { authorization: 'Bearer anything' }
        }),
        {}
      )
    ).rejects.toBeInstanceOf(AdminAuthError);
    await expect(
      authenticateAdminRequest(
        new Request('https://catalog.example/api/admin/session', {
          headers: { authorization: 'Bearer anything' }
        }),
        {}
      )
    ).rejects.toMatchObject({ code: 'admin_auth_unconfigured', status: 503 });
  });
});
