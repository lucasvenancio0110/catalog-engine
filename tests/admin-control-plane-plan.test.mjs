import { describe, expect, it } from 'vitest';
import {
  buildTenantProvisioningPlan,
  publicProvisioningSummary
} from '../src/domain/tenant-provisioning.js';
import {
  buildTenantSourceConnection,
  publicTenantSourceSummary
} from '../src/domain/tenant-source-connection.js';
import {
  SupplierSourceValidationError,
  buildWorkerTenantProvisioningPlan,
  buildWorkerTenantSourceConnection,
  publicWorkerProvisioningSummary,
  publicWorkerTenantSourceSummary,
  verifyYupooCatalogSource
} from '../worker/control-plane-plan.js';

const principalId = 'prn_0123456789abcdefabcd';

describe('worker control-plane plans', () => {
  it('matches the durable Node provisioning identities exactly', async () => {
    const input = {
      storeName: 'Loja Arena',
      slug: 'loja-arena',
      ownerPrincipalId: principalId,
      customDomain: 'www.lojaarena.com.br',
      themeKey: 'stadium',
      currency: 'BRL'
    };
    const nodePlan = buildTenantProvisioningPlan(input);
    const workerPlan = await buildWorkerTenantProvisioningPlan(input);

    expect(workerPlan.tenant.tenantId).toBe(nodePlan.tenant.tenantId);
    expect(workerPlan.provisioning.provisioningId).toBe(nodePlan.provisioning.provisioningId);
    expect(workerPlan.provisioning.idempotencyKey).toBe(nodePlan.provisioning.idempotencyKey);
    expect(workerPlan.dataPlane.dataPlaneKey).toBe(nodePlan.dataPlane.dataPlaneKey);
    expect(workerPlan.membership.membershipId).toBe(nodePlan.membership.membershipId);
    expect(workerPlan.domain.domainId).toBe(nodePlan.domain.domainId);
    expect(publicWorkerProvisioningSummary(workerPlan)).toEqual(publicProvisioningSummary(nodePlan));
  });

  it('matches private source connection identities without returning the supplier URL publicly', async () => {
    const tenantId = 't_0123456789abcdefabcd';
    const input = {
      tenantId,
      sourceKey: 'primary',
      sourceUrl: 'https://supplier.x.yupoo.com/albums/',
      syncStrategy: 'incremental'
    };
    const nodePlan = buildTenantSourceConnection(input);
    const workerPlan = await buildWorkerTenantSourceConnection(input, {
      fetchImpl: async () => new Response('', { status: 200 })
    });

    expect(workerPlan.connection).toEqual(nodePlan.connection);
    expect(workerPlan.privateSource).toEqual(nodePlan.privateSource);
    expect(publicWorkerTenantSourceSummary(workerPlan)).toEqual(publicTenantSourceSummary(nodePlan));
    expect(JSON.stringify(publicWorkerTenantSourceSummary(workerPlan))).not.toMatch(/yupoo\.com|canonicalUrl|sourceLocatorRef/i);
  });

  it('discovers the Yupoo subcategory route only after the normal category returns 404', async () => {
    const calls = [];
    const result = await verifyYupooCatalogSource('https://supplier.x.yupoo.com/categories/66243', {
      fetchImpl: async (url) => {
        calls.push(url);
        return new Response('', { status: url.includes('isSubCate=true') ? 200 : 404 });
      }
    });

    expect(calls).toHaveLength(2);
    expect(result).toEqual({
      canonicalUrl: 'https://supplier.x.yupoo.com/categories/66243?isSubCate=true',
      scopeKind: 'category'
    });
  });

  it('rejects redirect chains that leave the approved Yupoo host boundary', async () => {
    await expect(
      verifyYupooCatalogSource('https://supplier.x.yupoo.com/albums/', {
        fetchImpl: async () =>
          new Response('', {
            status: 302,
            headers: { location: 'https://evil.example/steal' }
          })
      })
    ).rejects.toMatchObject({
      name: 'SupplierSourceValidationError',
      code: 'supplier_redirect_rejected'
    });
  });

  it('rejects arbitrary supplier hosts before any network call', async () => {
    let called = false;
    await expect(
      buildWorkerTenantSourceConnection(
        {
          tenantId: 't_0123456789abcdefabcd',
          sourceUrl: 'https://evil.example/albums/'
        },
        {
          fetchImpl: async () => {
            called = true;
            return new Response('', { status: 200 });
          }
        }
      )
    ).rejects.toBeInstanceOf(SupplierSourceValidationError);
    expect(called).toBe(false);
  });
});
