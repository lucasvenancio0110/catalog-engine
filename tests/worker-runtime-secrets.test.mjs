import { describe, expect, it } from 'vitest';
import {
  PORTAL_AUTH_RUNTIME_BINDINGS,
  buildWorkerRuntimeSecrets
} from '../scripts/build-worker-runtime-secrets.mjs';

const platform = {
  CLOUDFLARE_PLATFORM_ACCOUNT_ID: 'account-id',
  CLOUDFLARE_PLATFORM_API_TOKEN: 'platform-token'
};
const auth = {
  ADMIN_AUTH_ISSUER: 'https://tenant.example.auth0.com/',
  ADMIN_AUTH_AUDIENCE: 'https://api.catalogoengine.com',
  ADMIN_AUTH_JWKS_URL: 'https://tenant.example.auth0.com/.well-known/jwks.json',
  PORTAL_AUTH_CLIENT_ID: 'client-id'
};

describe('Worker runtime secret bundle', () => {
  it('keeps portal auth fail-closed when all four OIDC bindings are absent', () => {
    const result = buildWorkerRuntimeSecrets(platform);
    expect(result.portalAuthConfigured).toBe(false);
    expect(result.secrets).toEqual(platform);
    for (const name of PORTAL_AUTH_RUNTIME_BINDINGS) {
      expect(result.bindingNames).not.toContain(name);
    }
  });

  it('includes the complete OIDC set together with infrastructure secrets', () => {
    const result = buildWorkerRuntimeSecrets({ ...platform, ...auth });
    expect(result.portalAuthConfigured).toBe(true);
    expect(result.secrets).toEqual({ ...platform, ...auth });
    for (const name of PORTAL_AUTH_RUNTIME_BINDINGS) {
      expect(result.bindingNames).toContain(name);
    }
  });

  it('rejects every partial portal-auth configuration before deployment', () => {
    for (let count = 1; count < PORTAL_AUTH_RUNTIME_BINDINGS.length; count += 1) {
      const partial = Object.fromEntries(
        PORTAL_AUTH_RUNTIME_BINDINGS.slice(0, count).map((name) => [name, auth[name]])
      );
      expect(() => buildWorkerRuntimeSecrets({ ...platform, ...partial })).toThrow(
        'portal_auth_runtime_config_partial'
      );
    }
  });

  it('requires both Workers for Platforms infrastructure bindings', () => {
    expect(() =>
      buildWorkerRuntimeSecrets({ CLOUDFLARE_PLATFORM_ACCOUNT_ID: 'account-id' })
    ).toThrow('runtime_binding_missing:CLOUDFLARE_PLATFORM_API_TOKEN');
  });
});
