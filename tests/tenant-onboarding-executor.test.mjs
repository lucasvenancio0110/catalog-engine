import { describe, expect, it } from 'vitest';
import { buildTenantProvisioningPlan } from '../src/domain/tenant-provisioning.js';
import {
  executeTenantOnboarding,
  nextTenantOnboardingAction,
  normalizeTenantOnboardingState
} from '../src/domain/tenant-onboarding-executor.js';
import { buildProvisioningTransitionSql } from '../scripts/tenant-onboarding-state-core.mjs';

function stateFromPlan({ customDomain = null } = {}) {
  const plan = buildTenantProvisioningPlan({
    storeName: 'Loja Arena',
    slug: 'loja-arena',
    ownerPrincipalId: 'principal:owner',
    customDomain,
    themeKey: 'stadium'
  });
  return {
    tenantId: plan.tenant.tenantId,
    provisioningId: plan.provisioning.provisioningId,
    status: plan.provisioning.status,
    currentStep: plan.provisioning.currentStep,
    steps: plan.provisioning.steps.map((step) => ({ ...step, lastError: null })),
    domain: plan.domain
      ? {
          hostname: plan.domain.hostname,
          domainType: plan.domain.domainType,
          status: plan.domain.status
        }
      : null
  };
}

function succeedThrough(state, lastStepKey) {
  const order = state.steps.map((step) => step.stepKey);
  const lastIndex = order.indexOf(lastStepKey);
  for (let index = 0; index <= lastIndex; index += 1) {
    state.steps[index].status = 'success';
    state.steps[index].attemptCount = 1;
  }
  return normalizeTenantOnboardingState(state);
}

describe('tenant onboarding executor', () => {
  it('resumes from the first incomplete checkpoint instead of replaying successful work', async () => {
    let state = stateFromPlan();
    state = succeedThrough(state, 'source');
    const calls = [];

    const result = await executeTenantOnboarding(state, {
      handlers: {
        data_plane: async () => calls.push('data_plane')
      },
      maxSteps: 1
    });

    expect(result.outcome).toBe('yielded');
    expect(calls).toEqual(['data_plane']);
    expect(result.state.steps.find((step) => step.stepKey === 'tenant').attemptCount).toBe(1);
    expect(result.state.steps.find((step) => step.stepKey === 'data_plane').attemptCount).toBe(1);
    expect(result.state.currentStep).toBe('migrations');
  });

  it('stops on a failed step and retries that same checkpoint on the next execution', async () => {
    let state = succeedThrough(stateFromPlan(), 'migrations');
    let attempts = 0;

    const failed = await executeTenantOnboarding(state, {
      handlers: {
        import: async () => {
          attempts += 1;
          throw new Error('temporary import failure');
        }
      },
      maxSteps: 1
    });

    expect(failed.outcome).toBe('failed');
    expect(failed.state.currentStep).toBe('import');
    expect(failed.state.steps.find((step) => step.stepKey === 'import')).toMatchObject({
      status: 'failed',
      attemptCount: 1,
      lastError: 'temporary import failure'
    });

    state = failed.state;
    const retried = await executeTenantOnboarding(state, {
      handlers: {
        import: async () => {
          attempts += 1;
        }
      },
      maxSteps: 1
    });

    expect(retried.outcome).toBe('yielded');
    expect(attempts).toBe(2);
    expect(retried.state.steps.find((step) => step.stepKey === 'import')).toMatchObject({
      status: 'success',
      attemptCount: 2,
      lastError: null
    });
    expect(retried.state.currentStep).toBe('classify');
  });

  it('blocks after private preview verification when the customer has not connected a domain yet', () => {
    const state = succeedThrough(stateFromPlan(), 'verify');
    const action = nextTenantOnboardingAction(state);

    expect(action).toMatchObject({
      type: 'blocked',
      stepKey: 'domain',
      reason: 'custom_domain_required'
    });
  });

  it('lets the domain handler verify a pending customer domain, then publishes only after it becomes active', async () => {
    const state = succeedThrough(stateFromPlan({ customDomain: 'lojaarena.com.br' }), 'verify');
    const calls = [];

    const result = await executeTenantOnboarding(state, {
      handlers: {
        domain: async () => {
          calls.push('domain');
          return {
            domain: {
              hostname: 'lojaarena.com.br',
              domainType: 'custom',
              status: 'active'
            }
          };
        },
        publish: async () => calls.push('publish')
      },
      maxSteps: 2
    });

    expect(result.outcome).toBe('success');
    expect(calls).toEqual(['domain', 'publish']);
    expect(result.state.status).toBe('success');
    expect(result.state.currentStep).toBe('complete');
  });

  it('never publishes when domain verification finishes without an active hostname', async () => {
    const state = succeedThrough(stateFromPlan({ customDomain: 'lojaarena.com.br' }), 'verify');
    const calls = [];

    const result = await executeTenantOnboarding(state, {
      handlers: {
        domain: async () => ({
          domain: {
            hostname: 'lojaarena.com.br',
            domainType: 'custom',
            status: 'verifying'
          }
        }),
        publish: async () => calls.push('publish')
      },
      maxSteps: 2
    });

    expect(result.outcome).toBe('blocked');
    expect(result.reason).toBe('custom_domain_not_verified');
    expect(calls).toEqual([]);
    expect(result.state.currentStep).toBe('publish');
  });

  it('creates tenant-scoped durable SQL transitions and rejects private metadata', () => {
    const state = stateFromPlan();
    const sql = buildProvisioningTransitionSql({
      tenantId: state.tenantId,
      provisioningId: state.provisioningId,
      stepKey: 'classify',
      type: 'success',
      metadata: { classified: 120, review: 3 }
    });

    expect(sql).toContain(state.tenantId);
    expect(sql).toContain(state.provisioningId);
    expect(sql).toContain("current_step='verify'");
    expect(sql).toContain('classified');

    expect(() =>
      buildProvisioningTransitionSql({
        tenantId: state.tenantId,
        provisioningId: state.provisioningId,
        stepKey: 'source',
        type: 'success',
        metadata: { sourceUrl: 'https://supplier.x.yupoo.com/albums/' }
      })
    ).toThrow(/private or unsafe/i);
  });
});