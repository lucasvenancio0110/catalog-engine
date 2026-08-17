const DEFAULT_TENANT_ID = 't_00000000000000000001';
const SAFE_THEME = /^[a-z0-9][a-z0-9-]{0,63}$/;
const SAFE_CURRENCY = /^[A-Z]{3}$/;
const SAFE_COLOR = /^#[0-9a-f]{6}$/i;
const SAFE_LOGO_PATH = /^\/(?!\/)[^\s]{1,239}$/;
const SAFE_HOME_SECTIONS = new Set([
  'new-arrivals',
  'clubs',
  'national-teams',
  'leagues',
  'categories',
  'retro',
  'training',
  'featured'
]);

export function resolveTenantId(env = {}) {
  const value = String(env.TENANT_ID || DEFAULT_TENANT_ID);
  return /^t_[a-f0-9]{20}$/.test(value) ? value : DEFAULT_TENANT_ID;
}

function parseHomeSections(value) {
  try {
    const parsed = JSON.parse(value || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item, index) => SAFE_HOME_SECTIONS.has(item) && parsed.indexOf(item) === index).slice(0, 8);
  } catch {
    return [];
  }
}

export function publicStoreFromRow(row) {
  if (!row) return null;
  const name = String(row.store_name || '').trim().slice(0, 80);
  if (!name) return null;
  const theme = String(row.theme_key || '').trim();
  const currency = String(row.currency || '').trim().toUpperCase();
  const logo = String(row.logo_path || '').trim();
  const primaryColor = String(row.primary_color || '').trim();
  const secondaryColor = String(row.secondary_color || '').trim();
  return {
    name,
    logo: SAFE_LOGO_PATH.test(logo) ? logo : '',
    whatsapp: String(row.whatsapp || '').replace(/\D+/g, '').slice(0, 15),
    instagram: String(row.instagram || '').trim().replace(/^@?/, '@').slice(0, 31),
    theme: SAFE_THEME.test(theme) ? theme : 'premium-dark',
    currency: SAFE_CURRENCY.test(currency) ? currency : 'BRL',
    primaryColor: SAFE_COLOR.test(primaryColor) ? primaryColor : null,
    secondaryColor: SAFE_COLOR.test(secondaryColor) ? secondaryColor : null,
    homeSections: parseHomeSections(row.home_sections_json)
  };
}

export async function readTenantStore(env) {
  if (!env.CATALOG_DB) return { state: 'unbound', tenantId: resolveTenantId(env), store: null };
  const tenantId = resolveTenantId(env);
  const row = await env.CATALOG_DB.prepare(
    `SELECT store_name, logo_path, whatsapp, instagram, currency, theme_key,
            primary_color, secondary_color, home_sections_json
       FROM tenant_store_profiles
      WHERE tenant_id = ?1 AND setup_status = 'published'
      LIMIT 1`
  ).bind(tenantId).first();
  return { state: row ? 'found' : 'missing', tenantId, store: publicStoreFromRow(row) };
}
