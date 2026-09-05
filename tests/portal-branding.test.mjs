import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { clearAdminAuthJwksCacheForTests } from '../worker/admin-auth.js';
import {
  BRANDING_LIMITS,
  handlePortalBrandingRequest,
  servePublicBrandAsset
} from '../worker/portal-branding.js';
import { accessibleTextColor, brandContrastRatio } from '../src/domain/brand-colors.js';

const encoder = new TextEncoder();
const issuer = 'https://identity.example.com';
const audience = 'catalog-engine-admin';
const jwksUrl = 'https://identity.example.com/.well-known/jwks.json';
const tenantId = 't_0123456789abcdefabcd';
const otherTenantId = 't_abcdef0123456789abcd';

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
  Object.assign(publicJwk, { kid: 'pb4-test-key', alg: 'RS256', use: 'sig' });
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT', kid: 'pb4-test-key' };
  const payload = {
    iss: issuer,
    aud: audience,
    sub: 'merchant-private-subject',
    iat: now - 5,
    exp: now + 3600
  };
  const signingInput = `${base64UrlJson(header)}.${base64UrlJson(payload)}`;
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    keys.privateKey,
    encoder.encode(signingInput)
  );
  return {
    token: `${signingInput}.${base64Url(new Uint8Array(signature))}`,
    jwks: new Response(JSON.stringify({ keys: [publicJwk] }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    })
  };
}

function profileRow() {
  return {
    tenant_id: tenantId,
    store_name: 'CROCCODILOS',
    logo_path: null,
    whatsapp: null,
    instagram: null,
    currency: 'BRL',
    theme_key: 'premium-dark',
    primary_color: '#8A7DFF',
    secondary_color: '#57D6A0',
    setup_status: 'configuring'
  };
}

function fakeDb({ allowTenant = tenantId } = {}) {
  const state = { profile: profileRow(), batches: [], assets: [] };
  const db = {
    prepare(sql) {
      const statement = {
        sql,
        args: [],
        bind(...args) {
          statement.args = args;
          return statement;
        },
        async first() {
          if (sql.includes('FROM tenant_memberships')) {
            return statement.args[0] === allowTenant ? { role: 'owner' } : null;
          }
          if (sql.includes('FROM tenant_store_profiles')) return state.profile;
          if (sql.includes('FROM catalog_theme_presets') && sql.includes('theme_key=?1')) {
            return ['premium-dark', 'stadium', 'clean'].includes(statement.args[0])
              ? { theme_key: statement.args[0] }
              : null;
          }
          if (sql.includes('FROM tenant_brand_assets') && sql.includes("asset_kind='logo'")) {
            return state.assets.find((asset) => asset.status === 'active') || null;
          }
          if (sql.includes('FROM tenant_brand_assets') && sql.includes('asset_id=?1')) {
            return (
              state.assets.find(
                (asset) => asset.asset_id === statement.args[0] && asset.status === 'active'
              ) || null
            );
          }
          throw new Error(`unexpected_first:${sql}`);
        },
        async all() {
          if (sql.includes('FROM catalog_theme_presets')) {
            return {
              results: [
                { theme_key: 'premium-dark', display_name: 'Premium Dark' },
                { theme_key: 'stadium', display_name: 'Stadium' },
                { theme_key: 'clean', display_name: 'Clean' }
              ]
            };
          }
          throw new Error(`unexpected_all:${sql}`);
        }
      };
      return statement;
    },
    async batch(statements) {
      state.batches.push(statements);
      for (const statement of statements) {
        if (
          statement.sql.includes('UPDATE tenant_store_profiles') &&
          statement.sql.includes('store_name=')
        ) {
          state.profile = {
            ...state.profile,
            store_name: statement.args[0],
            theme_key: statement.args[1],
            primary_color: statement.args[2],
            secondary_color: statement.args[3],
            whatsapp: statement.args[4],
            instagram: statement.args[5]
          };
        }
        if (statement.sql.includes('INSERT INTO tenant_brand_assets')) {
          state.assets.push({
            asset_id: statement.args[0],
            provider_asset_id: statement.args[2],
            public_path: statement.args[3],
            mime_type: 'image/webp',
            byte_size: statement.args[6],
            status: 'active'
          });
        }
        if (statement.sql.includes('SET logo_path=?1')) state.profile.logo_path = statement.args[0];
      }
      return statements.map(() => ({ success: true }));
    }
  };
  return { db, state };
}

function env(db, images) {
  return {
    CATALOG_DB: db,
    IMAGES: images,
    ADMIN_AUTH_ISSUER: issuer,
    ADMIN_AUTH_AUDIENCE: audience,
    ADMIN_AUTH_JWKS_URL: jwksUrl
  };
}

async function authenticatedRequest(path, token, options = {}) {
  return new Request(`https://app.catalogoengine.com${path}`, {
    ...options,
    headers: { authorization: `Bearer ${token}`, ...(options.headers || {}) }
  });
}

function acceptedImageService() {
  const upload = vi.fn(async () => ({ id: 'private-cloudflare-image-id' }));
  const outputResponse = () =>
    new Response(new Uint8Array([82, 73, 70, 70]), {
      status: 200,
      headers: { 'content-type': 'image/webp' }
    });
  const output = vi.fn(() => ({ response: outputResponse }));
  const transform = vi.fn(() => ({ output }));
  const input = vi.fn(() => ({ transform }));
  const info = vi
    .fn()
    .mockResolvedValueOnce({ format: 'png', width: 512, height: 256 })
    .mockResolvedValueOnce({ format: 'webp', width: 512, height: 256 });
  return { images: { info, input, hosted: { upload } }, upload, info, input, transform, output };
}

let auth;
beforeEach(async () => {
  clearAdminAuthJwksCacheForTests();
  auth = await authFixture();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url) => {
      if (String(url) === jwksUrl) return auth.jwks.clone();
      throw new Error('unexpected_fetch');
    })
  );
});

afterEach(() => vi.unstubAllGlobals());

describe('PB4 tenant branding boundary', () => {
  it('returns only tenant-owned safe branding state and active supported themes', async () => {
    const { db } = fakeDb();
    const response = await handlePortalBrandingRequest(
      await authenticatedRequest(`/api/admin/stores/${tenantId}/branding`, auth.token),
      env(db)
    );
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.profile).toMatchObject({
      tenantId,
      storeName: 'CROCCODILOS',
      themeKey: 'premium-dark',
      primaryColor: '#8A7DFF',
      primaryTextColor: '#000000'
    });
    expect(payload.themes.map((theme) => theme.key)).toEqual([
      'premium-dark',
      'stadium',
      'clean'
    ]);
    expect(JSON.stringify(payload)).not.toMatch(/provider_asset_id|cloudflare|database_id|runtime/i);
  });

  it('fails closed when the authenticated merchant requests another tenant branding state', async () => {
    const { db } = fakeDb();
    const response = await handlePortalBrandingRequest(
      await authenticatedRequest(`/api/admin/stores/${otherTenantId}/branding`, auth.token),
      env(db)
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'store_not_found' });
  });

  it('normalizes and persists controlled profile values without executable content', async () => {
    const { db, state } = fakeDb();
    const response = await handlePortalBrandingRequest(
      await authenticatedRequest(`/api/admin/stores/${tenantId}/branding`, auth.token, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          storeName: '  Croccodilos   Imports  ',
          themeKey: 'clean',
          primaryColor: '#123456',
          secondaryColor: '#abcdef',
          whatsapp: '+55 (41) 99999-9999',
          instagram: '@CROCCODILOS.LOJA'
        })
      }),
      env(db)
    );
    expect(response.status).toBe(200);
    expect((await response.json()).profile).toMatchObject({
      storeName: 'Croccodilos Imports',
      themeKey: 'clean',
      primaryColor: '#123456',
      secondaryColor: '#ABCDEF',
      whatsapp: '+5541999999999',
      instagram: 'croccodilos.loja'
    });
    expect(JSON.stringify(state.profile)).not.toMatch(/<script|javascript:|style=/i);
  });

  it('rejects SVG and oversized logos before provider storage', async () => {
    const { db } = fakeDb();
    const upload = vi.fn();
    const images = { hosted: { upload } };
    const svg = await handlePortalBrandingRequest(
      await authenticatedRequest(`/api/admin/stores/${tenantId}/branding/logo`, auth.token, {
        method: 'POST',
        headers: { 'content-type': 'image/svg+xml' },
        body: '<svg></svg>'
      }),
      env(db, images)
    );
    expect(svg.status).toBe(415);
    expect(await svg.json()).toEqual({ error: 'brand_asset_type_unsupported' });
    expect(upload).not.toHaveBeenCalled();

    const oversized = await handlePortalBrandingRequest(
      await authenticatedRequest(`/api/admin/stores/${tenantId}/branding/logo`, auth.token, {
        method: 'POST',
        headers: {
          'content-type': 'image/png',
          'content-length': String(BRANDING_LIMITS.maxLogoBytes + 1)
        },
        body: new Uint8Array([137, 80, 78, 71])
      }),
      env(db, images)
    );
    expect(oversized.status).toBe(413);
    expect(await oversized.json()).toEqual({ error: 'brand_asset_too_large' });
    expect(upload).not.toHaveBeenCalled();

    expect(BRANDING_LIMITS.acceptedLogoTypes).not.toContain('image/svg+xml');
    expect(BRANDING_LIMITS.maxLogoBytes).toBe(2_097_152);
  });

  it('normalizes and stores an accepted logo behind an opaque Catalog Engine path', async () => {
    const { db, state } = fakeDb();
    const service = acceptedImageService();
    const response = await handlePortalBrandingRequest(
      await authenticatedRequest(`/api/admin/stores/${tenantId}/branding/logo`, auth.token, {
        method: 'POST',
        headers: { 'content-type': 'image/png' },
        body: new Uint8Array([137, 80, 78, 71, 1, 2, 3, 4])
      }),
      env(db, service.images)
    );
    expect(response.status).toBe(201);
    const payload = await response.json();
    expect(payload.logo).toMatchObject({
      width: 512,
      height: 256,
      mimeType: 'image/webp'
    });
    expect(payload.logo.path).toMatch(/^\/brand-assets\/bas_[a-f0-9]{20}\.webp$/);
    expect(JSON.stringify(payload)).not.toContain('private-cloudflare-image-id');
    expect(service.info).toHaveBeenCalledTimes(2);
    expect(service.upload).toHaveBeenCalledTimes(1);
    expect(state.assets).toHaveLength(1);
    expect(state.assets[0].provider_asset_id).toBe('private-cloudflare-image-id');
    expect(state.profile.logo_path).toBe(payload.logo.path);
  });

  it('serves only active opaque public assets without exposing the provider locator', async () => {
    const { db, state } = fakeDb();
    state.assets.push({
      asset_id: 'bas_0123456789abcdefabcd',
      provider_asset_id: 'private-cloudflare-image-id',
      mime_type: 'image/webp',
      byte_size: 4,
      status: 'active'
    });
    const bytes = vi.fn(async () => new Blob([new Uint8Array([1, 2, 3, 4])]).stream());
    const images = { hosted: { image: vi.fn(() => ({ bytes })) } };
    const response = await servePublicBrandAsset(
      new Request('https://loja.example.com/brand-assets/bas_0123456789abcdefabcd.webp'),
      env(db, images)
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/webp');
    expect(response.headers.get('cache-control')).toContain('immutable');
    expect((await response.arrayBuffer()).byteLength).toBe(4);
    expect(response.headers.get('location')).toBeNull();
  });

  it('selects deterministic accessible text for merchant colors', () => {
    expect(accessibleTextColor('#FFFFFF')).toBe('#000000');
    expect(accessibleTextColor('#000000')).toBe('#FFFFFF');
    expect(brandContrastRatio('#FFFFFF', '#000000')).toBe(21);
    const selected = accessibleTextColor('#8A7DFF');
    expect(brandContrastRatio('#8A7DFF', selected)).toBeGreaterThanOrEqual(4.5);
  });
});
