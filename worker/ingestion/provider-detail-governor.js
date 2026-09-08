const FLOOR = 1;
const CEILING = 4;
const INITIAL_LIMIT = 2;
const HEALTHY_WINDOW = 8;
const LATENCY_DEGRADE_MS = 1800;
const BASE_COOLDOWN_MS = 2000;
const LEASE_MS = 30000;
const MAX_ADMISSION_WAIT_MS = 60000;
const BYPASS_HOSTS = new Set(['api.cloudflare.com']);

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function ewma(previous, sample, alpha) {
  return previous == null ? sample : previous * (1 - alpha) + sample * alpha;
}

export function initialProviderGovernorState() {
  return {
    limit: INITIAL_LIMIT,
    healthyStreak: 0,
    latencyEwmaMs: null,
    errorEwma: 0,
    cooldownUntil: 0,
    leases: {}
  };
}

export function evolveProviderGovernorState(stateValue, signal, now = Date.now()) {
  const state = { ...initialProviderGovernorState(), ...(stateValue || {}) };
  const latencyMs = Math.max(0, Number(signal?.latencyMs || 0));
  const status = Number(signal?.status || 0);
  const timeout = signal?.timeout === true;
  const transportError = signal?.transportError === true;
  const throttled = status === 429;
  const upstream5xx = status >= 500 && status <= 599;
  const degradedLatency = latencyMs >= LATENCY_DEGRADE_MS;
  const unhealthy = timeout || transportError || throttled || upstream5xx || degradedLatency;

  state.latencyEwmaMs = ewma(state.latencyEwmaMs, latencyMs, 0.2);
  state.errorEwma = ewma(state.errorEwma, unhealthy ? 1 : 0, 0.25);

  if (unhealthy) {
    state.limit = Math.max(FLOOR, Math.floor(state.limit / 2));
    state.healthyStreak = 0;
    const multiplier = throttled || timeout ? 2 : 1;
    state.cooldownUntil = Math.max(state.cooldownUntil || 0, now + BASE_COOLDOWN_MS * multiplier);
    return state;
  }

  state.healthyStreak += 1;
  if (
    state.healthyStreak >= HEALTHY_WINDOW &&
    state.errorEwma <= 0.08 &&
    Number(state.latencyEwmaMs || 0) < LATENCY_DEGRADE_MS &&
    state.limit < CEILING
  ) {
    state.limit += 1;
    state.healthyStreak = 0;
  }
  state.limit = clamp(state.limit, FLOOR, CEILING);
  return state;
}

function pruneLeases(state, now) {
  const leases = {};
  for (const [token, expiresAt] of Object.entries(state.leases || {})) {
    if (Number(expiresAt) > now) leases[token] = Number(expiresAt);
  }
  return { ...state, leases };
}

function activeLeaseCount(state) {
  return Object.keys(state.leases || {}).length;
}

export class ProviderDetailGovernor {
  constructor(state) {
    this.state = state;
  }

  async loadState() {
    return {
      ...initialProviderGovernorState(),
      ...((await this.state.storage.get('state')) || {})
    };
  }

  async saveState(value) {
    await this.state.storage.put('state', value);
  }

  async fetch(request) {
    const url = new URL(request.url);
    const now = Date.now();
    let state = pruneLeases(await this.loadState(), now);

    if (request.method === 'POST' && url.pathname === '/acquire') {
      if ((state.cooldownUntil || 0) > now) {
        await this.saveState(state);
        return Response.json({ admitted: false, waitMs: clamp(state.cooldownUntil - now, 50, 5000) }, { status: 429 });
      }
      if (activeLeaseCount(state) >= state.limit) {
        await this.saveState(state);
        return Response.json({ admitted: false, waitMs: 100 }, { status: 429 });
      }
      const token = crypto.randomUUID();
      state.leases = { ...state.leases, [token]: now + LEASE_MS };
      await this.saveState(state);
      return Response.json({ admitted: true, token, limit: state.limit });
    }

    if (request.method === 'POST' && url.pathname === '/report') {
      const body = await request.json().catch(() => ({}));
      const token = String(body?.token || '');
      if (token && state.leases?.[token]) {
        const leases = { ...state.leases };
        delete leases[token];
        state.leases = leases;
      }
      state = evolveProviderGovernorState(state, {
        status: body?.status,
        latencyMs: body?.latencyMs,
        timeout: body?.timeout === true,
        transportError: body?.transportError === true
      }, now);
      await this.saveState(state);
      return Response.json({ ok: true, limit: state.limit });
    }

    return new Response('not_found', { status: 404 });
  }
}

async function opaqueSourceKey(hostname) {
  const bytes = new TextEncoder().encode(`provider-host-v1:${hostname.toLowerCase()}`);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest.slice(0, 16), (value) => value.toString(16).padStart(2, '0')).join('');
}

function shouldGovern(url) {
  if (url.protocol !== 'https:') return false;
  if (BYPASS_HOSTS.has(url.hostname.toLowerCase())) return false;
  if (url.hostname.endsWith('.workers.dev')) return false;
  if (url.hostname === 'catalogoengine.com' || url.hostname.endsWith('.catalogoengine.com')) return false;
  return true;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function acquire(stub) {
  const started = Date.now();
  for (;;) {
    const response = await stub.fetch('https://governor.internal/acquire', { method: 'POST' });
    const body = await response.json().catch(() => ({}));
    if (response.ok && body?.admitted === true && body?.token) return String(body.token);
    if (Date.now() - started >= MAX_ADMISSION_WAIT_MS) throw new Error('catalog_provider_governor_admission_timeout');
    const base = clamp(Number(body?.waitMs || 100), 50, 5000);
    await sleep(base + Math.floor(Math.random() * 75));
  }
}

export function createAdaptiveProviderFetch(env, fetchImpl = fetch) {
  const namespace = env?.PROVIDER_DETAIL_GOVERNOR;
  if (!namespace || typeof namespace.idFromName !== 'function') return fetchImpl;

  return async function adaptiveProviderFetch(input, init) {
    let url;
    try {
      url = new URL(input instanceof Request ? input.url : String(input));
    } catch {
      return fetchImpl(input, init);
    }
    if (!shouldGovern(url)) return fetchImpl(input, init);

    const key = await opaqueSourceKey(url.hostname);
    const stub = namespace.get(namespace.idFromName(key));
    const token = await acquire(stub);
    const started = performance.now();
    let status = 0;
    let timeout = false;
    let transportError = false;
    try {
      const response = await fetchImpl(input, init);
      status = response.status;
      return response;
    } catch (error) {
      const message = String(error?.name || error?.message || error).toLowerCase();
      timeout = message.includes('timeout') || message.includes('abort');
      transportError = !timeout;
      throw error;
    } finally {
      const latencyMs = Math.max(0, Math.round(performance.now() - started));
      await stub.fetch('https://governor.internal/report', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, status, latencyMs, timeout, transportError })
      }).catch(() => {});
    }
  };
}

export const PROVIDER_GOVERNOR_CONTRACT = Object.freeze({
  floor: FLOOR,
  ceiling: CEILING,
  initialLimit: INITIAL_LIMIT,
  healthyWindow: HEALTHY_WINDOW,
  latencyDegradeMs: LATENCY_DEGRADE_MS,
  recurringSyncChanged: false
});
