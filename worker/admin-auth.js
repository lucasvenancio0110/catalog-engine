import { stablePrincipalId } from './runtime-identity.js';

const encoder = new TextEncoder();
const jwksCache = new Map();
const DEFAULT_JWKS_TTL_MS = 5 * 60 * 1000;
const MAX_TOKEN_LENGTH = 16_384;
const CLOCK_SKEW_SECONDS = 60;

export class AdminAuthError extends Error {
  constructor(code, status = 401) {
    super(code);
    this.name = 'AdminAuthError';
    this.code = code;
    this.status = status;
  }
}

function requiredConfig(env) {
  const issuer = String(env.ADMIN_AUTH_ISSUER || '').trim();
  const jwksUrl = String(env.ADMIN_AUTH_JWKS_URL || '').trim();
  const audiences = String(env.ADMIN_AUTH_AUDIENCE || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  if (!issuer || !jwksUrl || audiences.length === 0) {
    throw new AdminAuthError('admin_auth_unconfigured', 503);
  }

  let parsedJwksUrl;
  try {
    parsedJwksUrl = new URL(jwksUrl);
  } catch {
    throw new AdminAuthError('admin_auth_misconfigured', 503);
  }
  if (parsedJwksUrl.protocol !== 'https:') {
    throw new AdminAuthError('admin_auth_misconfigured', 503);
  }

  return { issuer, jwksUrl: parsedJwksUrl.href, audiences };
}

function base64UrlToBytes(value) {
  const normalized = String(value).replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  let binary;
  try {
    binary = atob(padded);
  } catch {
    throw new AdminAuthError('invalid_access_token');
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function decodeJsonSegment(segment) {
  try {
    return JSON.parse(new TextDecoder().decode(base64UrlToBytes(segment)));
  } catch (error) {
    if (error instanceof AdminAuthError) throw error;
    throw new AdminAuthError('invalid_access_token');
  }
}

function bearerToken(request) {
  const authorization = request.headers.get('authorization') || '';
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) throw new AdminAuthError('authentication_required');
  const token = match[1].trim();
  if (!token || token.length > MAX_TOKEN_LENGTH) throw new AdminAuthError('invalid_access_token');
  return token;
}

function parseJwt(token) {
  const parts = token.split('.');
  if (parts.length !== 3 || parts.some((part) => !part)) {
    throw new AdminAuthError('invalid_access_token');
  }
  const header = decodeJsonSegment(parts[0]);
  const payload = decodeJsonSegment(parts[1]);
  if (header.alg !== 'RS256' || typeof header.kid !== 'string' || !header.kid) {
    throw new AdminAuthError('unsupported_access_token');
  }
  return {
    header,
    payload,
    signature: base64UrlToBytes(parts[2]),
    signingInput: encoder.encode(`${parts[0]}.${parts[1]}`)
  };
}

async function loadJwks(config, fetchImpl, force = false) {
  const now = Date.now();
  const cached = jwksCache.get(config.jwksUrl);
  if (!force && cached && cached.expiresAt > now) return cached.keys;

  let response;
  try {
    response = await fetchImpl(config.jwksUrl, {
      method: 'GET',
      headers: { accept: 'application/json' }
    });
  } catch {
    throw new AdminAuthError('identity_provider_unavailable', 503);
  }
  if (!response.ok) throw new AdminAuthError('identity_provider_unavailable', 503);

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new AdminAuthError('identity_provider_invalid_jwks', 503);
  }
  const keys = Array.isArray(payload?.keys) ? payload.keys.slice(0, 50) : [];
  if (!keys.length) throw new AdminAuthError('identity_provider_invalid_jwks', 503);
  jwksCache.set(config.jwksUrl, { keys, expiresAt: now + DEFAULT_JWKS_TTL_MS });
  return keys;
}

function usableSigningKey(keys, header) {
  return keys.find(
    (key) =>
      key &&
      key.kid === header.kid &&
      key.kty === 'RSA' &&
      (!key.use || key.use === 'sig') &&
      (!key.alg || key.alg === 'RS256')
  );
}

async function signingKey(config, header, fetchImpl) {
  let keys = await loadJwks(config, fetchImpl, false);
  let jwk = usableSigningKey(keys, header);
  if (!jwk) {
    keys = await loadJwks(config, fetchImpl, true);
    jwk = usableSigningKey(keys, header);
  }
  if (!jwk) throw new AdminAuthError('unknown_signing_key');

  try {
    return await crypto.subtle.importKey(
      'jwk',
      jwk,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify']
    );
  } catch {
    throw new AdminAuthError('invalid_signing_key', 503);
  }
}

function hasExpectedAudience(claim, expected) {
  const values = Array.isArray(claim) ? claim : [claim];
  return values.some((value) => typeof value === 'string' && expected.includes(value));
}

function validateClaims(payload, config, nowSeconds) {
  if (!payload || typeof payload !== 'object') throw new AdminAuthError('invalid_access_token');
  if (payload.iss !== config.issuer) throw new AdminAuthError('invalid_token_issuer');
  if (!hasExpectedAudience(payload.aud, config.audiences)) {
    throw new AdminAuthError('invalid_token_audience');
  }
  if (typeof payload.sub !== 'string' || !payload.sub.trim()) {
    throw new AdminAuthError('invalid_token_subject');
  }
  if (!Number.isFinite(payload.exp) || payload.exp < nowSeconds - CLOCK_SKEW_SECONDS) {
    throw new AdminAuthError('access_token_expired');
  }
  if (Number.isFinite(payload.nbf) && payload.nbf > nowSeconds + CLOCK_SKEW_SECONDS) {
    throw new AdminAuthError('access_token_not_active');
  }
  if (Number.isFinite(payload.iat) && payload.iat > nowSeconds + 300) {
    throw new AdminAuthError('invalid_access_token');
  }
}

export async function authenticateAdminRequest(
  request,
  env,
  { fetchImpl = fetch, now = () => Date.now() } = {}
) {
  const config = requiredConfig(env);
  const token = bearerToken(request);
  const parsed = parseJwt(token);
  const key = await signingKey(config, parsed.header, fetchImpl);

  let verified = false;
  try {
    verified = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      key,
      parsed.signature,
      parsed.signingInput
    );
  } catch {
    verified = false;
  }
  if (!verified) throw new AdminAuthError('invalid_access_token');

  const nowSeconds = Math.floor(now() / 1000);
  validateClaims(parsed.payload, config, nowSeconds);
  const principalId = await stablePrincipalId(config.issuer, parsed.payload.sub.trim());

  return {
    principalId,
    expiresAt: Number(parsed.payload.exp),
    issuer: config.issuer
  };
}

export function clearAdminAuthJwksCacheForTests() {
  jwksCache.clear();
}
