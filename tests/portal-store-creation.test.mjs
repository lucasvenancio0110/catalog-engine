import { describe, expect, it } from 'vitest';
import { buildWorkerTenantProvisioningPlan } from '../worker/control-plane-plan.js';
import {
  handlePortalStoreCreation,
  merchantCreatedStoreFromDelegate
} from '../worker/portal-store-creation.js';

const principalId = 'prn_0123456789abcdefabcd';
const futureExpiry = '2099-01-01T00:00:00Z';
const defaultTenantId = 't_00000000000000000001';

function jsonResponse(payload, status) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

function storeRequest(slug = 'loja-beta') {
  return new Request('https://app.catalogoengine.com/api/admin/stores', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'Loja Beta',
      slug,
      currency: 'BRL'
    })
  });
}

function storedRow(slug = 'loja-beta') {
  return {
    tenant_id: 't_0123456789abcdefabcd',
    slug,
    currency: 'BRL',
    status: 'active',
    store_name: 'Loja Beta',
    provisioning_id: 'pv_0123456789abcdefabcd',
    provisioning_status: 'pending',
    provisioning_step: 'tenant'
  };
}

function fakeDb(state) {
  return {
    prepare(sql) {
      if (/\btenant_profiles\b/.test(sql)) {
        throw new Error('unknown_table:tenant_profiles');
      }
      return {
        bind() {
          return {
            async first() {
              if (sql.includes('FROM catalog_tenants t')) return state.row || null;
              if (sql.includes('FROM account_entitlements')) {
                state.entitlementReads += 1;
                return {
                  entitlement_id: 'ent_0123456789abcdefabcd',
                  max_stores: 1,
                  expires_at: futureExpiry
                };
              }
              if (sql.includes('SELECT COUNT(*) AS total')) {
                state.storeCountReads += 1;
                return { total: state.row ? 1 : 0 };
              }
              throw new Error(`unexpected_query:${sql.slice(0, 40)}`);
            }
          };
        }
      };
    }
  };
}

function delegatedStore(slug = 'loja-beta') {
  return {
    tenantId: 't_0123456789abcdefabcd',
    slug,
    storeName: 'Loja Beta',
    title: 'Loja Beta',
    currency: 'BRL',
    dataPlaneKey: 'dp_internal_locator',
    catalogInstanceId: 'ci_internal_locator',
    ownerMembershipId: 'mem_internal_locator',
    themeKey: 'premium-dark',
    hostname: 'internal.example',
    provisioningId: 'pv_0123456789abcdefabcd',
    status: 'pending',
    currentStep: 'tenant'
  };
}

describe('PB3 portal store creation boundary', () => {
  it('derives a real opaque tenant identity distinct from the historical default tenant', async () => {
    const plan = await buildWorkerTenantProvisioningPlan({
      storeName: 'Loja Beta',
      slug: 'loja-beta',
      currency: 'BRL',
      ownerPrincipalId: principalId
    });

    expect(plan.tenant.tenantId).toMatch(/^t_[a-f0-9]{20}$/);
    expect(plan.tenant.tenantId).not.toBe(defaultTenantId);
  });

  it('projects only merchant-safe store creation fields', () => {
    const store = merchantCreatedStoreFromDelegate(delegatedStore());
    expect(store).toMatchObject({
      tenantId: 't_0123456789abcdefabcd',
      slug: 'loja-beta',
      title: 'Loja Beta',
      currency: 'BRL',
      status: 'pending',
      currentStep: 'tenant',
      latestProvisioning: {
        id: 'pv_0123456789abcdefabcd',
        status: 'pending',
        step: 'tenant'
      },
      initialImport: {
        status: 'blocked',
        reason: 'onboarding_source_required'
      }
    });
    const serialized = JSON.stringify(store);
    expect(serialized).not.toMatch(/dataPlaneKey|catalogInstanceId|ownerMembershipId|themeKey|hostname|internal_locator/i);
  });

  it('creates once, delegates the canonical payload, and replays without consuming entitlement twice', async () => {
    const state = { row: null, entitlementReads: 0, storeCountReads: 0, delegateCalls: 0 };
    const env = { CATALOG_DB: fakeDb(state) };
    const delegate = async (request) => {
      state.delegateCalls += 1;
      expect(await request.json()).toEqual({
        storeName: 'Loja Beta',
        slug: 'loja-beta',
        themeKey: 'premium-dark',
        currency: 'BRL',
        customDomain: null
      });
      state.row = storedRow();
      return jsonResponse({ store: delegatedStore() }, 201);
    };

    const first = await handlePortalStoreCreation({
      request: storeRequest(),
      env,
      ctx: {},
      principalId,
      delegate
    });
    const firstPayload = await first.json();
    expect(first.status).toBe(201);
    expect(firstPayload.replayed).toBe(false);
    expect(JSON.stringify(firstPayload)).not.toMatch(/dataPlaneKey|internal_locator/i);

    const retry = await handlePortalStoreCreation({
      request: storeRequest(),
      env,
      ctx: {},
      principalId,
      delegate
    });
    const retryPayload = await retry.json();
    expect(retry.status).toBe(200);
    expect(retryPayload.replayed).toBe(true);
    expect(retryPayload.store.tenantId).toBe(state.row.tenant_id);
    expect(state.delegateCalls).toBe(1);
    expect(state.entitlementReads).toBe(1);
    expect(state.storeCountReads).toBe(1);
  });

  it('converts a same-request quota race into an idempotent replay', async () => {
    const state = { row: null, entitlementReads: 0, storeCountReads: 0, delegateCalls: 0 };
    const env = { CATALOG_DB: fakeDb(state) };
    const response = await handlePortalStoreCreation({
      request: storeRequest(),
      env,
      ctx: {},
      principalId,
      delegate: async () => {
        state.delegateCalls += 1;
        state.row = storedRow();
        return jsonResponse({ error: 'store_limit_reached' }, 409);
      }
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      replayed: true,
      store: { slug: 'loja-beta' }
    });
    expect(state.delegateCalls).toBe(1);
  });

  it('preserves a quota conflict when the winning request created a different store', async () => {
    const state = { row: null, entitlementReads: 0, storeCountReads: 0, delegateCalls: 0 };
    const env = { CATALOG_DB: fakeDb(state) };
    const response = await handlePortalStoreCreation({
      request: storeRequest('outra-loja'),
      env,
      ctx: {},
      principalId,
      delegate: async () => {
        state.delegateCalls += 1;
        return jsonResponse({ error: 'store_limit_reached' }, 409);
      }
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'store_limit_reached' });
    expect(state.delegateCalls).toBe(1);
  });

  it('leaves invalid payload validation to the canonical control-plane handler', async () => {
    const state = { row: null, entitlementReads: 0, storeCountReads: 0, delegateCalls: 0 };
    const env = { CATALOG_DB: fakeDb(state) };
    const request = new Request('https://app.catalogoengine.com/api/admin/stores', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '', slug: 'INVALID SLUG', currency: 'x' })
    });
    const response = await handlePortalStoreCreation({
      request,
      env,
      ctx: {},
      principalId,
      delegate: async () => {
        state.delegateCalls += 1;
        return jsonResponse({ error: 'invalid_store_payload' }, 400);
      }
    });

    expect(response.status).toBe(400);
    expect(state.delegateCalls).toBe(1);
    expect(state.entitlementReads).toBe(0);
  });
});
