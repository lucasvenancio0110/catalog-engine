import { describe, expect, it } from 'vitest';
import {
  TENANT_PROVISION_STEPS,
  buildTenantProvisioningPlan,
  publicProvisioningSummary
} from '../src/domain/tenant-provisioning.js';
import { buildTenantProvisioningSql } from '../scripts/tenant-provisioning-core.mjs';

const arenaRequest = {
  storeName: 'Loja Arena',
  slug: 'loja-arena',
  ownerPrincipalId: 'principal:arena-owner',
  platformBaseDomain: 'shops.example.com',
  themeKey: 'stadium'
};

describe('tenant provisioning', () => {
  it('is idempotent for the same owner and store slug', () => {
    const first = buildTenantProvisioningPlan(arenaRequest);
    const retry = buildTenantProvisioningPlan(arenaRequest);

    expect(retry.tenant.tenantId).toBe(first.tenant.tenantId);
    expect(retry.provisioning.provisioningId).toBe(first.provisioning.provisioningId);
    expect(retry.provisioning.idempotencyKey).toBe(first.provisioning.idempotencyKey);
    expect(retry.dataPlane.dataPlaneKey).toBe(first.dataPlane.dataPlaneKey);
  });

  it('creates isolated identities for two stores', () => {
    const arena = buildTenantProvisioningPlan(arenaRequest);
    const gol = buildTenantProvisioningPlan({
      storeName: 'Loja do Gol',
      slug: 'loja-do-gol',
      ownerPrincipalId: 'principal:gol-owner',
      platformBaseDomain: 'shops.example.com',
      themeKey: 'clean'
    });

    expect(gol.tenant.tenantId).not.toBe(arena.tenant.tenantId);
    expect(gol.dataPlane.dataPlaneKey).not.toBe(arena.dataPlane.dataPlaneKey);
    expect(gol.domain.hostname).toBe('loja-do-gol.shops.example.com');
    expect(arena.domain.hostname).toBe('loja-arena.shops.example.com');
    expect(gol.membership.principalId).toBe('principal:gol-owner');
    expect(arena.membership.principalId).toBe('principal:arena-owner');
  });

  it('creates every durable onboarding checkpoint in order', () => {
    const plan = buildTenantProvisioningPlan(arenaRequest);
    expect(plan.provisioning.steps.map((step) => step.stepKey)).toEqual(TENANT_PROVISION_STEPS);
    expect(plan.provisioning.steps.every((step) => step.status === 'pending')).toBe(true);
  });

  it('builds idempotent control-plane SQL scoped to the tenant', () => {
    const plan = buildTenantProvisioningPlan(arenaRequest);
    const sql = buildTenantProvisioningSql(plan);

    expect(sql).toContain(plan.tenant.tenantId);
    expect(sql).toContain(plan.dataPlane.dataPlaneKey);
    expect(sql).toContain(plan.provisioning.provisioningId);
    expect(sql).toContain('ON CONFLICT');
    expect(sql).not.toContain('yupoo.com');
  });

  it('keeps the provisioning summary free from private supplier state', () => {
    const summary = publicProvisioningSummary(buildTenantProvisioningPlan(arenaRequest));
    expect(summary).toMatchObject({
      slug: 'loja-arena',
      storeName: 'Loja Arena',
      themeKey: 'stadium',
      hostname: 'loja-arena.shops.example.com',
      status: 'pending'
    });
    expect(JSON.stringify(summary)).not.toMatch(/source|supplier|credential|secret/i);
  });

  it('rejects unsafe platform domain input', () => {
    expect(() =>
      buildTenantProvisioningPlan({
        ...arenaRequest,
        platformBaseDomain: 'https://shops.example.com/path'
      })
    ).toThrow();
  });
});
