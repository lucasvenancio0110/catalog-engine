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
  customDomain: 'www.lojaarena.com.br',
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

  it('creates isolated identities and customer-owned domains for two stores', () => {
    const arena = buildTenantProvisioningPlan(arenaRequest);
    const gol = buildTenantProvisioningPlan({
      storeName: 'Loja do Gol',
      slug: 'loja-do-gol',
      ownerPrincipalId: 'principal:gol-owner',
      customDomain: 'lojodogol.com.br',
      themeKey: 'clean'
    });

    expect(gol.tenant.tenantId).not.toBe(arena.tenant.tenantId);
    expect(gol.dataPlane.dataPlaneKey).not.toBe(arena.dataPlane.dataPlaneKey);
    expect(gol.domain).toMatchObject({ hostname: 'lojodogol.com.br', domainType: 'custom' });
    expect(arena.domain).toMatchObject({ hostname: 'www.lojaarena.com.br', domainType: 'custom' });
    expect(gol.membership.principalId).toBe('principal:gol-owner');
    expect(arena.membership.principalId).toBe('principal:arena-owner');
  });

  it('allows store creation before a domain is connected', () => {
    const plan = buildTenantProvisioningPlan({ ...arenaRequest, customDomain: null });
    expect(plan.domain).toBeNull();
    expect(publicProvisioningSummary(plan).hostname).toBeNull();
  });

  it('creates every durable onboarding checkpoint in the private-preview-first order', () => {
    const plan = buildTenantProvisioningPlan(arenaRequest);
    expect(plan.provisioning.steps.map((step) => step.stepKey)).toEqual([
      'tenant',
      'profile',
      'data_plane',
      'migrations',
      'source',
      'import',
      'classify',
      'verify',
      'domain',
      'publish'
    ]);
    expect(plan.provisioning.steps.map((step) => step.stepKey)).toEqual(TENANT_PROVISION_STEPS);
    expect(plan.provisioning.steps.every((step) => step.status === 'pending')).toBe(true);
  });

  it('builds idempotent control-plane SQL scoped to the tenant', () => {
    const plan = buildTenantProvisioningPlan(arenaRequest);
    const sql = buildTenantProvisioningSql(plan);

    expect(sql).toContain(plan.tenant.tenantId);
    expect(sql).toContain(plan.dataPlane.dataPlaneKey);
    expect(sql).toContain(plan.provisioning.provisioningId);
    expect(sql).toContain("'custom'");
    expect(sql).toContain('ON CONFLICT');
    expect(sql).not.toContain('yupoo.com');
  });

  it('keeps the provisioning summary free from private supplier data', () => {
    const summary = publicProvisioningSummary(buildTenantProvisioningPlan(arenaRequest));
    expect(summary).toMatchObject({
      slug: 'loja-arena',
      storeName: 'Loja Arena',
      themeKey: 'stadium',
      hostname: 'www.lojaarena.com.br',
      domainType: 'custom',
      status: 'pending'
    });
    expect(summary).not.toHaveProperty('sourceUrl');
    expect(summary).not.toHaveProperty('supplierUrl');
    expect(summary).not.toHaveProperty('sourceLocatorRef');
    expect(JSON.stringify(summary)).not.toMatch(/yupoo\.com|credential|secret/i);
  });

  it('rejects protocol/path input where only a customer hostname is allowed', () => {
    expect(() =>
      buildTenantProvisioningPlan({
        ...arenaRequest,
        customDomain: 'https://lojaarena.com.br/path'
      })
    ).toThrow();
  });
});