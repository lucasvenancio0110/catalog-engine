const FLOOR = 1;
const CEILING = 2;
const INITIAL_LIMIT = 2;
const HEALTHY_WINDOW = 6;
const SLOW_WRITE_MS = 900;
const BASE_COOLDOWN_MS = 750;
const LEASE_MS = 60_000;
const MAX_ADMISSION_WAIT_MS = 60_000;
const TENANT_ID_PATTERN = /^t_[a-f0-9]{20}$/;
const DATA_PLANE_BATCH_PATH = '/_catalog/internal/d1-batch';
const MUTATION_PATTERN = /^(?:INSERT|UPDATE|DELETE)\b/i;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function ewma(previous, sample, alpha) {
  return previous == null ? sample : previous * (1 - alpha) + sample * alpha;
}

export function initialTenantD1WriteGovernorState() {
  return {
    limit: INITIAL_LIMIT,
    healthyStreak: 0,
    latencyEwmaMs: null,
    errorEwma: 0,
    cooldownUntil: 0,
    leases: {}
  };
}

export function evolveTenantD1WriteGovernorState(stateValue, signal, now = Date.now()) {
  const state = { ...initialTenantD1WriteGovernorState(), ...(stateValue || {}) };
  const latencyMs = Math.max(0, Number(signal?.latencyMs || 0));
  const status = Number(signal?.status || 0);
  const transportError = signal?.transportError === true;
  const serverFailure = status >= 500 && status <= 599;
  const slowWrite = latencyMs >= SLOW_WRITE_MS;
  const unhealthy = transportError || serverFailure || slowWrite;

  state.latencyEwmaMs = ewma(state.latencyEwmaMs, latencyMs, 0.25);
  state.errorEwma = ewma(state.errorEwma, unhealthy ? 1 : 0, 0.3);

  if (unhealthy) {
    state.limit = FLOOR;
    state.healthyStreak = 0;
    state.cooldownUntil = Math.max(state.cooldownUntil || 0, now + BASE_COOLDOWN_MS);
    return state;
  }

  state.healthyStreak += 1;
  if (
    state.limit < CEILING &&
    state.healthyStreak >= HEALTHY_WINDOW &&
    state.errorEwma <= 0.08 &&
    Number(state.latencyEwmaMs || 0) < SLOW_WRITE_MS
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

function hydrateState(value) {
  return { ...initialTenantD1WriteGovernorState(), ...(value || {}) };
}

export class TenantD1WriteGovernor {
  constructor(state) {
    this.state = state;
  }

  async transact(mutator) {
    return this.state.storage.transaction(async (transaction) => {
      const current = hydrateState(await transaction.get('state'));
      const result = await mutator(current);
      if (result?.state) await transaction.put('state', result.state);
      return result?.response;
    });
  }

  async fetch(request) {
    const url = new URL(request.url);
    const now = Date.now();

    if (request.method === 'POST' && url.pathname === '/acquire') {
      return this.transact(async (current) => {
        const state = pruneLeases(current, now);
        if ((state.cooldownUntil || 0) > now) {
          return {
            state,
            response: Response.json(
              { admitted: false, waitMs: clamp(state.cooldownUntil - now, 25, 2000) },
              { status: 429 }
            )
          };
        }
        if (Object.keys(state.leases || {}).length >= state.limit) {
          return {
            state,
            response: Response.json({ admitted: false, waitMs: 50 }, { status: 429 })
          };
        }
        const token = crypto.randomUUID();
        state.leases = { ...state.leases, [token]: now + LEASE_MS };
        return {
          state,
          response: Response.json({ admitted: true, token, limit: state.limit })
        };
      });
    }

    if (request.method === 'POST' && url.pathname === '/report') {
      const body = await request.json().catch(() => ({}));
      return this.transact(async (current) => {
        let state = pruneLeases(current, now);
        const token = String(body?.token || '');
        if (token && state.leases?.[token]) {
          const leases = { ...state.leases };
          delete leases[token];
          state.leases = leases;
        }
        state = evolveTenantD1WriteGovernorState(
          state,
          {
            status: body?.status,
            latencyMs: body?.latencyMs,
            transportError: body?.transportError === true
          },
          now
        );
        return { state, response: Response.json({ ok: true, limit: state.limit }) };
      });
    }

    return new Response('not_found', { status: 404 });
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function opaqueTenantKey(tenantId) {
  const bytes = new TextEncoder().encode(`tenant-d1-write-v1:${tenantId}`);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest.slice(0, 16), (value) => value.toString(16).padStart(2, '0')).join('');
}

async function acquire(stub) {
  const started = Date.now();
  for (;;) {
    const response = await stub.fetch('https://tenant-write-governor.internal/acquire', {
      method: 'POST'
    });
    const body = await response.json().catch(() => ({}));
    if (response.ok && body?.admitted === true && body?.token) return String(body.token);
    if (Date.now() - started >= MAX_ADMISSION_WAIT_MS) {
      throw new Error('tenant_d1_write_governor_admission_timeout');
    }
    const base = clamp(Number(body?.waitMs || 50), 25, 2000);
    await sleep(base + Math.floor(Math.random() * 40));
  }
}

async function mutatingTenantFromRequest(request) {
  let url;
  try {
    url = new URL(request.url);
  } catch {
    return null;
  }
  if (request.method !== 'POST' || url.pathname !== DATA_PLANE_BATCH_PATH) return null;
  const tenantId = String(request.headers.get('x-catalog-tenant-id') || '').trim();
  if (!TENANT_ID_PATTERN.test(tenantId)) return null;
  const payload = await request.clone().json().catch(() => null);
  const batch = Array.isArray(payload?.batch) ? payload.batch : [];
  const mutating = batch.some((query) => MUTATION_PATTERN.test(String(query?.sql || '').trim()));
  return mutating ? tenantId : null;
}

export function createTenantD1WriteGovernedDispatch(env) {
  const dispatch = env?.TENANT_DISPATCH;
  const namespace = env?.TENANT_D1_WRITE_GOVERNOR;
  if (!dispatch || typeof dispatch.get !== 'function') return dispatch;
  if (!namespace || typeof namespace.idFromName !== 'function' || typeof namespace.get !== 'function') {
    return dispatch;
  }

  return {
    get(scriptName) {
      const rawFetcher = dispatch.get(scriptName);
      return {
        async fetch(request) {
          const tenantId = await mutatingTenantFromRequest(request);
          if (!tenantId) return rawFetcher.fetch(request);

          const key = await opaqueTenantKey(tenantId);
          const governor = namespace.get(namespace.idFromName(key));
          const token = await acquire(governor);
          const started = performance.now();
          let status = 0;
          let transportError = false;
          try {
            const response = await rawFetcher.fetch(request);
            status = response.status;
            return response;
          } catch (error) {
            transportError = true;
            throw error;
          } finally {
            const latencyMs = Math.max(0, Math.round(performance.now() - started));
            await governor
              .fetch('https://tenant-write-governor.internal/report', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ token, status, latencyMs, transportError })
              })
              .catch(() => {});
          }
        }
      };
    }
  };
}

export function createTenantD1WriteGovernedEnv(env) {
  const governedDispatch = createTenantD1WriteGovernedDispatch(env);
  if (!governedDispatch || governedDispatch === env?.TENANT_DISPATCH) return env;
  return { ...env, TENANT_DISPATCH: governedDispatch };
}

export const TENANT_D1_WRITE_GOVERNOR_CONTRACT = Object.freeze({
  floor: FLOOR,
  ceiling: CEILING,
  initialLimit: INITIAL_LIMIT,
  healthyWindow: HEALTHY_WINDOW,
  slowWriteMs: SLOW_WRITE_MS,
  leaseMs: LEASE_MS,
  recurringSyncChanged: false
});
