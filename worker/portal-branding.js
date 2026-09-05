import { authenticateAdminRequest } from './admin-auth.js';
import { accessibleTextColor, normalizeBrandColor } from '../src/domain/brand-colors.js';

const TENANT_ID_PATTERN = /^t_[a-f0-9]{20}$/;
const BRAND_ASSET_ID_PATTERN = /^bas_[a-f0-9]{20}$/;
const MUTATING_ROLES = new Set(['owner', 'admin']);
const MAX_JSON_BODY_BYTES = 16_384;
const MAX_LOGO_BYTES = 2_097_152;
const MAX_LOGO_DIMENSION = 4096;
const MAX_LOGO_PIXELS = 16_777_216;
const LOGO_OUTPUT_DIMENSION = 1024;
const ACCEPTED_LOGO_TYPES = new Map([
  ['image/png', 'png'],
  ['image/jpeg', 'jpeg'],
  ['image/webp', 'webp']
]);

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer'
    }
  });
}

function brandingError(code, status) {
  return Object.assign(new Error(code), { code, status });
}

function publicError(error) {
  if (error?.status && error?.code) return json({ error: error.code }, error.status);
  console.error('portal_branding_failed', String(error?.message || error).slice(0, 120));
  return json({ error: 'branding_temporarily_unavailable' }, 503);
}

async function readJson(request) {
  const contentType = String(request.headers.get('content-type') || '').toLowerCase();
  if (!contentType.includes('application/json')) throw brandingError('json_body_required', 415);
  const declared = Number(request.headers.get('content-length') || 0);
  if (declared > MAX_JSON_BODY_BYTES) throw brandingError('request_body_too_large', 413);
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_JSON_BODY_BYTES) {
    throw brandingError('request_body_too_large', 413);
  }
  try {
    return JSON.parse(text || '{}');
  } catch {
    throw brandingError('invalid_json', 400);
  }
}

async function requireMembership(db, tenantId, principalId, { mutate = false } = {}) {
  if (!TENANT_ID_PATTERN.test(tenantId)) throw brandingError('store_not_found', 404);
  const membership = await db
    .prepare(
      `SELECT role
         FROM tenant_memberships
        WHERE tenant_id=?1 AND principal_id=?2 AND status='active'
        LIMIT 1`
    )
    .bind(tenantId, principalId)
    .first();
  if (!membership) throw brandingError('store_not_found', 404);
  if (mutate && !MUTATING_ROLES.has(membership.role)) {
    throw brandingError('insufficient_role', 403);
  }
  return membership;
}

function normalizeStoreName(value) {
  const name = String(value || '').trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 80) throw brandingError('branding_invalid_store_name', 400);
  return name;
}

function normalizeOptionalColor(value, code) {
  if (value == null || String(value).trim() === '') return null;
  const color = normalizeBrandColor(value);
  if (!color) throw brandingError(code, 400);
  return color;
}

function normalizeWhatsapp(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const compact = raw.replace(/[\s().-]/g, '');
  if (!/^\+[1-9]\d{7,14}$/.test(compact)) {
    throw brandingError('branding_invalid_whatsapp', 400);
  }
  return compact;
}

function normalizeInstagram(value) {
  const raw = String(value || '').trim().replace(/^@+/, '').toLowerCase();
  if (!raw) return null;
  if (!/^[a-z0-9._]{1,30}$/.test(raw)) {
    throw brandingError('branding_invalid_instagram', 400);
  }
  return raw;
}

function safeLogoPath(value) {
  const path = String(value || '').trim();
  return /^\/brand-assets\/bas_[a-f0-9]{20}\.webp$/.test(path) ? path : null;
}

function merchantProfile(row) {
  if (!row) return null;
  const primaryColor = normalizeBrandColor(row.primary_color);
  const secondaryColor = normalizeBrandColor(row.secondary_color);
  return {
    tenantId: row.tenant_id,
    storeName: row.store_name,
    themeKey: row.theme_key,
    currency: row.currency,
    primaryColor,
    secondaryColor,
    primaryTextColor: primaryColor ? accessibleTextColor(primaryColor) : null,
    secondaryTextColor: secondaryColor ? accessibleTextColor(secondaryColor) : null,
    whatsapp: row.whatsapp || null,
    instagram: row.instagram || null,
    logoPath: safeLogoPath(row.logo_path),
    setupStatus: row.setup_status || 'configuring'
  };
}

async function readProfile(db, tenantId) {
  return db
    .prepare(
      `SELECT tenant_id, store_name, logo_path, whatsapp, instagram, currency,
              theme_key, primary_color, secondary_color, setup_status
         FROM tenant_store_profiles
        WHERE tenant_id=?1
        LIMIT 1`
    )
    .bind(tenantId)
    .first();
}

async function activeThemes(db) {
  const result = await db
    .prepare(
      `SELECT theme_key, display_name
         FROM catalog_theme_presets
        WHERE status='active'
        ORDER BY CASE theme_key
          WHEN 'premium-dark' THEN 0
          WHEN 'stadium' THEN 1
          WHEN 'clean' THEN 2
          ELSE 3 END,
          display_name ASC`
    )
    .all();
  return (result.results || []).map((row) => ({
    key: String(row.theme_key),
    name: String(row.display_name)
  }));
}

async function requireActiveTheme(db, value) {
  const themeKey = String(value || '').trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,78}$/.test(themeKey)) {
    throw brandingError('branding_theme_unavailable', 400);
  }
  const theme = await db
    .prepare(
      `SELECT theme_key
         FROM catalog_theme_presets
        WHERE theme_key=?1 AND status='active'
        LIMIT 1`
    )
    .bind(themeKey)
    .first();
  if (!theme) throw brandingError('branding_theme_unavailable', 400);
  return themeKey;
}

async function saveProfile(db, tenantId, principalId, body) {
  const storeName = normalizeStoreName(body.storeName);
  const themeKey = await requireActiveTheme(db, body.themeKey);
  const primaryColor = normalizeOptionalColor(body.primaryColor, 'branding_invalid_primary_color');
  const secondaryColor = normalizeOptionalColor(
    body.secondaryColor,
    'branding_invalid_secondary_color'
  );
  const whatsapp = normalizeWhatsapp(body.whatsapp);
  const instagram = normalizeInstagram(body.instagram);

  await db.batch([
    db
      .prepare(
        `UPDATE tenant_store_profiles
            SET store_name=?1,
                theme_key=?2,
                primary_color=?3,
                secondary_color=?4,
                whatsapp=?5,
                instagram=?6,
                setup_status=CASE WHEN setup_status='draft' THEN 'configuring' ELSE setup_status END,
                updated_at=CURRENT_TIMESTAMP
          WHERE tenant_id=?7`
      )
      .bind(storeName, themeKey, primaryColor, secondaryColor, whatsapp, instagram, tenantId),
    db
      .prepare(
        `UPDATE catalog_tenants
            SET display_name=?1, updated_at=CURRENT_TIMESTAMP
          WHERE tenant_id=?2`
      )
      .bind(storeName, tenantId),
    db
      .prepare(
        `INSERT INTO tenant_audit_log
          (tenant_id, principal_id, action, target_type, target_id, metadata_json, created_at)
         VALUES (?1, ?2, 'tenant.branding.updated', 'store_profile', ?1, ?3, CURRENT_TIMESTAMP)`
      )
      .bind(
        tenantId,
        principalId,
        JSON.stringify({ themeKey, hasPrimaryColor: Boolean(primaryColor), hasSecondaryColor: Boolean(secondaryColor), hasWhatsapp: Boolean(whatsapp), hasInstagram: Boolean(instagram) })
      )
  ]);

  return merchantProfile(await readProfile(db, tenantId));
}

function randomAssetId() {
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  return `bas_${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

function normalizedDecodedFormat(value) {
  const raw = String(value || '').trim().toLowerCase().replace(/^image\//, '');
  return raw === 'jpg' ? 'jpeg' : raw;
}

async function logoBytes(request) {
  const contentType = String(request.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  const expectedFormat = ACCEPTED_LOGO_TYPES.get(contentType);
  if (!expectedFormat) throw brandingError('brand_asset_type_unsupported', 415);
  const declared = Number(request.headers.get('content-length') || 0);
  if (declared > MAX_LOGO_BYTES) throw brandingError('brand_asset_too_large', 413);
  const bytes = await request.arrayBuffer();
  if (!bytes.byteLength || bytes.byteLength > MAX_LOGO_BYTES) {
    throw brandingError(bytes.byteLength ? 'brand_asset_too_large' : 'brand_asset_invalid_image', bytes.byteLength ? 413 : 400);
  }
  return { bytes, contentType, expectedFormat };
}

async function inspectAndNormalizeLogo(env, request) {
  const input = await logoBytes(request);
  if (!env.IMAGES?.info || !env.IMAGES?.input || !env.IMAGES?.hosted?.upload) {
    throw brandingError('brand_assets_unavailable', 503);
  }
  let info;
  try {
    info = await env.IMAGES.info(new Blob([input.bytes]).stream());
  } catch {
    throw brandingError('brand_asset_invalid_image', 400);
  }
  const decodedFormat = normalizedDecodedFormat(info?.format);
  if (!ACCEPTED_LOGO_TYPES.has(`image/${decodedFormat}`) || decodedFormat !== input.expectedFormat) {
    throw brandingError('brand_asset_invalid_image', 400);
  }
  const width = Number(info?.width || 0);
  const height = Number(info?.height || 0);
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 32 ||
    height < 32 ||
    width > MAX_LOGO_DIMENSION ||
    height > MAX_LOGO_DIMENSION ||
    width * height > MAX_LOGO_PIXELS
  ) {
    throw brandingError('brand_asset_dimensions_invalid', 400);
  }

  let response;
  try {
    const output = await env.IMAGES.input(new Blob([input.bytes]).stream())
      .transform({ width: LOGO_OUTPUT_DIMENSION, height: LOGO_OUTPUT_DIMENSION, fit: 'scale-down' })
      .output({ format: 'image/webp', quality: 88, anim: false });
    response = output.response();
  } catch {
    throw brandingError('brand_asset_invalid_image', 400);
  }
  if (!response?.ok) throw brandingError('brand_asset_invalid_image', 400);
  const normalized = await response.arrayBuffer();
  if (!normalized.byteLength || normalized.byteLength > MAX_LOGO_BYTES) {
    throw brandingError('brand_asset_too_large', 413);
  }
  let normalizedInfo;
  try {
    normalizedInfo = await env.IMAGES.info(new Blob([normalized]).stream());
  } catch {
    throw brandingError('brand_asset_invalid_image', 400);
  }
  return {
    bytes: normalized,
    width: Number(normalizedInfo?.width || width),
    height: Number(normalizedInfo?.height || height),
    mimeType: 'image/webp'
  };
}

async function uploadLogo(db, env, tenantId, principalId, request) {
  const normalized = await inspectAndNormalizeLogo(env, request);
  const assetId = randomAssetId();
  const publicPath = `/brand-assets/${assetId}.webp`;
  const previous = await db
    .prepare(
      `SELECT asset_id, provider_asset_id
         FROM tenant_brand_assets
        WHERE tenant_id=?1 AND asset_kind='logo' AND status='active'
        LIMIT 1`
    )
    .bind(tenantId)
    .first();

  let hosted;
  try {
    hosted = await env.IMAGES.hosted.upload(new Blob([normalized.bytes]).stream(), {
      filename: `${assetId}.webp`,
      metadata: { catalogEngineAsset: assetId, tenantId, kind: 'logo' },
      requireSignedURLs: false
    });
  } catch {
    throw brandingError('brand_asset_storage_failed', 503);
  }
  const providerAssetId = String(hosted?.id || '').trim();
  if (!providerAssetId) throw brandingError('brand_asset_storage_failed', 503);

  try {
    const statements = [];
    if (previous?.asset_id) {
      statements.push(
        db
          .prepare(
            `UPDATE tenant_brand_assets
                SET status='replaced', updated_at=CURRENT_TIMESTAMP
              WHERE asset_id=?1 AND tenant_id=?2 AND status='active'`
          )
          .bind(previous.asset_id, tenantId)
      );
    }
    statements.push(
      db
        .prepare(
          `INSERT INTO tenant_brand_assets
            (asset_id, tenant_id, asset_kind, provider, provider_asset_id, public_path,
             mime_type, width, height, byte_size, status, created_by_principal_id, created_at, updated_at)
           VALUES (?1, ?2, 'logo', 'cloudflare_images', ?3, ?4,
                   'image/webp', ?5, ?6, ?7, 'active', ?8, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
        )
        .bind(
          assetId,
          tenantId,
          providerAssetId,
          publicPath,
          normalized.width,
          normalized.height,
          normalized.bytes.byteLength,
          principalId
        )
    );
    statements.push(
      db
        .prepare(
          `UPDATE tenant_store_profiles
              SET logo_path=?1, updated_at=CURRENT_TIMESTAMP
            WHERE tenant_id=?2`
        )
        .bind(publicPath, tenantId)
    );
    statements.push(
      db
        .prepare(
          `INSERT INTO tenant_audit_log
            (tenant_id, principal_id, action, target_type, target_id, metadata_json, created_at)
           VALUES (?1, ?2, 'tenant.branding.logo.updated', 'brand_asset', ?3, ?4, CURRENT_TIMESTAMP)`
        )
        .bind(
          tenantId,
          principalId,
          assetId,
          JSON.stringify({ mimeType: 'image/webp', width: normalized.width, height: normalized.height })
        )
    );
    await db.batch(statements);
  } catch (error) {
    try {
      await env.IMAGES.hosted.image(providerAssetId).delete();
    } catch {
      // The DB remains authoritative. Orphan cleanup is operational follow-up only.
    }
    throw error;
  }

  if (previous?.provider_asset_id) {
    try {
      await env.IMAGES.hosted.image(previous.provider_asset_id).delete();
    } catch {
      // Replaced provider bytes are no longer addressable through Catalog Engine.
    }
  }

  return {
    path: publicPath,
    width: normalized.width,
    height: normalized.height,
    mimeType: 'image/webp'
  };
}

async function deleteLogo(db, env, tenantId, principalId) {
  const current = await db
    .prepare(
      `SELECT asset_id, provider_asset_id
         FROM tenant_brand_assets
        WHERE tenant_id=?1 AND asset_kind='logo' AND status='active'
        LIMIT 1`
    )
    .bind(tenantId)
    .first();
  if (!current) return { path: null };

  await db.batch([
    db
      .prepare(
        `UPDATE tenant_brand_assets
            SET status='deleted', updated_at=CURRENT_TIMESTAMP
          WHERE asset_id=?1 AND tenant_id=?2 AND status='active'`
      )
      .bind(current.asset_id, tenantId),
    db
      .prepare(
        `UPDATE tenant_store_profiles
            SET logo_path=NULL, updated_at=CURRENT_TIMESTAMP
          WHERE tenant_id=?1`
      )
      .bind(tenantId),
    db
      .prepare(
        `INSERT INTO tenant_audit_log
          (tenant_id, principal_id, action, target_type, target_id, metadata_json, created_at)
         VALUES (?1, ?2, 'tenant.branding.logo.removed', 'brand_asset', ?3, '{}', CURRENT_TIMESTAMP)`
      )
      .bind(tenantId, principalId, current.asset_id)
  ]);

  try {
    await env.IMAGES?.hosted?.image(current.provider_asset_id).delete();
  } catch {
    // Public access is already revoked by D1 status/profile state.
  }
  return { path: null };
}

export async function handlePortalBrandingRequest(request, env) {
  try {
    if (!env.CATALOG_DB) throw brandingError('control_plane_database_unbound', 503);
    const auth = await authenticateAdminRequest(request, env);
    const url = new URL(request.url);
    const match = url.pathname.match(
      /^\/api\/admin\/stores\/(t_[a-f0-9]{20})\/branding(?:\/(logo))?$/
    );
    if (!match) return null;
    const tenantId = match[1];
    const logoRoute = match[2] === 'logo';

    if (logoRoute && request.method === 'POST') {
      await requireMembership(env.CATALOG_DB, tenantId, auth.principalId, { mutate: true });
      const logo = await uploadLogo(env.CATALOG_DB, env, tenantId, auth.principalId, request);
      return json({ logo }, 201);
    }
    if (logoRoute && request.method === 'DELETE') {
      await requireMembership(env.CATALOG_DB, tenantId, auth.principalId, { mutate: true });
      return json({ logo: await deleteLogo(env.CATALOG_DB, env, tenantId, auth.principalId) });
    }
    if (!logoRoute && request.method === 'GET') {
      await requireMembership(env.CATALOG_DB, tenantId, auth.principalId);
      const profile = merchantProfile(await readProfile(env.CATALOG_DB, tenantId));
      if (!profile) throw brandingError('store_not_found', 404);
      return json({ profile, themes: await activeThemes(env.CATALOG_DB) });
    }
    if (!logoRoute && request.method === 'PUT') {
      await requireMembership(env.CATALOG_DB, tenantId, auth.principalId, { mutate: true });
      const body = await readJson(request);
      const profile = await saveProfile(env.CATALOG_DB, tenantId, auth.principalId, body);
      if (!profile) throw brandingError('store_not_found', 404);
      return json({ profile });
    }
    return json({ error: 'method_not_allowed' }, 405);
  } catch (error) {
    return publicError(error);
  }
}

export async function servePublicBrandAsset(request, env) {
  const url = new URL(request.url);
  const match = url.pathname.match(/^\/brand-assets\/(bas_[a-f0-9]{20})\.webp$/);
  if (!match) return null;
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('method_not_allowed', { status: 405 });
  }
  if (!env.CATALOG_DB || !env.IMAGES?.hosted?.image) {
    return new Response('brand_asset_unavailable', { status: 503 });
  }
  const assetId = match[1];
  if (!BRAND_ASSET_ID_PATTERN.test(assetId)) return new Response('not_found', { status: 404 });
  let row;
  try {
    row = await env.CATALOG_DB.prepare(
      `SELECT provider_asset_id, mime_type, byte_size
         FROM tenant_brand_assets
        WHERE asset_id=?1 AND status='active'
        LIMIT 1`
    )
      .bind(assetId)
      .first();
  } catch {
    return new Response('brand_asset_unavailable', { status: 503 });
  }
  if (!row) return new Response('not_found', { status: 404 });
  const headers = new Headers({
    'content-type': row.mime_type || 'image/webp',
    'cache-control': 'public, max-age=31536000, immutable',
    'x-content-type-options': 'nosniff',
    etag: `\"${assetId}\"`
  });
  if (Number(row.byte_size) > 0) headers.set('content-length', String(Number(row.byte_size)));
  if (request.method === 'HEAD') return new Response(null, { status: 200, headers });
  let bytes;
  try {
    bytes = await env.IMAGES.hosted.image(row.provider_asset_id).bytes();
  } catch {
    return new Response('brand_asset_unavailable', { status: 503 });
  }
  if (!bytes) return new Response('not_found', { status: 404 });
  return new Response(bytes, { status: 200, headers });
}

export const BRANDING_LIMITS = Object.freeze({
  maxLogoBytes: MAX_LOGO_BYTES,
  maxLogoDimension: MAX_LOGO_DIMENSION,
  acceptedLogoTypes: [...ACCEPTED_LOGO_TYPES.keys()]
});
