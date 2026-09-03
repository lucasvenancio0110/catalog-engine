import { describe, expect, it } from 'vitest';
import {
  readStoreEntitlements,
  requireStoreCreationEntitlement,
  touchAccountPrincipal
} from '../worker/account-entitlements.js';

const principalId = 'prn_0123456789abcdefabcd';

function fakeDb({ entitlement = null, ownedStores = 0 } = {}) {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      return {
        bind(...params) {
          return {
            async first() {
              calls.push({ method: 'first', sql, params });
              if (sql.includes('FROM account_entitlements')) return entitlement;
              if (sql.includes('FROM tenant_memberships')) return { total: ownedStores };
              return null;
            },
            async run() {
              calls.push({ method: 'run', sql, params });
              return { success: true };
            }
          };
        }
      };
    }
  };
}

describe('PB2 account entitlement authority', () => {
  it('fails closed when an authenticated account has no active provisioning entitlement', async () => {
    const db = fakeDb();
    await expect(readStoreEntitlements(db, principalId)).resolves.toEqual({
      canCreateStore: false,
      maxStores: 0,
      usedStores: 0,
      remainingStores: 0
    });
    await expect(requireStoreCreationEntitlement(db, principalId)).rejects.toMatchObject({
      code: 'store_creation_not_entitled',
      status: 403
    });
  });

  it('normalizes the first-beta grant to one available store', async () => {
    const db = fakeDb({
      entitlement: {
        entitlement_id: 'ent_0123456789abcdefabcd',
        source: 'pilot_grant',
        max_stores: 1,
        expires_at: '2026-12-31T23:59:59.000Z'
      }
    });
    await expect(readStoreEntitlements(db, principalId)).resolves.toEqual({
      canCreateStore: true,
      maxStores: 1,
      usedStores: 0,
      remainingStores: 1
    });
    await expect(requireStoreCreationEntitlement(db, principalId)).resolves.toEqual({
      entitlementId: 'ent_0123456789abcdefabcd',
      maxStores: 1
    });
  });

  it('refuses a second owned store after the beta allowance is consumed', async () => {
    const db = fakeDb({
      entitlement: {
        entitlement_id: 'ent_0123456789abcdefabcd',
        source: 'pilot_grant',
        max_stores: 1,
        expires_at: '2026-12-31T23:59:59.000Z'
      },
      ownedStores: 1
    });
    await expect(readStoreEntitlements(db, principalId)).resolves.toMatchObject({
      canCreateStore: false,
      maxStores: 1,
      usedStores: 1,
      remainingStores: 0
    });
    await expect(requireStoreCreationEntitlement(db, principalId)).rejects.toMatchObject({
      code: 'store_limit_reached',
      status: 409
    });
  });

  it('registers only the opaque principal and never needs identity-provider subject or password data', async () => {
    const db = fakeDb();
    await touchAccountPrincipal(db, principalId);
    expect(db.calls).toHaveLength(1);
    expect(db.calls[0].method).toBe('run');
    expect(db.calls[0].params).toEqual([principalId]);
    expect(db.calls[0].sql).toContain('account_principals');
    expect(db.calls[0].sql).not.toMatch(/email|password|subject|refresh_token/i);
  });

  it('rejects non-opaque account identifiers before querying storage', async () => {
    const db = fakeDb();
    await expect(readStoreEntitlements(db, 'auth0|real-subject')).rejects.toMatchObject({
      code: 'invalid_account_principal',
      status: 500
    });
    expect(db.calls).toHaveLength(0);
  });
});
