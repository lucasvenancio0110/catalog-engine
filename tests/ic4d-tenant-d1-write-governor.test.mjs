import { describe, expect, it } from 'vitest';
import {
  TENANT_D1_WRITE_GOVERNOR_CONTRACT,
  createTenantD1WriteGovernedDispatch,
  evolveTenantD1WriteGovernorState,
  initialTenantD1WriteGovernorState
} from '../worker/ingestion/tenant-d1-write-governor.js';

function commandRequest(tenantId, sql) {
  return new Request('https://catalog-engine.internal/_catalog/internal/d1-batch', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-catalog-tenant-id': tenantId
    },
    body: JSON.stringify({
      version: 1,
      tenantId,
      batch: [{ sql, params: [tenantId] }]
    })
  });
}

function fakeGovernorNamespace() {
  const ids = [];
  const reports = [];
  let acquires = 0;
  return {
    ids,
    reports,
    get acquires() {
      return acquires;
    },
    idFromName(value) {
      ids.push(value);
      return value;
    },
    get() {
      return {
        async fetch(input, init = {}) {
          const url = new URL(typeof input === 'string' ? input : input.url);
          if (url.pathname === '/acquire') {
            acquires += 1;
            return Response.json({ admitted: true, token: `lease-${acquires}`, limit: 2 });
          }
          if (url.pathname === '/report') {
            reports.push(JSON.parse(init.body));
            return Response.json({ ok: true, limit: 2 });
          }
          return new Response('not_found', { status: 404 });
        }
      };
    }
  };
}

describe('IC4D tenant D1 write-pressure governor', () => {
  it('drops persistence concurrency to one on an artificial slow D1 signal', () => {
    const now = 10_000;
    const state = evolveTenantD1WriteGovernorState(
      initialTenantD1WriteGovernorState(),
      { status: 200, latencyMs: TENANT_D1_WRITE_GOVERNOR_CONTRACT.slowWriteMs + 1 },
      now
    );

    expect(state.limit).toBe(1);
    expect(state.cooldownUntil).toBeGreaterThan(now);
    expect(state.healthyStreak).toBe(0);
  });

  it('recovers only after a bounded healthy write window and never exceeds ceiling two', () => {
    let state = {
      ...initialTenantD1WriteGovernorState(),
      limit: 1,
      errorEwma: 0,
      latencyEwmaMs: 100,
      cooldownUntil: 0
    };
    let now = 20_000;
    for (let index = 0; index < TENANT_D1_WRITE_GOVERNOR_CONTRACT.healthyWindow; index += 1) {
      state = evolveTenantD1WriteGovernorState(state, { status: 200, latencyMs: 120 }, now++);
    }
    expect(state.limit).toBe(2);

    for (let index = 0; index < 20; index += 1) {
      state = evolveTenantD1WriteGovernorState(state, { status: 200, latencyMs: 100 }, now++);
    }
    expect(state.limit).toBe(TENANT_D1_WRITE_GOVERNOR_CONTRACT.ceiling);
  });

  it('governs mutating tenant D1 commands but does not tax read-only commands', async () => {
    const governor = fakeGovernorNamespace();
    let rawFetches = 0;
    const dispatch = {
      get() {
        return {
          async fetch() {
            rawFetches += 1;
            return Response.json({ ok: true, version: 1, results: [{}] });
          }
        };
      }
    };
    const wrapped = createTenantD1WriteGovernedDispatch({
      TENANT_DISPATCH: dispatch,
      TENANT_D1_WRITE_GOVERNOR: governor
    });
    const fetcher = wrapped.get('ce-test');

    await fetcher.fetch(commandRequest('t_11111111111111111111', 'SELECT ?1 AS tenant_id'));
    expect(governor.acquires).toBe(0);

    await fetcher.fetch(
      commandRequest('t_11111111111111111111', 'UPDATE catalog_products SET updated_at=CURRENT_TIMESTAMP WHERE product_id=?1')
    );
    expect(governor.acquires).toBe(1);
    expect(governor.reports).toHaveLength(1);
    expect(rawFetches).toBe(2);
  });

  it('uses independent opaque governor identities for different tenants', async () => {
    const governor = fakeGovernorNamespace();
    const dispatch = {
      get() {
        return {
          async fetch() {
            return Response.json({ ok: true, version: 1, results: [{}] });
          }
        };
      }
    };
    const wrapped = createTenantD1WriteGovernedDispatch({
      TENANT_DISPATCH: dispatch,
      TENANT_D1_WRITE_GOVERNOR: governor
    });
    const fetcher = wrapped.get('ce-test');

    await fetcher.fetch(commandRequest('t_11111111111111111111', 'DELETE FROM product_media WHERE product_id=?1'));
    await fetcher.fetch(commandRequest('t_22222222222222222222', 'DELETE FROM product_media WHERE product_id=?1'));

    expect(governor.ids).toHaveLength(2);
    expect(governor.ids[0]).not.toBe(governor.ids[1]);
    expect(governor.ids.every((value) => !value.includes('t_'))).toBe(true);
  });

  it('treats server and transport failures as pressure without weakening recurring-sync gates', () => {
    const server = evolveTenantD1WriteGovernorState(
      initialTenantD1WriteGovernorState(),
      { status: 503, latencyMs: 100 },
      30_000
    );
    const transport = evolveTenantD1WriteGovernorState(
      initialTenantD1WriteGovernorState(),
      { status: 0, latencyMs: 100, transportError: true },
      30_000
    );

    expect(server.limit).toBe(1);
    expect(transport.limit).toBe(1);
    expect(TENANT_D1_WRITE_GOVERNOR_CONTRACT.recurringSyncChanged).toBe(false);
  });
});
