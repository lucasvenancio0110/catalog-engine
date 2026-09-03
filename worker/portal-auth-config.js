const PORTAL_AUTH_PROVIDER = 'auth0';
const DEFAULT_SCOPE = 'openid profile email offline_access';
const MAX_CLIENT_ID_LENGTH = 256;
const MAX_AUDIENCE_LENGTH = 512;

function boundedText(value, maximum) {
  const normalized = String(value || '').trim();
  if (!normalized || normalized.length > maximum) return '';
  if (/\s/.test(normalized)) return '';
  return normalized;
}

function normalizePortalAuthAudience(value) {
  const audiences = String(value || '')
    .split(',')
    .map((candidate) => candidate.trim())
    .filter(Boolean);

  if (audiences.length !== 1) return '';
  return boundedText(audiences[0], MAX_AUDIENCE_LENGTH);
}

export function normalizePortalAuthIssuer(value) {
  const raw = String(value || '').trim();
  if (!raw || raw.length > 512) return '';

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return '';
  }

  if (
    parsed.protocol !== 'https:' ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    (parsed.pathname && parsed.pathname !== '/')
  ) {
    return '';
  }

  return `${parsed.origin}/`;
}

export function buildPortalAuthConfig(env = {}) {
  const issuer = normalizePortalAuthIssuer(env.ADMIN_AUTH_ISSUER);
  const audience = normalizePortalAuthAudience(env.ADMIN_AUTH_AUDIENCE);
  const clientId = boundedText(env.PORTAL_AUTH_CLIENT_ID, MAX_CLIENT_ID_LENGTH);

  if (!issuer || !audience || !clientId) return null;

  return {
    provider: PORTAL_AUTH_PROVIDER,
    issuer,
    audience,
    clientId,
    scope: DEFAULT_SCOPE
  };
}

function authJson(payload, status = 200, method = 'GET') {
  const headers = new Headers({
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff'
  });
  return new Response(method === 'HEAD' ? null : JSON.stringify(payload), { status, headers });
}

export function handlePortalAuthConfig(request, env) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return authJson({ error: 'method_not_allowed' }, 405, request.method);
  }

  const config = buildPortalAuthConfig(env);
  if (!config) {
    return authJson({ error: 'portal_auth_unconfigured' }, 503, request.method);
  }

  return authJson({ auth: config }, 200, request.method);
}
