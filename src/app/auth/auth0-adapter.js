const CONFIG_ENDPOINT = '/api/auth/config';
const TRANSACTION_KEY = 'ce.portal.auth.transaction.v1';
const SESSION_KEY = 'ce.portal.auth.session.v1';
const TRANSACTION_TTL_MS = 10 * 60 * 1000;
const TOKEN_CLOCK_SKEW_MS = 60 * 1000;
const MAX_TOKEN_LENGTH = 32_768;
const MAX_RETURN_TO_LENGTH = 1_024;

export class PortalAuthError extends Error {
  constructor(code, options = {}) {
    super(code);
    this.name = 'PortalAuthError';
    this.code = code;
    this.status = options.status || 0;
    this.cause = options.cause;
  }
}

function base64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function randomUrlToken(cryptoImpl, byteLength = 32) {
  const bytes = new Uint8Array(byteLength);
  cryptoImpl.getRandomValues(bytes);
  return base64Url(bytes);
}

async function codeChallenge(verifier, cryptoImpl) {
  const digest = await cryptoImpl.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}

function safeReturnTo(value, locationRef) {
  const raw = String(value || '').trim();
  if (!raw || raw.length > MAX_RETURN_TO_LENGTH) return '/';
  try {
    const resolved = new URL(raw, locationRef.origin);
    if (resolved.origin !== locationRef.origin) return '/';
    if (resolved.pathname === '/auth/callback') return '/';
    return `${resolved.pathname}${resolved.search}${resolved.hash}` || '/';
  } catch {
    return '/';
  }
}

function callbackUri(locationRef) {
  return `${locationRef.origin}/auth/callback`;
}

function issuerEndpoint(issuer, pathname) {
  const base = new URL(issuer);
  return new URL(pathname.replace(/^\//, ''), base).toString();
}

function readJson(storage, key) {
  const value = storage.getItem(key);
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    storage.removeItem(key);
    return null;
  }
}

function writeJson(storage, key, value) {
  storage.setItem(key, JSON.stringify(value));
}

function safeToken(value) {
  const token = String(value || '');
  return token && token.length <= MAX_TOKEN_LENGTH ? token : '';
}

function normalizeTokenPayload(payload, nowMs, previousRefreshToken = '') {
  const accessToken = safeToken(payload?.access_token);
  const refreshToken = safeToken(payload?.refresh_token);
  const tokenType = String(payload?.token_type || '').toLowerCase();
  const expiresIn = Number(payload?.expires_in);

  if (!accessToken || tokenType !== 'bearer' || !Number.isFinite(expiresIn) || expiresIn <= 0) {
    throw new PortalAuthError('identity_provider_invalid_token_response');
  }

  if (!refreshToken) throw new PortalAuthError('identity_provider_refresh_token_missing');
  if (previousRefreshToken && refreshToken === previousRefreshToken) {
    throw new PortalAuthError('identity_provider_refresh_rotation_required');
  }

  return {
    accessToken,
    refreshToken,
    expiresAt: nowMs + Math.min(expiresIn, 7 * 24 * 60 * 60) * 1000
  };
}

async function tokenRequest(fetchImpl, endpoint, parameters) {
  let response;
  try {
    response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams(parameters).toString(),
      cache: 'no-store',
      credentials: 'omit'
    });
  } catch (cause) {
    throw new PortalAuthError('identity_provider_unavailable', { cause });
  }

  let payload = {};
  try {
    payload = await response.json();
  } catch {
    payload = {};
  }

  if (!response.ok) {
    const code = response.status >= 500 ? 'identity_provider_unavailable' : 'authentication_failed';
    throw new PortalAuthError(code, { status: response.status });
  }

  return payload;
}

export function validatePortalAuthConfig(payload) {
  const config = payload?.auth;
  if (!config || config.provider !== 'auth0') throw new PortalAuthError('portal_auth_unconfigured');

  const issuer = String(config.issuer || '').trim();
  const audience = String(config.audience || '').trim();
  const clientId = String(config.clientId || '').trim();
  const scope = String(config.scope || '').trim();

  let parsedIssuer;
  try {
    parsedIssuer = new URL(issuer);
  } catch {
    throw new PortalAuthError('portal_auth_misconfigured');
  }

  if (
    parsedIssuer.protocol !== 'https:' ||
    parsedIssuer.username ||
    parsedIssuer.password ||
    parsedIssuer.search ||
    parsedIssuer.hash ||
    (parsedIssuer.pathname && parsedIssuer.pathname !== '/') ||
    !audience ||
    !clientId ||
    !scope.includes('openid') ||
    !scope.includes('offline_access')
  ) {
    throw new PortalAuthError('portal_auth_misconfigured');
  }

  return { provider: 'auth0', issuer: `${parsedIssuer.origin}/`, audience, clientId, scope };
}

export function createPortalAuthAdapter(options = {}) {
  const windowRef = options.windowRef || window;
  const fetchImpl = options.fetchImpl || fetch;
  const cryptoImpl = options.cryptoImpl || crypto;
  const now = options.now || (() => Date.now());
  const storage = options.storage || windowRef.sessionStorage;
  const locationRef = windowRef.location;
  let config = null;
  let configurationError = null;

  function clearTransaction() {
    storage.removeItem(TRANSACTION_KEY);
  }

  function clearSession() {
    storage.removeItem(SESSION_KEY);
  }

  function currentSession() {
    const session = readJson(storage, SESSION_KEY);
    if (!session) return null;
    if (!safeToken(session.accessToken) || !safeToken(session.refreshToken)) {
      clearSession();
      return null;
    }
    return session;
  }

  async function loadConfig() {
    if (config) return config;
    if (configurationError) throw configurationError;

    let response;
    try {
      response = await fetchImpl(CONFIG_ENDPOINT, {
        method: 'GET',
        headers: { accept: 'application/json' },
        cache: 'no-store',
        credentials: 'same-origin'
      });
    } catch (cause) {
      throw new PortalAuthError('portal_auth_config_unavailable', { cause });
    }

    let payload = {};
    try {
      payload = await response.json();
    } catch {
      payload = {};
    }

    if (!response.ok) {
      configurationError = new PortalAuthError(
        payload.error === 'portal_auth_unconfigured' ? 'portal_auth_unconfigured' : 'portal_auth_config_unavailable',
        { status: response.status }
      );
      throw configurationError;
    }

    config = validatePortalAuthConfig(payload);
    return config;
  }

  async function refreshSession(session) {
    const activeConfig = await loadConfig();
    const payload = await tokenRequest(
      fetchImpl,
      issuerEndpoint(activeConfig.issuer, '/oauth/token'),
      {
        grant_type: 'refresh_token',
        client_id: activeConfig.clientId,
        refresh_token: session.refreshToken,
        scope: activeConfig.scope
      }
    );
    const refreshed = normalizeTokenPayload(payload, now(), session.refreshToken);
    writeJson(storage, SESSION_KEY, refreshed);
    return refreshed;
  }

  async function exchangeCallback(code, transaction) {
    const activeConfig = await loadConfig();
    const payload = await tokenRequest(
      fetchImpl,
      issuerEndpoint(activeConfig.issuer, '/oauth/token'),
      {
        grant_type: 'authorization_code',
        client_id: activeConfig.clientId,
        code,
        code_verifier: transaction.verifier,
        redirect_uri: callbackUri(locationRef)
      }
    );
    const session = normalizeTokenPayload(payload, now());
    writeJson(storage, SESSION_KEY, session);
    return session;
  }

  async function handleCallback() {
    const params = new URLSearchParams(locationRef.search);
    const code = params.get('code');
    const state = params.get('state');
    const oauthError = params.get('error');
    if (!code && !oauthError) return false;

    const transaction = readJson(storage, TRANSACTION_KEY);
    clearTransaction();

    if (oauthError) {
      clearSession();
      windowRef.history.replaceState({}, '', '/');
      throw new PortalAuthError('authentication_failed');
    }

    if (
      !transaction ||
      !transaction.state ||
      !transaction.verifier ||
      transaction.state !== state ||
      !Number.isFinite(Number(transaction.createdAt)) ||
      now() - Number(transaction.createdAt) > TRANSACTION_TTL_MS
    ) {
      clearSession();
      windowRef.history.replaceState({}, '', '/');
      throw new PortalAuthError('authentication_state_invalid');
    }

    await exchangeCallback(code, transaction);
    const returnTo = safeReturnTo(transaction.returnTo, locationRef);
    windowRef.history.replaceState({}, '', returnTo);
    return true;
  }

  async function initialize() {
    try {
      await loadConfig();
    } catch (error) {
      if (error.code === 'portal_auth_unconfigured') return { configured: false, authenticated: false };
      throw error;
    }

    await handleCallback();
    const token = await getAccessToken();
    return { configured: true, authenticated: Boolean(token) };
  }

  async function getAccessToken() {
    const session = currentSession();
    if (!session) return null;
    if (Number(session.expiresAt) - TOKEN_CLOCK_SKEW_MS > now()) return session.accessToken;

    try {
      const refreshed = await refreshSession(session);
      return refreshed.accessToken;
    } catch (error) {
      clearSession();
      if (error.code === 'authentication_failed') return null;
      throw error;
    }
  }

  async function login({ signup = false, returnTo } = {}) {
    const activeConfig = await loadConfig();
    const verifier = randomUrlToken(cryptoImpl, 48);
    const state = randomUrlToken(cryptoImpl, 32);
    const challenge = await codeChallenge(verifier, cryptoImpl);
    const safeTarget = safeReturnTo(
      returnTo || `${locationRef.pathname}${locationRef.search}${locationRef.hash}`,
      locationRef
    );

    writeJson(storage, TRANSACTION_KEY, {
      state,
      verifier,
      returnTo: safeTarget,
      createdAt: now()
    });

    const authorize = new URL(issuerEndpoint(activeConfig.issuer, '/authorize'));
    authorize.searchParams.set('response_type', 'code');
    authorize.searchParams.set('client_id', activeConfig.clientId);
    authorize.searchParams.set('redirect_uri', callbackUri(locationRef));
    authorize.searchParams.set('scope', activeConfig.scope);
    authorize.searchParams.set('audience', activeConfig.audience);
    authorize.searchParams.set('state', state);
    authorize.searchParams.set('code_challenge', challenge);
    authorize.searchParams.set('code_challenge_method', 'S256');
    if (signup) authorize.searchParams.set('screen_hint', 'signup');

    windowRef.location.assign(authorize.toString());
  }

  async function logout() {
    let activeConfig = null;
    try {
      activeConfig = await loadConfig();
    } catch {
      clearTransaction();
      clearSession();
      windowRef.location.assign('/');
      return;
    }

    clearTransaction();
    clearSession();
    const logoutUrl = new URL(issuerEndpoint(activeConfig.issuer, '/v2/logout'));
    logoutUrl.searchParams.set('client_id', activeConfig.clientId);
    logoutUrl.searchParams.set('returnTo', `${locationRef.origin}/`);
    windowRef.location.assign(logoutUrl.toString());
  }

  async function handleUnauthorized() {
    clearSession();
  }

  return {
    initialize,
    getAccessToken,
    login,
    logout,
    handleUnauthorized,
    isConfigured() {
      return Boolean(config) && !configurationError;
    },
    clearSession
  };
}

export const portalAuthInternals = {
  CONFIG_ENDPOINT,
  SESSION_KEY,
  TRANSACTION_KEY,
  TRANSACTION_TTL_MS,
  TOKEN_CLOCK_SKEW_MS,
  safeReturnTo,
  normalizeTokenPayload
};
